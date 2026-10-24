import * as THREE from 'three';
import type { SurfaceId } from '../assets/materials';
import type { BoxDef, PropDef } from './MapTypes';
import { seededRandom } from './terrain';

/**
 * Trees, bushes, rocks and logs: low-poly models (made in code) and the
 * simple boxes that make their solid parts (trunks, rocks, logs).
 *
 * Leaves and trunks come "pre-lit": their shading (darker inside and
 * underneath the crown, lighter on top) is painted into the vertex colors
 * here instead of being measured when the map loads, which keeps loading
 * quick with hundreds of trees.
 */

export interface PropPart {
  geo: THREE.BufferGeometry;
  material: SurfaceId;
  /** Shading already painted in (skip the light bake). */
  prebaked: boolean;
}

/** How far a prop reaches from its center (for spacing and the minimap). */
export function propRadius(p: PropDef): number {
  const s = p.size ?? 1;
  switch (p.kind) {
    case 'pine': return 2.6 * s;
    case 'tree': return 3 * s;
    case 'bush': return 1.1 * s;
    case 'rock': return 1.3 * s;
    case 'log': return 2.6 * s;
    case 'stump': return 0.45 * s;
  }
}

/** The solid parts (for walking, bullets and eyesight). y = where it stands. */
export function propSolids(p: PropDef, y: number): BoxDef[] {
  const s = p.size ?? 1;
  const box = (w: number, h: number, d: number, y0 = y - 0.6, x = p.x, z = p.z): BoxDef => ({ x, y: y0, z, w, h: h + (y - y0), d });
  switch (p.kind) {
    case 'pine': return [box(0.42 * s, 10 * s, 0.42 * s)];
    case 'tree': return [box(0.5 * s, 4.6 * s, 0.5 * s)];
    case 'bush': return [];
    case 'stump': return [box(0.8 * s, 0.55 * s, 0.8 * s)];
    case 'rock': {
      // The rock's footprint (an ellipse turned by rot), a bit inside its outline.
      const a = 1.2 * s * 0.8, b = 0.95 * s * 0.8, r = ((p.rot ?? 0) * Math.PI) / 180;
      const ex = Math.hypot(a * Math.cos(r), b * Math.sin(r)), ez = Math.hypot(a * Math.sin(r), b * Math.cos(r));
      return [box(ex * 2, 0.62 * s, ez * 2)];
    }
    case 'log': {
      // Several short boxes along the log, so a turned log is still a snug fit.
      const len = 5 * s, r = ((p.rot ?? 0) * Math.PI) / 180, n = Math.max(2, Math.round(len / 0.9));
      const out: BoxDef[] = [];
      for (let i = 0; i < n; i++) {
        const t = ((i + 0.5) / n - 0.5) * len;
        out.push(box(0.6 * s, 0.62 * s, 0.6 * s, y - 0.3, p.x + Math.cos(r) * t, p.z - Math.sin(r) * t));
      }
      return out;
    }
  }
}

/** Leaves low enough to hide someone behind them (from bots): [x, y, z, radius]. */
export function propFoliage(p: PropDef, y: number): [number, number, number, number][] {
  const s = p.size ?? 1;
  if (p.kind === 'bush') return [[p.x, y + 0.7 * s, p.z, 1.0 * s]];
  if (p.kind === 'pine') return [[p.x, y + 3.0 * s, p.z, 2.0 * s]];
  return [];
}

/**
 * The 3D model, in world position. `leafy`: leaves made of many leaf
 * clusters (cut-out cards) around a smaller core, instead of solid shapes.
 */
export function propGeometry(p: PropDef, y: number, leafy = false): PropPart[] {
  const s = p.size ?? 1;
  const rnd = seededRandom(Math.floor(Math.abs(p.x * 7919 + p.z * 104729)) + 17);
  const rot = ((p.rot ?? rnd() * 360) * Math.PI) / 180;
  const place = (g: THREE.BufferGeometry) => {
    g.rotateY(rot);
    g.translate(p.x, y, p.z);
    return g;
  };
  // A little color variation per plant.
  const tint = new THREE.Color(0.9 + rnd() * 0.2, 0.9 + rnd() * 0.2, 0.88 + rnd() * 0.14);
  switch (p.kind) {
    case 'pine': {
      // (No end caps: the top is inside the crown, the bottom in the ground.)
      const trunk = new THREE.CylinderGeometry(0.1 * s, 0.26 * s, 9.5 * s, 7, 1, true).toNonIndexed();
      trunk.translate(0, 4.75 * s - 0.3, 0);
      shadeByHeight(trunk, 0, 9.5 * s, 0.42, 0.75);
      const cones: THREE.BufferGeometry[] = [];
      const needleCards = new Cards(rnd);
      const tiers = 4;
      for (let i = 0; i < tiers; i++) {
        const r = (2.5 - i * 0.52) * s * (0.9 + rnd() * 0.2);
        const h = (3.3 - i * 0.35) * s;
        const base = (1.9 + i * 1.9) * s;
        const c = new THREE.ConeGeometry(r, h, 8, 2, true).toNonIndexed();
        c.rotateY(rnd() * Math.PI);
        c.translate(0, base + h / 2, 0);
        jitter(c, 0.22 * s, i + 3);
        c.computeVertexNormals();
        shadeByHeight(c, base, base + h, 0.38 + i * 0.06, 0.95);
        // Underside of each tier (a flat disc a little way up inside the cone, so it only shows from below).
        const under = new THREE.CircleGeometry(r * 0.8, 8).toNonIndexed();
        under.rotateX(Math.PI / 2);
        under.translate(0, base + h * 0.2, 0);
        setColor(under, 0.45);
        cones.push(c, under);
        if (leafy) {
          // Branches hanging out from under each tier, so the outline is feathery instead of a cone.
          const n = 9 - i;
          for (let k = 0; k < n; k++) {
            const a = ((k + rnd() * 0.6) / n) * Math.PI * 2;
            const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
            const root = dir.clone().multiplyScalar(r * 0.35).setY(base + h * 0.42);
            const tip = dir.clone().multiplyScalar(r * (1.12 + rnd() * 0.15)).setY(base - 0.15 * s);
            const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(r * 0.42 + 0.3 * s);
            needleCards.branch(root, tip, side, new THREE.Vector3(0, base + h * 0.3, 0), 0.4 + i * 0.07, 0.95, tint);
          }
        }
      }
      const crown = merge(cones);
      tintColors(crown, tint);
      const parts: PropPart[] = [
        { geo: place(trunk), material: 'bark', prebaked: true },
        { geo: place(crown), material: 'needles', prebaked: true },
      ];
      if (leafy) parts.push({ geo: place(needleCards.build()), material: 'needleCard', prebaked: true });
      return parts;
    }
    case 'tree': {
      const H = 4.6 * s;
      const parts: THREE.BufferGeometry[] = [];
      const trunk = new THREE.CylinderGeometry(0.17 * s, 0.32 * s, H + 0.6, 7, 1, true).toNonIndexed();
      trunk.translate(0, H / 2 - 0.3, 0);
      parts.push(trunk);
      // Two branches leaning out.
      for (const a of [0.6, -0.7]) {
        const br = new THREE.CylinderGeometry(0.07 * s, 0.13 * s, 2.2 * s, 5, 1, true).toNonIndexed();
        br.translate(0, 1.1 * s, 0);
        br.rotateZ(a);
        br.rotateY(rnd() * Math.PI * 2);
        br.translate(0, H * 0.62, 0);
        parts.push(br);
      }
      const wood = merge(parts);
      shadeByHeight(wood, 0, H * 1.3, 0.45, 0.72);
      const blobs: THREE.BufferGeometry[] = [];
      const leaves = new Cards(rnd);
      const n = 3;
      for (let i = 0; i < n; i++) {
        const r = (1.8 + rnd() * 0.9) * s;
        // With leaf clusters, the solid core is smaller (it only stops you seeing straight through).
        const b = new THREE.IcosahedronGeometry(r * (leafy ? 0.6 : 1), 1);
        const a = (i / n) * Math.PI * 2 + rnd();
        const off = i === 0 ? 0 : 1.3 * s;
        const c = new THREE.Vector3(Math.cos(a) * off, H + (i === 0 ? 1.6 : 0.7 + rnd()) * s, Math.sin(a) * off);
        b.scale(1, 0.78, 1);
        b.translate(c.x, c.y, c.z);
        jitter(b, 0.28 * s, i + 11);
        b.computeVertexNormals();
        blobs.push(b);
        if (leafy) leaves.cluster(c, r, 0.78, 44, 1.75 * s, H - 1.2 * s, H + 3.6 * s, tint);
      }
      const crown = merge(blobs);
      shadeByHeight(crown, H - 1.2 * s, H + 3.6 * s, leafy ? 0.3 : 0.4, leafy ? 0.75 : 1.0);
      tintColors(crown, tint);
      const out: PropPart[] = [
        { geo: place(wood), material: 'bark', prebaked: true },
        { geo: place(crown), material: 'foliage', prebaked: true },
      ];
      if (leafy) out.push({ geo: place(leaves.build()), material: 'leafCard', prebaked: true });
      return out;
    }
    case 'bush': {
      const blobs: THREE.BufferGeometry[] = [];
      const leaves = new Cards(rnd);
      const n = 4;
      for (let i = 0; i < n; i++) {
        const r = (0.48 + rnd() * 0.28) * s;
        const b = new THREE.DodecahedronGeometry(r * (leafy ? 0.75 : 1), 0);
        b.scale(1, 0.8, 1);
        const a = (i / n) * Math.PI * 2 + rnd(), off = i === 0 ? 0 : 0.55 * s;
        const c = new THREE.Vector3(Math.cos(a) * off, r * (i === 0 ? 1.1 : 0.7), Math.sin(a) * off);
        b.translate(c.x, c.y, c.z);
        jitter(b, 0.22 * s, i + 23);
        b.computeVertexNormals();
        blobs.push(b);
        if (leafy) leaves.cluster(c, r * 1.05, 0.8, 7, 0.75 * s, 0, 1.3 * s, tint, true);
      }
      const g = merge(blobs);
      shadeByHeight(g, 0, 1.3 * s, leafy ? 0.35 : 0.45, leafy ? 0.8 : 1.1);
      tintColors(g, tint);
      const parts: PropPart[] = [{ geo: place(g), material: 'foliage', prebaked: true }];
      if (leafy) parts.push({ geo: place(leaves.build()), material: 'leafCard', prebaked: true });
      return parts;
    }
    case 'rock': {
      const g = new THREE.IcosahedronGeometry(1, 1);
      jitter(g, 0.28, 31 + Math.floor(rnd() * 100));
      g.scale(1.2 * s, 0.75 * s, 0.95 * s);
      g.translate(0, 0.05 * s, 0);
      g.computeVertexNormals();
      // Rocks are lit by the normal bake (so they get contact shadows on the ground).
      g.rotateY(rot);
      g.translate(p.x, y, p.z);
      return [{ geo: g, material: 'rock', prebaked: false }];
    }
    case 'log': {
      const len = 5 * s, r = 0.34 * s;
      const g = new THREE.CylinderGeometry(r, r * 1.1, len, 8, 1).toNonIndexed();
      g.rotateZ(Math.PI / 2);
      jitter(g, 0.04 * s, 41);
      g.computeVertexNormals();
      g.translate(0, r * 0.9, 0);
      shadeByHeight(g, 0, r * 2, 0.5, 0.85);
      const turned = ((p.rot ?? 0) * Math.PI) / 180;
      g.rotateY(turned);
      g.translate(p.x, y, p.z);
      return [{ geo: g, material: 'bark', prebaked: true }];
    }
    case 'stump': {
      const g = new THREE.CylinderGeometry(0.36 * s, 0.45 * s, 0.85 * s, 8, 1).toNonIndexed();
      g.translate(0, 0.42 * s - 0.3, 0);
      shadeByHeight(g, -0.3, 0.6 * s, 0.45, 0.85);
      return [{ geo: place(g), material: 'bark', prebaked: true }];
    }
  }
}

/**
 * Flat cut-out cards (leaf clusters, pine branches), with normals pointing
 * out of the plant's crown so they light like one soft, rounded shape.
 */
class Cards {
  private pos: number[] = [];
  private nrm: number[] = [];
  private col: number[] = [];
  private uv: number[] = [];
  constructor(private rnd: () => number) {}

  private quad(c: THREE.Vector3[], center: THREE.Vector3, shade: (p: THREE.Vector3) => number, tint: THREE.Color, flip: boolean): void {
    const uvs = flip ? [[1, 0], [0, 0], [0, 1], [1, 1]] : [[0, 0], [1, 0], [1, 1], [0, 1]];
    const n = new THREE.Vector3();
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const p = c[k];
      this.pos.push(p.x, p.y, p.z);
      n.subVectors(p, center).normalize();
      n.y = n.y * 0.8 + 0.25;
      n.normalize();
      this.nrm.push(n.x, n.y, n.z);
      const v = shade(p);
      this.col.push(v * tint.r, v * tint.g, v * tint.b);
      this.uv.push(uvs[k][0], uvs[k][1]);
    }
  }

  /** Leaf clusters spread over an egg-shaped crown (center c, radius r, squashed by sy). */
  cluster(c: THREE.Vector3, r: number, sy: number, count: number, size: number, y0: number, y1: number, tint: THREE.Color, low = false): void {
    const rnd = this.rnd;
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < count; i++) {
      // A point on (or a little inside) the crown; more of them on top and around than underneath.
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2;
      const yy = low ? Math.abs(u) * 0.9 + 0.1 : u;
      const d = new THREE.Vector3(Math.sqrt(1 - yy * yy) * Math.cos(a), yy, Math.sqrt(1 - yy * yy) * Math.sin(a));
      const k = 0.62 + rnd() * 0.42;
      const p = new THREE.Vector3(c.x + d.x * r * k, c.y + d.y * r * sy * k, c.z + d.z * r * k);
      // Facing roughly outward, but each at its own angle.
      const n = d.clone().add(new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(1.4)).normalize();
      const t1 = new THREE.Vector3().crossVectors(Math.abs(n.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : up, n).normalize();
      const t2 = new THREE.Vector3().crossVectors(n, t1);
      const spin = rnd() * Math.PI * 2, cs = Math.cos(spin), sn = Math.sin(spin);
      const e1 = t1.clone().multiplyScalar(cs).addScaledVector(t2, sn).multiplyScalar(size * (0.85 + rnd() * 0.3) / 2);
      const e2 = t2.clone().multiplyScalar(cs).addScaledVector(t1, -sn).multiplyScalar(size * (0.85 + rnd() * 0.3) / 2);
      const corners = [
        p.clone().sub(e1).sub(e2), p.clone().add(e1).sub(e2), p.clone().add(e1).add(e2), p.clone().sub(e1).add(e2),
      ];
      // Darker deep inside and underneath, brighter on the outside and on top.
      const shade = (q: THREE.Vector3) => {
        const h = Math.min(1, Math.max(0, (q.y - y0) / (y1 - y0)));
        const out = Math.min(1.15, q.distanceTo(c) / r);
        return (0.5 + 0.5 * h) * (0.6 + 0.4 * out);
      };
      this.quad(corners, c, shade, tint, rnd() < 0.5);
    }
  }

  /** A hanging branch card from root to tip, `side` = half its width. */
  branch(root: THREE.Vector3, tip: THREE.Vector3, side: THREE.Vector3, center: THREE.Vector3, dark: number, light: number, tint: THREE.Color): void {
    const corners = [root.clone().sub(side.clone().multiplyScalar(0.5)), tip.clone().sub(side), tip.clone().add(side), root.clone().add(side.clone().multiplyScalar(0.5))];
    // Darker where it comes out of the tree. (The texture's stem runs along u, from root to tip.)
    const shade = (q: THREE.Vector3) => (q === corners[0] || q === corners[3] ? dark : light);
    this.quad(corners, center, shade, tint, false);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

/** Move each corner a little (the same corner always moves the same way, so faces stay joined). */
function jitter(g: THREE.BufferGeometry, amount: number, seed: number): void {
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = Math.round(x * 997) * 73856093 ^ Math.round(y * 997) * 19349663 ^ Math.round(z * 997) * 83492791 ^ (seed * 2654435761);
    const r = seededRandom(Math.abs(k) + 1);
    pos.setXYZ(i, x + (r() - 0.5) * amount, y + (r() - 0.5) * amount, z + (r() - 0.5) * amount);
  }
}

/** Vertex shading from dark (at y0) to light (at y1). */
function shadeByHeight(g: THREE.BufferGeometry, y0: number, y1: number, dark: number, light: number): void {
  const pos = g.getAttribute('position');
  const c = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (pos.getY(i) - y0) / (y1 - y0)));
    const v = dark + (light - dark) * t;
    c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
}

function setColor(g: THREE.BufferGeometry, v: number): void {
  const n = g.getAttribute('position').count;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(v), 3));
}

function tintColors(g: THREE.BufferGeometry, tint: THREE.Color): void {
  const c = g.getAttribute('color');
  for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * tint.r, c.getY(i) * tint.g, c.getZ(i) * tint.b);
}

/** Merge pieces (all non-indexed, positions + normals + colors). */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], col: number[] = [];
  for (const p of parts) {
    const g = p.index ? p.toNonIndexed() : p;
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const P = g.getAttribute('position'), N = g.getAttribute('normal'), C = g.getAttribute('color');
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i));
      nrm.push(N.getX(i), N.getY(i), N.getZ(i));
      if (C) col.push(C.getX(i), C.getY(i), C.getZ(i));
      else col.push(1, 1, 1);
    }
    g.dispose();
    if (g !== p) p.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}
