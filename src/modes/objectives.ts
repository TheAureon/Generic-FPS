import * as THREE from 'three';
import type { NavGraph } from '../bots/NavGraph';
import type { CollisionWorld } from '../core/CollisionWorld';
import type { MapDef, SpawnPoint } from '../map/MapTypes';

const d2 = (p: { x: number; z: number }, q: { x: number; z: number }) => (p.x - q.x) ** 2 + (p.z - q.z) ** 2;

/**
 * Where objectives go, and what they look like: rings on the ground for
 * hills and zones, flags on poles.
 */

/** Split the map's spawn points into two sides (around the two that are farthest apart). */
export function teamSides(def: MapDef): [SpawnPoint[], SpawnPoint[]] {
  const all = [...def.playerSpawns, ...def.botSpawns];
  let a = all[0], b = all[all.length - 1], best = -1;
  for (const p of all) for (const q of all) {
    if (d2(p, q) > best) { best = d2(p, q); a = p; b = q; }
  }
  const sideA: SpawnPoint[] = [], sideB: SpawnPoint[] = [];
  for (const p of all) (d2(p, a) <= d2(p, b) ? sideA : sideB).push(p);
  // Keep the sides balanced: if one is small, give it the nearest of the others.
  while (sideA.length < Math.floor(all.length / 3) && sideB.length > 1) moveNearest(sideB, sideA, a);
  while (sideB.length < Math.floor(all.length / 3) && sideA.length > 1) moveNearest(sideA, sideB, b);
  return [sideA, sideB];
}

function moveNearest(from: SpawnPoint[], to: SpawnPoint[], toward: SpawnPoint): void {
  let k = 0;
  from.forEach((p, i) => { if (d2(p, toward) < d2(from[k], toward)) k = i; });
  to.push(from.splice(k, 1)[0]);
}

/** The middle of a side (the average of its spawns). */
function centroid(ps: SpawnPoint[]): THREE.Vector3 {
  const c = new THREE.Vector3();
  for (const p of ps) c.add(new THREE.Vector3(p.x, p.y, p.z));
  return c.divideScalar(Math.max(1, ps.length));
}

/** The nav node nearest a point, preferring open ground (not hugging a wall, fully connected). */
export function snapToOpen(nav: NavGraph, x: number, z: number, y?: number): THREE.Vector3 {
  const p = new THREE.Vector3(x, y ?? 0, z);
  let best: THREE.Vector3 | null = null, bestScore = Infinity;
  for (const r of [6, 14, 30]) {
    for (const n of nav.nodesWithin(p, r)) {
      const open = !n.nearWall && n.edges.length >= 8;
      const score = Math.hypot(n.x - x, n.z - z) + (open ? 0 : 6) + (y !== undefined ? Math.abs(n.y - y) * 2 : 0);
      if (score < bestScore) { bestScore = score; best = new THREE.Vector3(n.x, n.y, n.z); }
    }
    if (best) return best;
  }
  const n = nav.nearestNode(p);
  return n ? new THREE.Vector3(n.x, n.y, n.z) : p;
}

/** Farthest apart the two flag bases may be (meters). */
const MAX_BASE_DISTANCE = 110;

export interface Placement {
  /** Blue's flag base, Red's flag base. */
  flags: [THREE.Vector3, THREE.Vector3];
  /** Control zones (A, B, C), from Blue's side to Red's. */
  zones: THREE.Vector3[];
  /** Hill spots, in the order the hill moves. */
  hills: THREE.Vector3[];
}

/** Objective spots: from the map's `objectives` if it has them, else spread between the two sides. */
export function placeObjectives(def: MapDef, nav: NavGraph, sides: [SpawnPoint[], SpawnPoint[]]): Placement {
  const o = def.objectives ?? {};
  const v = ([x, y, z]: [number, number, number]) => snapToOpen(nav, x, z, y);
  const A0 = centroid(sides[0]), B0 = centroid(sides[1]);
  // The far ends: the spawn farthest from the other side.
  const far = (ps: SpawnPoint[], other: THREE.Vector3) => {
    const p = ps.reduce((m, q) => (d2(q, other) > d2(m, other) ? q : m), ps[0]);
    return new THREE.Vector3(p.x, p.y, p.z);
  };
  let endA = far(sides[0], B0), endB = far(sides[1], A0);
  // On huge maps, bring the bases in so a flag run isn't endless.
  const span = Math.hypot(endB.x - endA.x, endB.z - endA.z);
  if (span > MAX_BASE_DISTANCE) {
    const mid = endA.clone().lerp(endB, 0.5), k = MAX_BASE_DISTANCE / span;
    endA = snapToOpen(nav, mid.x + (endA.x - mid.x) * k, mid.z + (endA.z - mid.z) * k);
    endB = snapToOpen(nav, mid.x + (endB.x - mid.x) * k, mid.z + (endB.z - mid.z) * k);
  }
  // Near that end, on open ground, but not right on a spawn point (nobody should appear inside a flag).
  const spawns = [...sides[0], ...sides[1]];
  const inward = (p: THREE.Vector3, toward: THREE.Vector3) => {
    const clear = (n: { x: number; z: number }) => spawns.every((s) => Math.hypot(s.x - n.x, s.z - n.z) >= 3);
    const ok = nav.nodesWithin(p, 12).filter((n) => clear(n) && !n.nearWall && Math.abs(n.y - p.y) < 1.5);
    if (ok.length) {
      // The closest such spot, leaning toward the middle of the map.
      const score = (n: { x: number; z: number }) => Math.hypot(n.x - p.x, n.z - p.z) - 0.3 * (Math.hypot(p.x - toward.x, p.z - toward.z) - Math.hypot(n.x - toward.x, n.z - toward.z));
      const n = ok.reduce((a, b) => (score(b) < score(a) ? b : a));
      return new THREE.Vector3(n.x, n.y, n.z);
    }
    const q = p.clone().lerp(toward, 0.08);
    return snapToOpen(nav, q.x, q.z, p.y);
  };
  const flags: [THREE.Vector3, THREE.Vector3] = o.flags ? [v(o.flags[0]), v(o.flags[1])] : [inward(endA, endB), inward(endB, endA)];
  // Zones and hills: spread along the line between the two bases (and to either side of it).
  const at = (t: number, side: number) => {
    const dx = endB.x - endA.x, dz = endB.z - endA.z;
    return snapToOpen(nav, endA.x + dx * t - dz * side, endA.z + dz * t + dx * side);
  };
  const zones = o.zones ? o.zones.map(v) : [at(0.2, 0.06), at(0.5, -0.04), at(0.8, 0.06)];
  const hills = o.hills ? o.hills.map(v) : [at(0.5, 0), at(0.33, 0.22), at(0.67, -0.22), at(0.36, -0.2), at(0.64, 0.2)];
  return { flags, zones, hills };
}

/** Is a point inside a ring (flat distance, and roughly the same floor)? */
export function inRing(p: THREE.Vector3, center: THREE.Vector3, radius: number): boolean {
  return Math.hypot(p.x - center.x, p.z - center.z) <= radius && Math.abs(p.y - center.y) < 2.5;
}

// ---- Visuals ------------------------------------------------------------------------------------------

let fadeTexture: THREE.Texture | null = null;
/** Bright at the bottom, fading out going up. */
function fade(): THREE.Texture {
  if (fadeTexture) return fadeTexture;
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 64, 0, 0);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(0.15, '#999');
  grad.addColorStop(1, '#000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 64);
  fadeTexture = new THREE.CanvasTexture(c);
  return fadeTexture;
}

/** A ring on the ground with a glowing see-through wall, and a light beam so you can find it from afar. */
export class RingVisual {
  readonly group = new THREE.Group();
  private wallMat: THREE.MeshBasicMaterial;
  private lineMat: THREE.LineBasicMaterial;
  private beamMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, world: CollisionWorld, readonly center: THREE.Vector3, radius: number, beam = true) {
    this.wallMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, alphaMap: fade(), side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    this.lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, alphaMap: fade(), depthWrite: false, blending: THREE.AdditiveBlending });
    // The ring follows the ground (sampled all the way round).
    const N = 64, pts: THREE.Vector3[] = [], wallPos: number[] = [], wallUv: number[] = [];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2, x = center.x + Math.cos(a) * radius, z = center.z + Math.sin(a) * radius;
      let y = world.groundHeight(x, z, 0.05, center.y + 1.2);
      if (!Number.isFinite(y) || y < center.y - 3) y = center.y;
      pts.push(new THREE.Vector3(x, y + 0.06, z));
      wallPos.push(x, y, z, x, y + 1.6, z);
      wallUv.push(i / N, 0, i / N, 1);
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), this.lineMat);
    const wallGeo = new THREE.BufferGeometry();
    wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3));
    wallGeo.setAttribute('uv', new THREE.Float32BufferAttribute(wallUv, 2));
    const idx: number[] = [];
    for (let i = 0; i < N; i++) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    wallGeo.setIndex(idx);
    const wall = new THREE.Mesh(wallGeo, this.wallMat);
    wall.renderOrder = 11;
    this.group.add(line, wall);
    if (beam) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 40, 10, 1, true), this.beamMat);
      b.position.set(center.x, center.y + 20, center.z);
      b.renderOrder = 11;
      // Fade the beam out when you're close (it's for finding the spot from afar).
      b.onBeforeRender = (_r, _s, cam) => {
        const d = Math.hypot(cam.position.x - center.x, cam.position.z - center.z);
        this.beamMat.opacity = 0.18 * Math.min(1, Math.max(0, (d - 6) / 12));
      };
      this.group.add(b);
    }
    scene.add(this.group);
  }

  setColor(css: string): void {
    this.wallMat.color.set(css);
    this.lineMat.color.set(css);
    this.beamMat.color.set(css);
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }
}

/** A flag on a pole, in a team color; the cloth ripples. */
export class FlagVisual {
  readonly group = new THREE.Group();
  private cloth: THREE.Mesh;
  private base: Float32Array;

  constructor(scene: THREE.Scene, color: number) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.3, 6), new THREE.MeshStandardMaterial({ color: 0xc9ccd0, metalness: 0.7, roughness: 0.3 }));
    pole.position.y = 1.15;
    const geo = new THREE.PlaneGeometry(0.95, 0.6, 8, 4);
    geo.translate(0.5, 1.95, 0);
    this.base = (geo.getAttribute('position').array as Float32Array).slice();
    this.cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, side: THREE.DoubleSide, roughness: 0.8 }));
    this.cloth.castShadow = true;
    this.group.add(pole, this.cloth);
    scene.add(this.group);
  }

  /** Ripple the cloth (call every frame). */
  animate(t: number): void {
    const pos = this.cloth.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = this.base[i * 3];
      pos.setZ(i, Math.sin(t * 5 + x * 6) * 0.08 * x);
    }
    pos.needsUpdate = true;
    this.cloth.geometry.computeVertexNormals();
  }
}
