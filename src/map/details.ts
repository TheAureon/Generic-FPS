import * as THREE from 'three';
import type { BoxDef, RampDef } from './MapTypes';

/**
 * Extra 3D detail added on top of the map's plain boxes (looks only: what
 * you collide with and shoot at is unchanged, except jersey barriers, which
 * get a matching two-step collision shape):
 * - real bricks sticking out of brick walls, with mortar gaps between them
 * - cast concrete panels with seams and form-tie holes on concrete walls
 * - wooden crates with a frame, diagonal braces and planks
 * - jersey barriers (the sloped concrete road barriers)
 */

export type V3 = [number, number, number];
export type Corners = [V3, V3, V3, V3];

/** Reads baked lighting (corner shading + lamp light) at a point on a baked face. */
export type LightSampler = (p: THREE.Vector3, ao: THREE.Color, light: THREE.Color) => void;

export interface ReliefLayout {
  /** Size of one unit (brick/panel) including the gap, in meters. */
  unitW: number;
  unitH: number;
  gap: number;
  /** How far units stick out of the wall. */
  depth: number;
  /** Shift every other row by this fraction of a unit (0.5 = brick bond). */
  bond: number;
  /** Color variation per unit (multiplies the texture). */
  tint: (rand: () => number) => [number, number, number];
  /** Small dark form-tie holes on each unit (concrete). */
  tieHoles?: boolean;
}

export const BRICKS: ReliefLayout = {
  unitW: 0.5,
  unitH: 0.2,
  gap: 0.026,
  depth: 0.022,
  bond: 0.5,
  tint: (r) => {
    const k = 0.8 + r() * 0.3;
    const warm = r() * 0.12;
    return [k * (1 + warm * 0.3), k * (1 - warm * 0.4), k * (1 - warm * 0.6)];
  },
};

export const CONCRETE_PANELS: ReliefLayout = {
  unitW: 2.0,
  unitH: 1.0,
  gap: 0.035,
  depth: 0.014,
  bond: 0,
  tint: (r) => {
    const k = 0.9 + r() * 0.13;
    return [k, k, k * (0.98 + r() * 0.04)];
  },
  tieHoles: true,
};

/** Simple repeatable random numbers (so the map looks the same every time). */
function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Collects quads into an indexed geometry with color + lamp light. */
class QuadBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  light: number[] = [];
  idx: number[] = [];

  /** Four corners in order around the quad; flipped automatically to face `n`. */
  quad(p: THREE.Vector3[], n: THREE.Vector3, cols: THREE.Color[], lights: THREE.Color[]): void {
    const base = this.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      this.pos.push(p[i].x, p[i].y, p[i].z);
      this.nrm.push(n.x, n.y, n.z);
      this.col.push(cols[i].r, cols[i].g, cols[i].b);
      this.light.push(lights[i].r, lights[i].g, lights[i].b);
    }
    const e1 = _e1.subVectors(p[1], p[0]), e2 = _e2.subVectors(p[2], p[0]);
    const facing = e1.cross(e2).dot(n) > 0;
    if (facing) this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }

  build(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aLight', new THREE.Float32BufferAttribute(this.light, 3));
    g.setIndex(this.idx);
    return g;
  }
}
const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3();

/** Long walls are cut into pieces this long (m), so parts out of view aren't drawn. */
const CHUNK = 12;

/**
 * Bricks or panels on one vertical wall face. Lighting comes from the face's
 * own bake (so thousands of bricks cost no extra baking time).
 * `covered(x,y,z)` says whether a spot is hidden inside another box.
 * Returns one geometry per CHUNK-long stretch of wall.
 */
export function relief(
  corners: Corners, normal: THREE.Vector3, layout: ReliefLayout, sample: LightSampler,
  covered: (x: number, y: number, z: number) => boolean,
): THREE.BufferGeometry[] {
  if (Math.abs(normal.y) > 0.1) return []; // walls only
  const alongX = Math.abs(normal.z) > Math.abs(normal.x); // face runs along X (normal is ±Z)
  const us = corners.map((c) => (alongX ? c[0] : c[2]));
  const ys = corners.map((c) => c[1]);
  const u0 = Math.min(...us), u1 = Math.max(...us), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const plane = alongX ? corners[0][2] : corners[0][0];
  const U = alongX ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const Y = new THREE.Vector3(0, 1, 0);
  const at = (u: number, y: number, depth: number, out: THREE.Vector3) =>
    alongX ? out.set(u, y, plane + normal.z * depth) : out.set(plane + normal.x * depth, y, u);

  const chunks: QuadBuilder[] = [];
  const { unitW, unitH, gap, depth } = layout;
  const P = [0, 1, 2, 3, 4, 5, 6, 7].map(() => new THREE.Vector3());
  const ao = [0, 1, 2, 3].map(() => new THREE.Color());
  const li = [0, 1, 2, 3].map(() => new THREE.Color());
  const aoSide = [0, 1, 2, 3].map(() => new THREE.Color());
  const dark = [0, 1, 2, 3].map(() => new THREE.Color());
  const mU = U.clone().negate(), mY = Y.clone().negate();
  const tmp = new THREE.Vector3();

  for (let r = Math.floor(y0 / unitH); r * unitH < y1 - 0.01; r++) {
    const ya = Math.max(y0, r * unitH + gap / 2);
    const yb = Math.min(y1, (r + 1) * unitH - gap / 2);
    if (yb - ya < 0.04) continue;
    const off = (((r % 2) + 2) % 2) * layout.bond * unitW;
    for (let k = Math.floor((u0 - off) / unitW); off + k * unitW < u1 - 0.01; k++) {
      const ua = Math.max(u0, off + k * unitW + gap / 2);
      const ub = Math.min(u1, off + (k + 1) * unitW - gap / 2);
      if (ub - ua < 0.05) continue;
      at((ua + ub) / 2, (ya + yb) / 2, 0.05, tmp);
      if (covered(tmp.x, tmp.y, tmp.z)) continue;

      const ci = Math.floor((ua - u0) / CHUNK);
      const qb = (chunks[ci] ??= new QuadBuilder());
      const rand = seeded(Math.floor(plane * 997) * 73856093 ^ r * 19349663 ^ k * 83492791);
      const [tr, tg, tb] = layout.tint(rand);
      // Corners: back (on the wall) 0-3, front 4-7, order (ua,ya) (ub,ya) (ub,yb) (ua,yb).
      const uv: [number, number][] = [[ua, ya], [ub, ya], [ub, yb], [ua, yb]];
      for (let i = 0; i < 4; i++) {
        at(uv[i][0], uv[i][1], 0, P[i]);
        at(uv[i][0], uv[i][1], depth, P[i + 4]);
        sample(P[i], ao[i], li[i]);
        ao[i].setRGB(ao[i].r * tr, ao[i].g * tg, ao[i].b * tb);
        aoSide[i].copy(ao[i]).multiplyScalar(0.82);
      }
      qb.quad([P[4], P[5], P[6], P[7]], normal, ao, li); // front
      qb.quad([P[0], P[1], P[5], P[4]], mY, [aoSide[0], aoSide[1], aoSide[1], aoSide[0]], [li[0], li[1], li[1], li[0]]); // bottom
      qb.quad([P[3], P[2], P[6], P[7]], Y, [aoSide[3], aoSide[2], aoSide[2], aoSide[3]], [li[3], li[2], li[2], li[3]]); // top
      qb.quad([P[0], P[3], P[7], P[4]], mU, [aoSide[0], aoSide[3], aoSide[3], aoSide[0]], [li[0], li[3], li[3], li[0]]); // left
      qb.quad([P[1], P[2], P[6], P[5]], U, [aoSide[1], aoSide[2], aoSide[2], aoSide[1]], [li[1], li[2], li[2], li[1]]); // right

      if (layout.tieHoles) {
        // Four little dark dimples where the concrete forms were tied together.
        const s = 0.014;
        for (const [fu, fy] of [[0.18, 0.25], [0.82, 0.25], [0.18, 0.75], [0.82, 0.75]]) {
          const cu = ua + (ub - ua) * fu, cy = ya + (yb - ya) * fy;
          if (cu - s < ua || cu + s > ub) continue;
          at(cu - s, cy - s, depth + 0.002, P[0]);
          at(cu + s, cy - s, depth + 0.002, P[1]);
          at(cu + s, cy + s, depth + 0.002, P[2]);
          at(cu - s, cy + s, depth + 0.002, P[3]);
          for (let i = 0; i < 4; i++) dark[i].copy(ao[i]).multiplyScalar(0.45);
          qb.quad([P[0], P[1], P[2], P[3]], normal, dark, li);
        }
      }
    }
  }
  return chunks.map((c) => c?.build()).filter((g): g is THREE.BufferGeometry => !!g);
}

/** Bilinear lookup into a baked face grid (made by MapBuilder's tessellate). */
export function faceSampler(corners: Corners, geo: THREE.BufferGeometry, nu: number, nv: number): LightSampler {
  const [a, b, , d] = corners;
  const eb = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const ed = new THREE.Vector3(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
  const lb = eb.lengthSq() || 1, ld = ed.lengthSq() || 1;
  const col = geo.getAttribute('color'), light = geo.getAttribute('aLight');
  const rel = new THREE.Vector3();
  return (p, ao, li) => {
    rel.set(p.x - a[0], p.y - a[1], p.z - a[2]);
    const t = THREE.MathUtils.clamp(rel.dot(eb) / lb, 0, 1) * nv;
    const s = THREE.MathUtils.clamp(rel.dot(ed) / ld, 0, 1) * nu;
    const i0 = Math.min(nu - 1, Math.floor(s)), j0 = Math.min(nv - 1, Math.floor(t));
    const fs = s - i0, ft = t - j0;
    const idx = (i: number, j: number) => i * (nv + 1) + j;
    const w = [(1 - fs) * (1 - ft), (1 - fs) * ft, fs * ft, fs * (1 - ft)];
    const ids = [idx(i0, j0), idx(i0, j0 + 1), idx(i0 + 1, j0 + 1), idx(i0 + 1, j0)];
    ao.setRGB(0, 0, 0);
    li.setRGB(0, 0, 0);
    for (let k = 0; k < 4; k++) {
      ao.r += col.getX(ids[k]) * w[k];
      ao.g += col.getY(ids[k]) * w[k];
      ao.b += col.getZ(ids[k]) * w[k];
      li.r += light.getX(ids[k]) * w[k];
      li.g += light.getY(ids[k]) * w[k];
      li.b += light.getZ(ids[k]) * w[k];
    }
  };
}

// ---- Crates ---------------------------------------------------------------------

const BATTEN = 0.11; // width of the frame boards
const PROUD = 0.025; // how far they stick out of the crate's sides

/** The frame, braces and corner boards of a wooden crate (its sides are the box itself). */
export function crateFrame(b: BoxDef): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, y0 = b.y, y1 = b.y + b.h, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
  const t = PROUD, w = BATTEN;
  const add = (ax: number, bx: number, ay: number, by: number, az: number, bz: number) => {
    const g = new THREE.BoxGeometry(bx - ax, by - ay, bz - az);
    g.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    out.push(g.toNonIndexed());
  };
  // Edges along X (4), along Z (4), and the 4 upright corners.
  for (const top of [false, true]) {
    const ya = top ? y1 - w + t : y0, yb = top ? y1 + t : y0 + w;
    add(x0 - t, x1 + t, ya, yb, z0 - t, z0 - t + w);
    add(x0 - t, x1 + t, ya, yb, z1 + t - w, z1 + t);
    add(x0 - t, x0 - t + w, ya, yb, z0 - t, z1 + t);
    add(x1 + t - w, x1 + t, ya, yb, z0 - t, z1 + t);
  }
  for (const x of [x0 - t, x1 + t - w]) for (const z of [z0 - t, z1 + t - w]) add(x, x + w, y0, y1 + t, z, z + w);

  // Tall crates get a middle band; every side gets diagonal braces.
  const tall = b.h > 1.6;
  if (tall) {
    const ym = (y0 + y1) / 2;
    add(x0 - t, x1 + t, ym - w / 2, ym + w / 2, z0 - t, z0 - t + w);
    add(x0 - t, x1 + t, ym - w / 2, ym + w / 2, z1 + t - w, z1 + t);
    add(x0 - t, x0 - t + w, ym - w / 2, ym + w / 2, z0 - t, z1 + t);
    add(x1 + t - w, x1 + t, ym - w / 2, ym + w / 2, z0 - t, z1 + t);
  }
  const bands = tall ? [[y0 + w, (y0 + y1) / 2 - w / 2], [(y0 + y1) / 2 + w / 2, y1 - w + t]] : [[y0 + w, y1 - w + t]];
  for (const [ya, yb] of bands) {
    // Faces facing ±Z: brace runs along X.
    for (const [z, flip] of [[z0 - t / 2, 1], [z1 + t / 2, -1]] as const) {
      out.push(brace(x0 - t + w, x1 + t - w, ya, yb, (len, ang, cx, cy) => {
        const g = new THREE.BoxGeometry(len, w * 0.85, t);
        g.rotateZ(ang * flip);
        g.translate(cx, cy, z);
        return g;
      }));
    }
    // Faces facing ±X: brace runs along Z.
    for (const [x, flip] of [[x0 - t / 2, -1], [x1 + t / 2, 1]] as const) {
      out.push(brace(z0 - t + w, z1 + t - w, ya, yb, (len, ang, cz, cy) => {
        const g = new THREE.BoxGeometry(t, w * 0.85, len);
        g.rotateX(-ang * flip);
        g.translate(x, cy, cz);
        return g;
      }));
    }
  }
  return out;
}

/** One diagonal board inside a rectangle (trimmed so its ends tuck into the frame). */
function brace(
  a0: number, a1: number, y0: number, y1: number,
  make: (len: number, angle: number, centerA: number, centerY: number) => THREE.BufferGeometry,
): THREE.BufferGeometry {
  const da = a1 - a0, dy = y1 - y0;
  const len = Math.hypot(da, dy) - BATTEN * 0.4;
  return make(len, Math.atan2(dy, da), (a0 + a1) / 2, (y0 + y1) / 2).toNonIndexed();
}

// ---- Jersey barriers --------------------------------------------------------------

/** Barrier profile: [width as a fraction of the box's thickness, height as a fraction]. */
const PROFILE: [number, number][] = [
  [1.15, 0],
  [1.15, 0.1],
  [0.72, 0.35],
  [0.45, 1],
];
/** Where the collision steps in (matches the profile). */
const STEP = 0.35;

/** The collision shape of a jersey barrier: a wide lower part and a narrow upper part. */
export function barrierCollision(b: BoxDef): BoxDef[] {
  const alongX = b.w >= b.d;
  const T = alongX ? b.d : b.w;
  const lower = { ...b, h: b.h * STEP };
  const upperT = T * 0.6;
  const upper = alongX ? { ...b, y: b.y + b.h * STEP, h: b.h * (1 - STEP), d: upperT } : { ...b, y: b.y + b.h * STEP, h: b.h * (1 - STEP), w: upperT };
  return [lower, upper];
}

/** Jersey barrier sections filling a box (2 m sections with small gaps between). */
export function jerseyBarrier(b: BoxDef): THREE.BufferGeometry[] {
  const alongX = b.w >= b.d;
  const L = alongX ? b.w : b.d;
  const T = alongX ? b.d : b.w;
  const shape = new THREE.Shape();
  shape.moveTo((-PROFILE[0][0] * T) / 2, 0);
  for (const [fw, fh] of PROFILE) shape.lineTo((fw * T) / 2, fh * b.h);
  for (let i = PROFILE.length - 1; i >= 0; i--) shape.lineTo((-PROFILE[i][0] * T) / 2, PROFILE[i][1] * b.h);

  const n = Math.max(1, Math.round(L / 2));
  const seg = L / n;
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const gapA = i === 0 ? 0 : 0.02, gapB = i === n - 1 ? 0 : 0.02;
    const len = seg - gapA - gapB;
    let g: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: 1 });
    g.deleteAttribute('uv');
    g = g.index ? g.toNonIndexed() : g;
    // Shape is across (X) and up (Y), extruded along Z: turn it to run along the box.
    const start = -L / 2 + i * seg + gapA;
    g.translate(0, 0, start);
    if (alongX) g.rotateY(-Math.PI / 2);
    g.translate(b.x, b.y, b.z);
    g.computeVertexNormals();
    out.push(g);
  }
  return out;
}

// ---- Steel ramps ---------------------------------------------------------------------

/**
 * Steel ramp parts: anti-slip cleats across the walking surface, kick rails
 * along both edges, and a side beam with support posts on each side. (The
 * ramp you walk on is still the plain slope; these are only looks.)
 */
export function rampDetail(r: RampDef): THREE.BufferGeometry[] {
  const alongX = r.dir === '+x' || r.dir === '-x';
  const L = alongX ? r.w : r.d; // length (direction of rise)
  const W = alongX ? r.d : r.w; // width
  const H = r.high - r.low;
  const slope = Math.atan2(H, L);
  const S = Math.hypot(L, H);
  const base = r.base ?? 0;
  // Built with u along +X (uphill) and v along +Z, centered; then turned to face `dir`.
  const turn = { '+x': 0, '-x': Math.PI, '+z': -Math.PI / 2, '-z': Math.PI / 2 }[r.dir];
  const surface = (u: number) => r.low + ((u + L / 2) / L) * H;
  const out: THREE.BufferGeometry[] = [];
  const piece = (w: number, h: number, d: number, u: number, y: number, v: number, pitch: number) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.rotateZ(pitch);
    g.translate(u, y, v);
    g.rotateY(turn);
    g.translate(r.x, 0, r.z);
    out.push(g.toNonIndexed());
  };

  // Cleats every 45 cm (each sits on the slope, tilted with it).
  for (let u = -L / 2 + 0.35; u < L / 2 - 0.2; u += 0.45) piece(0.045, 0.014, W - 0.32, u, surface(u) + 0.006, 0, slope);
  // Kick rails along both edges of the walking surface.
  for (const side of [-1, 1]) piece(S, 0.07, 0.06, 0, (r.low + r.high) / 2 + 0.035, side * (W / 2 - 0.03), slope);
  // Side beams just below the edge, and posts down to the base.
  for (const side of [-1, 1]) {
    const v = side * (W / 2 + 0.02);
    piece(S, 0.16, 0.04, 0, (r.low + r.high) / 2 - 0.08, v, slope);
    for (let u = -L / 2 + 1.2; u < L / 2 - 0.1; u += 1.3) {
      const top = surface(u) - 0.14;
      if (top - base < 0.25) continue;
      piece(0.08, top - base, 0.03, u, (top + base) / 2, side * (W / 2 + 0.015), 0);
    }
  }
  return out;
}

// ---- Stairs ----------------------------------------------------------------------------

/**
 * Visible steps for a ramp marked as stairs (you still walk on the smooth
 * slope, so moving up and down feels the same as a ramp). Steps are about
 * 18 cm high, each a block from the ramp's base up to its tread.
 */
export function stairSteps(r: RampDef): THREE.BufferGeometry[] {
  const alongX = r.dir === '+x' || r.dir === '-x';
  const L = alongX ? r.w : r.d;
  const W = alongX ? r.d : r.w;
  const H = r.high - r.low;
  const base = r.base ?? 0;
  const turn = { '+x': 0, '-x': Math.PI, '+z': -Math.PI / 2, '-z': Math.PI / 2 }[r.dir];
  const n = Math.max(2, Math.round(H / 0.18));
  const out: THREE.BufferGeometry[] = [];
  for (let k = 0; k < n; k++) {
    const u0 = -L / 2 + (k / n) * L, u1 = -L / 2 + ((k + 1) / n) * L;
    const top = r.low + ((k + 1) / n) * H;
    // Each step reaches all the way down (a solid staircase), plus a small nosing lip.
    const g = new THREE.BoxGeometry(u1 - u0 + 0.03, top - base, W);
    g.translate((u0 + u1) / 2 - 0.015, (top + base) / 2, 0);
    g.rotateY(turn);
    g.translate(r.x, 0, r.z);
    out.push(g.toNonIndexed());
  }
  return out;
}
