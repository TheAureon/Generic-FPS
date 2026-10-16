import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getMaterial, getTileSize } from '../assets/materials';
import { CollisionWorld } from '../core/CollisionWorld';
import { currentQuality } from '../render/quality';
import type { LampDef, MapDef, MaterialId } from './MapTypes';

export interface BuiltMap {
  def: MapDef;
  group: THREE.Group;
  world: CollisionWorld;
  bounds: THREE.Box3;
  /** How much lamp light reaches a point (for lighting characters). */
  sampleLampLight(p: THREE.Vector3, out: THREE.Color): THREE.Color;
}

/** Size of the lighting "tiles" baked onto surfaces (meters). Smaller = finer, slower to load. */
const BAKE_CELL = 1.0;
/** Rays per tile corner used to measure how enclosed it is (ambient occlusion). */
const AO_RAYS = 12;
const AO_DISTANCE = 1.5;
const AO_STRENGTH = 0.85;
/** Overall brightness of baked lamp light. */
const LAMP_STRENGTH = 0.75;

/**
 * Baking takes a moment, so results are kept per map and reused (by the
 * menu background and every later match on the same map).
 */
const bakeCache = new Map<string, { geos: Map<MaterialId, THREE.BufferGeometry>; bounds: THREE.Box3 }>();

type V3 = [number, number, number];
interface Quad {
  corners: [V3, V3, V3, V3];
  material: MaterialId;
}

/**
 * Turns a MapDef (plain data) into 3D meshes + collision data, with the
 * lighting (corner shading and lamp light) baked into the surfaces.
 */
export function buildMap(def: MapDef, scene: THREE.Scene): BuiltMap {
  const quality = currentQuality();
  const group = new THREE.Group();
  group.name = `map:${def.id}`;
  const world = new CollisionWorld();
  const bounds = new THREE.Box3();
  const quads: Quad[] = [];

  // ---- Collect every surface as a 4-cornered face ---------------------------
  for (const b of def.boxes) {
    world.addBox(b);
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, y0 = b.y, y1 = b.y + b.h, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
    const mat = b.material ?? 'concrete';
    pushBoxQuads(quads, x0, x1, y0, y1, z0, z1, () => [y1, y1, y1, y1], mat, y0 <= 0.01);
  }
  for (const r of def.ramps) {
    world.addRamp(r);
    const ramp = world.ramps[world.ramps.length - 1];
    const h = (x: number, z: number) => world.rampHeightAt(ramp, x, z);
    const { minX: x0, maxX: x1, minZ: z0, maxZ: z1, minY: y0 } = ramp;
    pushBoxQuads(quads, x0, x1, y0, 0, z0, z1, () => [h(x0, z0), h(x0, z1), h(x1, z1), h(x1, z0)], r.material ?? 'metal', y0 <= 0.01);
  }

  // ---- Tessellate, bake, and group by material (or reuse an earlier bake) -----
  const lamps = def.lamps ?? [];
  const lampPos = lamps.map((l) => lightOrigin(l));
  let baked = bakeCache.get(def.id);
  if (!baked) {
    const byMaterial = new Map<MaterialId, THREE.BufferGeometry[]>();
    const aoDirs = hemisphereDirections(AO_RAYS);
    for (const q of quads) {
      if (!faceNormal(q.corners)) continue; // zero-area face (e.g. the thin end of a ramp)
      const geo = tessellate(q.corners);
      bake(geo, world, aoDirs, lamps, lampPos);
      applyWorldUVs(geo, getTileSize(q.material));
      if (!byMaterial.has(q.material)) byMaterial.set(q.material, []);
      byMaterial.get(q.material)!.push(geo);
      geo.computeBoundingBox();
      bounds.union(geo.boundingBox!);
    }
    // One mesh per material keeps draw calls low (good for frame rate).
    const geos = new Map<MaterialId, THREE.BufferGeometry>();
    for (const [mat, list] of byMaterial) {
      const merged = mergeGeometries(list, false);
      merged.userData.cached = true; // shared between matches: don't dispose
      geos.set(mat, merged);
      for (const g of list) g.dispose();
    }
    bakeCache.set(def.id, (baked = { geos, bounds: bounds.clone() }));
  }
  bounds.copy(baked.bounds);

  for (const [mat, geo] of baked.geos) {
    const mesh = new THREE.Mesh(geo, getMaterial(mat, quality.materials));
    // Thin decorative trim doesn't need to cast shadows (one less thing to draw into the shadow map).
    mesh.castShadow = mat !== 'trim';
    mesh.receiveShadow = true;
    mesh.name = `map-${mat}`;
    mesh.userData.mapSurface = mat;
    group.add(mesh);
  }

  if (lamps.length) group.add(buildLampFixtures(lamps));
  addSunAndSky(group, bounds, quality.shadowMapSize);
  scene.background = new THREE.Color(def.skyColor);
  scene.fog = new THREE.Fog(def.skyColor, def.fogNear, def.fogFar);
  scene.add(group);

  const sampleLampLight = (p: THREE.Vector3, out: THREE.Color): THREE.Color => {
    out.setRGB(0, 0, 0);
    lamps.forEach((l, i) => {
      const o = lampPos[i];
      const d = Math.hypot(o[0] - p.x, o[1] - p.y, o[2] - p.z);
      if (d >= l.range || !world.hasLineOfSight(p.x, p.y, p.z, o[0], o[1], o[2])) return;
      const a = falloff(d, l.range) * l.intensity * 0.55;
      out.r += ((l.color >> 16) & 255) / 255 * a;
      out.g += ((l.color >> 8) & 255) / 255 * a;
      out.b += (l.color & 255) / 255 * a;
    });
    return out;
  };

  return { def, group, world, bounds, sampleLampLight };
}

/**
 * The 6 faces of a box (or a ramp, whose top corners have different heights).
 * Bottom faces resting on the ground are skipped (nobody can see them).
 */
function pushBoxQuads(
  out: Quad[], x0: number, x1: number, y0: number, _y1: number, z0: number, z1: number,
  tops: () => [number, number, number, number], material: MaterialId, skipBottom: boolean,
): void {
  // Top heights at corners (x0,z0), (x0,z1), (x1,z1), (x1,z0).
  const [t00, t01, t11, t10] = tops();
  const c = {
    b00: [x0, y0, z0] as V3, b10: [x1, y0, z0] as V3, b11: [x1, y0, z1] as V3, b01: [x0, y0, z1] as V3,
    u00: [x0, t00, z0] as V3, u10: [x1, t10, z0] as V3, u11: [x1, t11, z1] as V3, u01: [x0, t01, z1] as V3,
  };
  out.push({ corners: [c.u00, c.u01, c.u11, c.u10], material }); // top
  if (!skipBottom) out.push({ corners: [c.b00, c.b10, c.b11, c.b01], material }); // bottom
  out.push({ corners: [c.b00, c.u00, c.u10, c.b10], material }); // -z
  out.push({ corners: [c.b01, c.b11, c.u11, c.u01], material }); // +z
  out.push({ corners: [c.b00, c.b01, c.u01, c.u00], material }); // -x
  out.push({ corners: [c.b10, c.u10, c.u11, c.b11], material }); // +x
}

/** Split a face into a grid of roughly BAKE_CELL-sized tiles. */
function tessellate([a, b, c, d]: [V3, V3, V3, V3]): THREE.BufferGeometry {
  const len = (p: V3, q: V3) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
  const nu = Math.min(64, Math.max(1, Math.round(Math.max(len(a, d), len(b, c)) / BAKE_CELL)));
  const nv = Math.min(64, Math.max(1, Math.round(Math.max(len(a, b), len(d, c)) / BAKE_CELL)));
  const pos: number[] = [];
  for (let i = 0; i <= nu; i++) {
    const s = i / nu;
    for (let j = 0; j <= nv; j++) {
      const t = j / nv;
      // Bilinear blend of the 4 corners (a→b along t at s=0, d→c at s=1).
      for (let k = 0; k < 3; k++) {
        const ab = a[k] + (b[k] - a[k]) * t;
        const dc = d[k] + (c[k] - d[k]) * t;
        pos.push(ab + (dc - ab) * s);
      }
    }
  }
  const idx: number[] = [];
  const at = (i: number, j: number) => i * (nv + 1) + j;
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) idx.push(at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i + 1, j));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  // Flat face normal (from the diagonals, which also works for faces that taper to a point).
  const n = faceNormal([a, b, c, d])!;
  const normals = new Float32Array((pos.length / 3) * 3);
  for (let i = 0; i < normals.length; i += 3) normals.set([n.x, n.y, n.z], i);
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return geo;
}

/** Normal of a 4-cornered face, or null if it has no area. */
function faceNormal([a, b, c, d]: [V3, V3, V3, V3]): THREE.Vector3 | null {
  const d1 = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const d2 = new THREE.Vector3(d[0] - b[0], d[1] - b[1], d[2] - b[2]);
  const n = d1.cross(d2);
  return n.lengthSq() < 1e-8 ? null : n.normalize();
}

/** Evenly spread directions over a hemisphere around +Z (more of them near the top). */
function hemisphereDirections(n: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n); // cosine-weighted
    const a = i * golden;
    out.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, Math.sqrt(1 - r * r)));
  }
  return out;
}

const falloff = (d: number, range: number) => {
  const k = 1 - (d / range) * (d / range);
  return k * k;
};

/** Where a lamp's light comes from: a little out from the wall it's mounted on. */
function lightOrigin(l: LampDef): V3 {
  const o = 0.35;
  switch (l.facing) {
    case '+x': return [l.x + o, l.y, l.z];
    case '-x': return [l.x - o, l.y, l.z];
    case '+z': return [l.x, l.y, l.z + o];
    case '-z': return [l.x, l.y, l.z - o];
    default: return [l.x, l.y - o, l.z];
  }
}

/**
 * Bake lighting into each tile corner:
 * - color = ambient occlusion (how open the spot is: corners and contact spots get darker)
 * - aLight = light from lamps (with walls blocking it)
 */
function bake(geo: THREE.BufferGeometry, world: CollisionWorld, dirs: THREE.Vector3[], lamps: LampDef[], lampPos: V3[]): void {
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const colors = new Float32Array(pos.count * 3);
  const light = new Float32Array(pos.count * 3);
  const n = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), d = new THREE.Vector3();
  const lampColors = lamps.map((l) => new THREE.Color(l.color));

  for (let i = 0; i < pos.count; i++) {
    n.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    const px = pos.getX(i) + n.x * 0.03, py = pos.getY(i) + n.y * 0.03, pz = pos.getZ(i) + n.z * 0.03;

    // A corner buried inside another box (e.g. floor under a wall) is fully
    // dark; blending toward it gives a soft contact shadow at the wall base.
    if (world.isInsideSolid(px, py, pz, -0.005)) {
      colors.set([0.28, 0.28, 0.28], i * 3);
      continue;
    }

    // Ambient occlusion: shoot short rays outward and see how many hit something.
    t1.set(Math.abs(n.y) < 0.9 ? 0 : 1, Math.abs(n.y) < 0.9 ? 1 : 0, 0).cross(n).normalize();
    t2.crossVectors(n, t1);
    let occlusion = 0;
    for (const dir of dirs) {
      d.copy(t1).multiplyScalar(dir.x).addScaledVector(t2, dir.y).addScaledVector(n, dir.z);
      const hit = world.raycast(px, py, pz, d.x, d.y, d.z, AO_DISTANCE);
      if (hit) occlusion += 1 - hit.distance / AO_DISTANCE;
    }
    const ao = Math.max(0.3, 1 - (AO_STRENGTH * occlusion) / dirs.length);
    colors.set([ao, ao, ao], i * 3);

    // Lamp light, if the lamp can "see" this spot.
    let r = 0, g = 0, b = 0;
    lamps.forEach((l, k) => {
      const o = lampPos[k];
      const lx = o[0] - px, ly = o[1] - py, lz = o[2] - pz;
      const dist = Math.hypot(lx, ly, lz);
      if (dist >= l.range) return;
      const ndl = (n.x * lx + n.y * ly + n.z * lz) / dist;
      if (ndl <= 0 || !world.hasLineOfSight(px, py, pz, o[0], o[1], o[2])) return;
      const a = falloff(dist, l.range) * ndl * l.intensity * LAMP_STRENGTH;
      r += lampColors[k].r * a;
      g += lampColors[k].g * a;
      b += lampColors[k].b * a;
    });
    light.set([r, g, b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aLight', new THREE.BufferAttribute(light, 3));
}

/** The visible lamp fixtures: a dark housing with a glowing panel. */
function buildLampFixtures(lamps: LampDef[]): THREE.Group {
  const housings: THREE.BufferGeometry[] = [];
  const panels: THREE.BufferGeometry[] = [];
  const panelColors: number[] = [];
  for (const l of lamps) {
    const wall = l.facing === 'down';
    const along = l.facing === '+x' || l.facing === '-x';
    // Housing: flat box against the wall (or ceiling).
    const hw = wall ? 0.7 : along ? 0.14 : 0.6;
    const hh = wall ? 0.1 : 0.3;
    const hd = wall ? 0.7 : along ? 0.6 : 0.14;
    const h = new THREE.BoxGeometry(hw, hh, hd).toNonIndexed();
    h.translate(l.x, l.y, l.z);
    housings.push(h);
    // Panel: slightly in front of the housing, glowing.
    const p = new THREE.BoxGeometry(hw * 0.8 + (along ? 0.02 : 0), hh * 0.6, hd * 0.8 + (along ? 0 : 0.02)).toNonIndexed();
    const off = 0.06;
    const dx = l.facing === '+x' ? off : l.facing === '-x' ? -off : 0;
    const dz = l.facing === '+z' ? off : l.facing === '-z' ? -off : 0;
    p.translate(l.x + dx, l.y - (wall ? 0.04 : 0), l.z + dz);
    const c = new THREE.Color(l.color).multiplyScalar(2.5 + l.intensity);
    const count = p.getAttribute('position').count;
    for (let i = 0; i < count; i++) panelColors.push(c.r, c.g, c.b);
    panels.push(p);
  }
  const g = new THREE.Group();
  g.name = 'lamps';
  const housing = new THREE.Mesh(mergeGeometries(housings), new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.6, metalness: 0.4 }));
  const panelGeo = mergeGeometries(panels);
  panelGeo.setAttribute('color', new THREE.Float32BufferAttribute(panelColors, 3));
  // Bright (over 1.0) colors: on High graphics these glow (bloom).
  const panel = new THREE.Mesh(panelGeo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }));
  g.add(housing, panel);
  return g;
}

/** Sky light + the sun (with shadows sized for the graphics setting). */
function addSunAndSky(group: THREE.Group, bounds: THREE.Box3, shadowMapSize: number): void {
  group.add(new THREE.HemisphereLight(0xdde8ff, 0x4a4036, 1.0));

  const sun = new THREE.DirectionalLight(0xfff1dd, 2.0);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.z) * 0.62;
  sun.position.set(center.x + radius * 0.5, center.y + radius, center.z + radius * 0.35);
  sun.target.position.copy(center);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  const cam = sun.shadow.camera;
  cam.left = -radius; cam.right = radius; cam.top = radius; cam.bottom = -radius;
  cam.near = 1; cam.far = radius * 4;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  group.add(sun, sun.target);
}

/**
 * Sets texture coordinates from world position so textures tile evenly
 * regardless of how big each box is.
 */
function applyWorldUVs(geo: THREE.BufferGeometry, tile: number): void {
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i));
    let u: number, v: number;
    if (ny >= nx && ny >= nz) { u = x; v = z; }
    else if (nx >= nz) { u = z; v = y; }
    else { u = x; v = y; }
    uv[i * 2] = u / tile;
    uv[i * 2 + 1] = v / tile;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
