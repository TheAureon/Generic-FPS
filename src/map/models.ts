import * as THREE from 'three';
import type { SurfaceId } from '../assets/materials';
import type { BoxDef } from './MapTypes';

/**
 * Detailed models for map objects: furniture, cars, statues, columns,
 * hay bales and so on. A map marks a box with `model: 'car'` (etc.) and the
 * box is drawn as this model instead; the box itself is still what you
 * bump into and shoot.
 *
 * Each model is built in its own space: origin at the middle of the box's
 * bottom, X across its width, Z across its depth (front = +Z), Y up, sized
 * to fill the box. Then it's turned by the box's `rot` and moved into place.
 */

export type ModelKind =
  | 'none' | 'table' | 'officeDesk' | 'partition' | 'monitor' | 'officeChair' | 'car' | 'lampPost' | 'planter'
  | 'bench' | 'ottoman' | 'dumpster' | 'acUnit' | 'vending' | 'fridge' | 'bookshelf' | 'sofa' | 'column'
  | 'statue' | 'sculpture' | 'painting' | 'displayCase' | 'sarcophagus' | 'obelisk' | 'hedge' | 'fountain' | 'fallenColumn'
  | 'cafeTable' | 'cafeChair' | 'picnicTable' | 'tent' | 'woodpile' | 'stove' | 'bed' | 'hayBale' | 'roundBale'
  | 'silo' | 'fuelTank' | 'boat' | 'post' | 'gate' | 'shelf' | 'counter' | 'trough' | 'radio' | 'shippingContainer';

export interface ModelPart {
  geo: THREE.BufferGeometry;
  material: SurfaceId;
  /** Color multiplier (e.g. a car's paint, a book's cover). */
  tint?: [number, number, number];
}

const hex = (c: number): [number, number, number] => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

/** Collects the pieces of one model. */
class Builder {
  readonly parts: ModelPart[] = [];
  constructor(readonly rnd: () => number) {}

  add(material: SurfaceId, g: THREE.BufferGeometry, tint?: number | [number, number, number], keepUV = false): THREE.BufferGeometry {
    let geo = g.index ? g.toNonIndexed() : g;
    if (geo !== g) g.dispose();
    if (!keepUV) geo.deleteAttribute('uv');
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    this.parts.push({ geo, material, tint: typeof tint === 'number' ? hex(tint) : tint });
    return geo;
  }

  /** A box by its center. */
  box(m: SurfaceId, w: number, h: number, d: number, x: number, y: number, z: number, o: { rx?: number; ry?: number; rz?: number; tint?: number | [number, number, number] } = {}): void {
    const g = new THREE.BoxGeometry(w, h, d);
    if (o.rx) g.rotateX(o.rx);
    if (o.rz) g.rotateZ(o.rz);
    if (o.ry) g.rotateY(o.ry);
    g.translate(x, y, z);
    this.add(m, g, o.tint);
  }

  /** A box by its corners. */
  span(m: SurfaceId, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, tint?: number): void {
    this.box(m, x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, { tint });
  }

  /** An upright cylinder (or cone) by its bottom center; `axis` lays it along X or Z instead. */
  cyl(m: SurfaceId, rTop: number, rBot: number, h: number, x: number, y: number, z: number, o: { seg?: number; axis?: 'x' | 'z'; open?: boolean; tint?: number | [number, number, number]; ry?: number } = {}): void {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, o.seg ?? 12, 1, o.open ?? false);
    if (o.axis === 'x') { g.rotateZ(Math.PI / 2); g.translate(x, y, z); }
    else if (o.axis === 'z') { g.rotateX(Math.PI / 2); g.translate(x, y, z); }
    else { if (o.ry) g.rotateY(o.ry); g.translate(x, y + h / 2, z); }
    this.add(m, g, o.tint);
  }

  sphere(m: SurfaceId, r: number, x: number, y: number, z: number, o: { sx?: number; sy?: number; sz?: number; seg?: number; tint?: number } = {}): void {
    const g = new THREE.SphereGeometry(r, o.seg ?? 12, Math.max(6, Math.round((o.seg ?? 12) * 0.6)));
    g.scale(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
    g.translate(x, y, z);
    this.add(m, g, o.tint);
  }

  /** A turned shape (vase, column base, basin): points are [radius, height]. */
  lathe(m: SurfaceId, pts: [number, number][], x: number, y: number, z: number, seg = 16, tint?: number): void {
    const g = new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(Math.max(0.0001, r), h)), seg);
    g.translate(x, y, z);
    this.add(m, g, tint);
  }

  /** A 2D shape (X across, Y up) extruded along Z, centered on z. */
  extrude(m: SurfaceId, pts: [number, number][], depth: number, z = 0, o: { bevel?: number; tint?: number | [number, number, number]; x?: number; y?: number } = {}): THREE.BufferGeometry {
    const shape = new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b)));
    const bevel = o.bevel ?? 0;
    const g = new THREE.ExtrudeGeometry(shape, { depth: depth - bevel * 2, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 6 });
    g.translate(o.x ?? 0, o.y ?? 0, z - depth / 2 + bevel);
    return this.add(m, g, o.tint);
  }
}

/**
 * A window's frame (around a pane of glass in a wall): frame bars, mullions
 * splitting wide windows, and a sill under it if it sits in a wall.
 * `wallT`: thickness of the wall it's in (null = no sill, e.g. a glass railing).
 */
export function windowFrameParts(g: BoxDef, wallT: number | null, frame: SurfaceId, frameTint: number, sill: SurfaceId, sillTint?: number): ModelPart[] {
  const m = new Builder(seeded(g.x * 31 + g.z * 17));
  const along = g.w >= g.d;
  const L = along ? g.w : g.d, H = g.h;
  const f = Math.min(0.07, L * 0.08), depth = Math.max(0.09, (along ? g.d : g.w) + 0.05);
  // Built along X, centered; turned afterwards if the window runs along Z.
  m.box(frame, L, f, depth, 0, f / 2, 0, { tint: frameTint });
  m.box(frame, L, f, depth, 0, H - f / 2, 0, { tint: frameTint });
  for (const s of [-1, 1]) m.box(frame, f, H, depth, s * (L / 2 - f / 2), H / 2, 0, { tint: frameTint });
  const panes = Math.max(1, Math.round(L / 1.25));
  for (let i = 1; i < panes; i++) m.box(frame, f * 0.7, H - f, depth * 0.85, -L / 2 + (L / panes) * i, H / 2, 0, { tint: frameTint });
  // A transom bar on tall windows.
  if (H > 1.8 && wallT !== null) m.box(frame, L - f, f * 0.7, depth * 0.85, 0, H * 0.72, 0, { tint: frameTint });
  if (wallT !== null && wallT >= 0.12) {
    // Sill: sticks out a little on both sides of the wall, slightly wider than the window.
    m.box(sill, L + 0.12, 0.05, wallT + 0.1, 0, -0.025, 0, { tint: sillTint });
  }
  for (const p of m.parts) {
    if (!along) p.geo.rotateY(Math.PI / 2);
    p.geo.translate(g.x, g.y, g.z);
  }
  return m.parts;
}

/** Repeatable random numbers from a position. */
function seeded(seed: number): () => number {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** The model for a box (in world position), or [] for 'none' (solid but invisible). */
export function buildModel(b: BoxDef): ModelPart[] {
  const kind = b.model!;
  if (kind === 'none') return [];
  const rot = ((b.rot ?? 0) * Math.PI) / 180;
  const quarter = Math.round(((b.rot ?? 0) % 180) / 90) % 2 !== 0;
  // Turned a quarter: the model's width runs along the box's depth.
  const W = quarter ? b.d : b.w, D = quarter ? b.w : b.d, H = b.h;
  const m = new Builder(seeded(b.x * 7919 + b.z * 104729 + b.y * 31));
  MODELS[kind](m, W, H, D, b.variant ?? 0, b.tint);
  for (const p of m.parts) {
    p.geo.rotateY(rot);
    p.geo.translate(b.x, b.y, b.z);
  }
  return m.parts;
}

type Make = (m: Builder, W: number, H: number, D: number, variant: number, tint?: number) => void;

const LIGHT_WOOD = 0xb08d62;

const MODELS: Record<Exclude<ModelKind, 'none'>, Make> = {
  // ---- Furniture ----------------------------------------------------------------------------------
  table(m, W, H, D, v) {
    const top = 0.045, inset = 0.06, leg = 0.055;
    m.span('desk', -W / 2, W / 2, H - top, H, -D / 2, D / 2, v === 1 ? LIGHT_WOOD : undefined);
    // Thin edge band under the top.
    m.span('desk', -W / 2 + 0.02, W / 2 - 0.02, H - top - 0.06, H - top, -D / 2 + 0.02, D / 2 - 0.02, 0x6b5136);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.span('steel', sx * (W / 2 - inset) - leg / 2, sx * (W / 2 - inset) + leg / 2, 0, H - top, sz * (D / 2 - inset) - leg / 2, sz * (D / 2 - inset) + leg / 2);
  },
  officeDesk(m, W, H, D) {
    const top = 0.04;
    m.span('desk', -W / 2, W / 2, H - top, H, -D / 2, D / 2);
    // A drawer pedestal on the right, a panel leg on the left, a modesty panel at the back.
    m.span('plastic', W / 2 - 0.45, W / 2 - 0.03, 0.03, H - top, -D / 2 + 0.1, D / 2 - 0.05, 0x8d949c);
    for (let i = 0; i < 3; i++) {
      const y = 0.08 + i * ((H - top - 0.1) / 3);
      m.span('chrome', W / 2 - 0.42, W / 2 - 0.06, y + 0.02, y + (H - top - 0.1) / 3 - 0.02, D / 2 - 0.06, D / 2 - 0.04, 0xa8afb7);
      m.span('steel', W / 2 - 0.3, W / 2 - 0.18, y + 0.12, y + 0.14, D / 2 - 0.04, D / 2 - 0.02);
    }
    m.span('plastic', -W / 2 + 0.03, -W / 2 + 0.06, 0, H - top, -D / 2 + 0.05, D / 2 - 0.05, 0x8d949c);
    m.span('plastic', -W / 2 + 0.06, W / 2 - 0.45, 0.25, H - top, -D / 2 + 0.06, -D / 2 + 0.08, 0x8d949c);
  },
  partition(m, W, H, D) {
    // Fabric panel in an aluminium frame.
    const f = 0.035;
    m.span('fabric', -W / 2 + f, W / 2 - f, 0, H - f, -D / 2 + 0.005, D / 2 - 0.005, 0x7c8796);
    m.span('chrome', -W / 2, W / 2, H - f, H, -D / 2, D / 2, 0xb8bec5);
    for (const s of [-1, 1]) m.span('chrome', s * W / 2 - (s > 0 ? f : 0), s * W / 2 + (s < 0 ? f : 0), 0, H, -D / 2, D / 2, 0xb8bec5);
  },
  monitor(m, W, H, _D) {
    // Base, neck, and the screen (dark glass in a thin bezel).
    m.box('rubber', W * 0.4, 0.015, 0.16, 0, 0.0075, 0, { tint: 0x2b2e33 });
    m.box('rubber', 0.04, H * 0.45, 0.03, 0, H * 0.24, -0.02, { tint: 0x2b2e33 });
    m.box('rubber', W, H * 0.62, 0.025, 0, H * 0.62, 0, { tint: 0x1b1d21 });
    m.box('chrome', W - 0.03, H * 0.62 - 0.03, 0.004, 0, H * 0.62, 0.0135, { tint: 0x2a4766 });
  },
  officeChair(m, W, H, D, _v, tint) {
    const fabric = tint ?? 0x3b4250;
    // Five-star base with casters, gas lift, seat, backrest.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      m.box('steel', 0.3, 0.04, 0.05, Math.cos(a) * 0.14, 0.07, Math.sin(a) * 0.14, { ry: -a, tint: 0x2b2e33 });
      m.sphere('rubber', 0.03, Math.cos(a) * 0.28, 0.03, Math.sin(a) * 0.28, { seg: 6, tint: 0x1b1d21 });
    }
    m.cyl('steel', 0.025, 0.03, 0.36, 0, 0.06, 0, { seg: 8 });
    m.box('fabric', W * 0.9, 0.08, D * 0.85, 0, 0.46, 0.02, { tint: fabric });
    m.box('fabric', W * 0.85, H - 0.55, 0.07, 0, (H + 0.55) / 2 + 0.02, -D / 2 + 0.05, { rx: -0.12, tint: fabric });
    m.box('steel', 0.04, 0.2, 0.03, 0, 0.55, -D / 2 + 0.07, { tint: 0x2b2e33 });
    for (const s of [-1, 1]) m.box('rubber', 0.04, 0.03, D * 0.45, s * W * 0.45, 0.66, 0, { tint: 0x1b1d21 });
  },
  sofa(m, W, H, D, _v, tint) {
    const c = tint ?? 0x5a6b7e;
    m.span('fabric', -W / 2, W / 2, 0.08, 0.38, -D / 2, D / 2, c);
    m.span('fabric', -W / 2, W / 2, 0.38, H, -D / 2, -D / 2 + 0.2, c);
    for (const s of [-1, 1]) m.span('fabric', s > 0 ? W / 2 - 0.18 : -W / 2, s > 0 ? W / 2 : -W / 2 + 0.18, 0.38, Math.min(H, 0.62), -D / 2, D / 2, c);
    // Seat cushions (a little rounded by being two boxes).
    const n = W > 1.6 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const w = (W - 0.36) / n, x = -W / 2 + 0.18 + w * (i + 0.5);
      m.box('fabric', w - 0.02, 0.12, D - 0.25, x, 0.44, 0.1, { tint: c });
      m.box('fabric', w - 0.06, 0.32, 0.12, x, 0.62, -D / 2 + 0.26, { rx: -0.15, tint: c });
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.cyl('desk', 0.025, 0.02, 0.08, sx * (W / 2 - 0.06), 0, sz * (D / 2 - 0.06), { seg: 6, tint: 0x3a2a1c });
  },
  bookshelf(m, W, H, D) {
    const t = 0.03;
    m.span('desk', -W / 2, W / 2, 0, H, -D / 2, -D / 2 + 0.015);
    for (const s of [-1, 1]) m.span('desk', s > 0 ? W / 2 - t : -W / 2, s > 0 ? W / 2 : -W / 2 + t, 0, H, -D / 2, D / 2);
    const shelves = Math.max(2, Math.round(H / 0.38));
    const colors = [0x8c2f2f, 0x2f4f8c, 0x2f7a4f, 0xc79a3a, 0x5a3a7a, 0xd8d0bc, 0x3a3a3a, 0xa85a2a];
    for (let i = 0; i <= shelves; i++) {
      const y = (i / shelves) * (H - t);
      m.span('desk', -W / 2 + t, W / 2 - t, y, y + t, -D / 2, D / 2);
      if (i === shelves) break;
      // Books: different heights, thicknesses and colors; some lean.
      let x = -W / 2 + t + 0.02;
      const room = (H - t) / shelves - t;
      while (x < W / 2 - t - 0.06) {
        const bw = 0.025 + m.rnd() * 0.035, bh = room * (0.6 + m.rnd() * 0.32), bd = D * (0.65 + m.rnd() * 0.25);
        if (m.rnd() < 0.12) { x += 0.05; continue; }
        m.box('paint', bw, bh, bd, x + bw / 2, y + t + bh / 2, -D / 2 + bd / 2 + 0.02, { tint: colors[Math.floor(m.rnd() * colors.length)], rz: m.rnd() < 0.08 ? 0.18 : 0 });
        x += bw + 0.004;
      }
    }
  },
  shelf(m, W, H, D) {
    // Shop shelving: metal uprights, shelves with boxes and goods.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.span('chrome', sx * W / 2 - (sx > 0 ? 0.04 : 0), sx * W / 2 + (sx < 0 ? 0.04 : 0), 0, H, sz * D / 2 - (sz > 0 ? 0.04 : 0), sz * D / 2 + (sz < 0 ? 0.04 : 0), 0xd0d4d8);
    const n = 4;
    const colors = [0xd8c39a, 0x9fb8cf, 0xc98d7a, 0xe8e2d0, 0x7fa37a];
    for (let i = 0; i < n; i++) {
      const y = 0.12 + i * ((H - 0.2) / n);
      m.span('chrome', -W / 2, W / 2, y, y + 0.025, -D / 2, D / 2, 0xd0d4d8);
      for (let x = -W / 2 + 0.1; x < W / 2 - 0.15; x += 0.18 + m.rnd() * 0.1) {
        const h = 0.08 + m.rnd() * 0.18;
        m.box('paint', 0.14, h, D * 0.6, x + 0.07, y + 0.025 + h / 2, 0, { tint: colors[Math.floor(m.rnd() * colors.length)] });
      }
    }
  },
  counter(m, W, H, D, v) {
    // Cabinet with doors, a stone top overhanging the front.
    m.span('desk', -W / 2, W / 2, 0.1, H - 0.04, -D / 2, D / 2 - 0.02);
    m.span('rubber', -W / 2 + 0.02, W / 2 - 0.02, 0, 0.1, -D / 2, D / 2 - 0.08, 0x2b2e33);
    const doors = Math.max(1, Math.round(W / 0.6));
    for (let i = 0; i < doors; i++) {
      const x = -W / 2 + (W / doors) * (i + 0.5);
      m.box('desk', W / doors - 0.03, H - 0.22, 0.02, x, (H - 0.04 + 0.1) / 2, D / 2 - 0.01, { tint: 0xc9b08a });
      m.box('steel', 0.1, 0.015, 0.02, x, H - 0.2, D / 2 + 0.005);
    }
    m.span(v === 1 ? 'marble' : 'tile', -W / 2 - 0.01, W / 2 + 0.01, H - 0.04, H, -D / 2, D / 2 + 0.03);
  },
  bench(m, W, H, D, v) {
    // Park bench: wooden slats on cast iron ends (variant 1: no back).
    const legs = [-W / 2 + 0.15, W / 2 - 0.15];
    const seatY = Math.min(0.45, H - 0.02);
    for (let i = 0; i < 4; i++) m.box('desk', W, 0.035, D * 0.2, 0, seatY, -D / 2 + D * 0.15 + i * D * 0.22, { tint: LIGHT_WOOD });
    for (const x of legs) {
      m.box('steel', 0.05, seatY, 0.05, x, seatY / 2, D / 2 - 0.08, { tint: 0x2b2e33 });
      m.box('steel', 0.05, seatY, 0.05, x, seatY / 2, -D / 2 + 0.08, { tint: 0x2b2e33 });
      m.box('steel', 0.05, 0.04, D - 0.1, x, seatY - 0.04, 0, { tint: 0x2b2e33 });
    }
    if (v !== 1 && H > 0.6) {
      for (let i = 0; i < 2; i++) m.box('desk', W, 0.09, 0.03, 0, seatY + 0.2 + i * 0.16, -D / 2 + 0.02, { rx: -0.2, tint: LIGHT_WOOD });
      for (const x of legs) m.box('steel', 0.05, H - seatY, 0.04, x, seatY + (H - seatY) / 2, -D / 2 + 0.03, { rx: -0.2, tint: 0x2b2e33 });
    }
  },
  ottoman(m, W, H, D) {
    // Museum bench: a buttoned velvet cushion on a wooden base.
    m.span('desk', -W / 2 + 0.04, W / 2 - 0.04, 0, H - 0.16, -D / 2 + 0.04, D / 2 - 0.04, 0x4a3524);
    m.span('velvet', -W / 2, W / 2, H - 0.18, H - 0.03, -D / 2, D / 2);
    m.box('velvet', W - 0.06, 0.04, D - 0.06, 0, H - 0.015, 0);
    for (let x = -W / 2 + 0.25; x < W / 2 - 0.1; x += 0.35) for (const z of [-D / 4, D / 4]) m.sphere('gold', 0.015, x, H + 0.002, z, { seg: 6 });
  },
  cafeTable(m, W, H) {
    m.cyl('marble', W / 2, W / 2, 0.035, 0, H - 0.035, 0, { seg: 20 });
    m.cyl('steel', 0.03, 0.035, H - 0.035, 0, 0, 0, { seg: 8, tint: 0x2b2e33 });
    m.cyl('steel', 0.22, 0.24, 0.03, 0, 0, 0, { seg: 14, tint: 0x2b2e33 });
  },
  cafeChair(m, W, H, D) {
    // Bistro chair: round seat, four legs, curved back.
    const seat = 0.46;
    m.cyl('desk', W * 0.45, W * 0.45, 0.03, 0, seat, 0, { seg: 14, tint: LIGHT_WOOD });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.box('steel', 0.022, seat, 0.022, sx * W * 0.3, seat / 2, sz * D * 0.3, { tint: 0x2b2e33, rx: sz * 0.06, rz: -sx * 0.06 });
    for (let i = 0; i <= 6; i++) {
      const a = Math.PI * (0.15 + 0.7 * (i / 6));
      m.box('steel', 0.02, H - seat, 0.02, Math.cos(a) * W * 0.42, seat + (H - seat) / 2, -Math.sin(a) * D * 0.42, { tint: 0x2b2e33 });
    }
    m.box('desk', W * 0.85, 0.06, 0.03, 0, H - 0.04, -D * 0.4, { tint: LIGHT_WOOD });
  },
  picnicTable(m, W, H, D) {
    const top = H, bench = 0.45;
    for (let i = 0; i < 4; i++) m.box('planks', W, 0.04, D * 0.32 / 4, 0, top - 0.02, -D * 0.16 + (i + 0.5) * (D * 0.32 / 4), {});
    for (const s of [-1, 1]) {
      for (let i = 0; i < 2; i++) m.box('planks', W, 0.04, 0.13, 0, bench - 0.02, s * (D / 2 - 0.08 - i * 0.14));
      // A-frame legs at each end.
      for (const x of [-W / 2 + 0.3, W / 2 - 0.3]) {
        m.box('planks', 0.06, Math.hypot(top, D * 0.4), 0.08, x, top / 2, s * D * 0.2, { rx: s * 0.75 });
      }
    }
    for (const x of [-W / 2 + 0.3, W / 2 - 0.3]) m.box('planks', 0.06, 0.08, D - 0.1, x, bench - 0.08, 0);
  },
  bed(m, W, H, D, v) {
    // A wooden bed frame (bunk if tall), mattress, pillow, blanket.
    const levels = H > 1.2 ? [0.35, 1.45] : [Math.max(0.25, H - 0.2)];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.span('desk', sx * W / 2 - (sx > 0 ? 0.07 : 0), sx * W / 2 + (sx < 0 ? 0.07 : 0), 0, Math.max(H, levels[levels.length - 1] + 0.3), sz * D / 2 - (sz > 0 ? 0.07 : 0), sz * D / 2 + (sz < 0 ? 0.07 : 0));
    for (const y of levels) {
      m.span('desk', -W / 2, W / 2, y - 0.1, y, -D / 2, D / 2);
      m.span('canvas', -W / 2 + 0.06, W / 2 - 0.06, y, y + 0.14, -D / 2 + 0.06, D / 2 - 0.06, 0xe0dccf);
      m.box('canvas', W * 0.32, 0.1, D * 0.6, -W / 2 + W * 0.2, y + 0.19, 0, { tint: 0xf2efe6 });
      m.span('fabric', -W / 2 + W * 0.42, W / 2 - 0.05, y + 0.14, y + 0.19, -D / 2 + 0.05, D / 2 - 0.05, v === 1 ? 0x6b3a3a : 0x3f5a46);
    }
  },
  stove(m, W, H, D) {
    // Cast iron wood stove on legs, with a door and a stovepipe.
    const body = H * 0.42;
    m.span('steel', -W / 2, W / 2, 0.15, 0.15 + body, -D / 2, D / 2, 0x26282b);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.box('steel', 0.05, 0.15, 0.05, sx * (W / 2 - 0.06), 0.075, sz * (D / 2 - 0.06), { tint: 0x1b1d21 });
    m.box('chrome', W * 0.5, body * 0.55, 0.02, 0, 0.15 + body * 0.5, D / 2 + 0.01, { tint: 0x3a2a20 });
    m.box('chrome', 0.04, 0.04, 0.04, W * 0.2, 0.15 + body * 0.5, D / 2 + 0.03, { tint: 0xb8903a });
    m.cyl('steel', 0.07, 0.07, H - 0.15 - body, 0, 0.15 + body, -D * 0.2, { seg: 10, tint: 0x2b2e33 });
  },
  vending(m, W, H, D) {
    m.span('paint', -W / 2, W / 2, 0, H, -D / 2, D / 2 - 0.05, 0xb3262b);
    // Glass front showing rows of drinks, and the coin panel.
    m.span('rubber', -W / 2 + 0.06, W / 2 - 0.3, 0.45, H - 0.15, D / 2 - 0.06, D / 2 - 0.04, 0x15171a);
    const colors = [0xe03a3a, 0x3a7ae0, 0xe0c33a, 0x3ac06a, 0xf0f0f0];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) {
      m.cyl('paint', 0.03, 0.03, 0.12, -W / 2 + 0.16 + c * ((W - 0.45) / 4), 0.55 + r * ((H - 0.75) / 5), D / 2 - 0.1, { seg: 6, tint: colors[(r + c) % colors.length] });
    }
    m.span('glass', -W / 2 + 0.06, W / 2 - 0.3, 0.45, H - 0.15, D / 2 - 0.03, D / 2 - 0.02);
    m.span('chrome', W / 2 - 0.26, W / 2 - 0.06, 0.9, 1.4, D / 2 - 0.06, D / 2 - 0.03, 0x9aa1a8);
    m.span('rubber', -W / 2 + 0.1, W / 2 - 0.35, 0.12, 0.3, D / 2 - 0.06, D / 2 - 0.03, 0x15171a);
  },
  fridge(m, W, H, D) {
    m.span('paint', -W / 2, W / 2, 0.02, H, -D / 2, D / 2 - 0.04, 0xe8e8e4);
    // Two doors with a gap, long handles.
    m.span('paint', -W / 2 + 0.01, W / 2 - 0.01, H * 0.62, H - 0.01, D / 2 - 0.04, D / 2, 0xf2f2ee);
    m.span('paint', -W / 2 + 0.01, W / 2 - 0.01, 0.04, H * 0.62 - 0.015, D / 2 - 0.04, D / 2, 0xf2f2ee);
    m.box('steel', 0.025, H * 0.22, 0.03, W / 2 - 0.08, H * 0.75, D / 2 + 0.02);
    m.box('steel', 0.025, H * 0.35, 0.03, W / 2 - 0.08, H * 0.4, D / 2 + 0.02);
  },
  radio(m, W, H, D) {
    // Radio equipment: stacked boxes with dials and a little glowing display.
    m.span('steel', -W / 2, W / 2, 0, H * 0.55, -D / 2, D / 2, 0x3a4048);
    m.span('steel', -W / 2 + 0.05, W / 2 - 0.05, H * 0.55, H, -D / 2 + 0.05, D / 2 - 0.05, 0x2b3036);
    m.span('glass', -W * 0.35, W * 0.05, H * 0.2, H * 0.4, D / 2, D / 2 + 0.005, 0x6fd38a);
    for (let i = 0; i < 4; i++) m.cyl('chrome', 0.025, 0.025, 0.02, W * 0.12 + i * 0.08, H * 0.3, D / 2 + 0.01, { axis: 'z', seg: 8, tint: 0xd0d0d0 });
    m.cyl('steel', 0.004, 0.006, 0.5, W * 0.35, H, 0, { seg: 4 });
  },

  // ---- Outdoors -------------------------------------------------------------------------------------
  car(m, W, H, D, _v, tint) {
    // Body: a side profile (rounded hood and trunk) extruded across the width; cabin with windows; wheels.
    const L = D, paint = tint ?? 0x6e7d8f;
    const half = L / 2, wr = Math.min(0.34, H * 0.26);
    const body: [number, number][] = [
      [-half, wr * 0.9], [-half + 0.05, H * 0.52], [-half + 0.45, H * 0.56], [half - 0.6, H * 0.6], [half - 0.12, H * 0.55], [half, H * 0.42], [half, wr * 0.9],
    ];
    const g1 = m.extrude('carpaint', body.map(([z, y]) => [z, y]), W * 0.96, 0, { bevel: 0.05, tint: paint });
    g1.rotateY(Math.PI / 2);
    // Cabin (greenhouse): dark glass with a painted roof.
    const roofY = H, beltY = H * 0.58;
    const cabin: [number, number][] = [[-half + 0.95, beltY], [-half + 1.35, roofY - 0.04], [half - 1.55, roofY - 0.04], [half - 1.05, beltY]];
    // Tinted windows: dark and shiny.
    const g2 = m.extrude('chrome', cabin, W * 0.82, 0, { tint: 0x1c2630 });
    g2.rotateY(Math.PI / 2);
    const g3 = m.extrude('carpaint', [[-half + 1.33, roofY - 0.05], [half - 1.53, roofY - 0.05], [half - 1.56, roofY], [-half + 1.36, roofY]], W * 0.8, 0, { tint: paint });
    g3.rotateY(Math.PI / 2);
    // Wheels, hubs, lights, bumpers.
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
      m.cyl('rubber', wr, wr, 0.22, sx * (W / 2 - 0.12), wr, sz * (half - 0.75), { axis: 'x', seg: 14, tint: 0x18191b });
      m.cyl('chrome', wr * 0.55, wr * 0.55, 0.23, sx * (W / 2 - 0.12), wr, sz * (half - 0.75), { axis: 'x', seg: 10, tint: 0xb8bec5 });
    }
    for (const sx of [-1, 1]) {
      m.box('paint', 0.28, 0.1, 0.03, sx * (W / 2 - 0.25), H * 0.45, half + 0.005, { tint: 0xfff6d8 });
      m.box('paint', 0.28, 0.08, 0.03, sx * (W / 2 - 0.25), H * 0.48, -half - 0.005, { tint: 0xc0201a });
    }
    for (const sz of [-1, 1]) m.box('rubber', W * 0.98, 0.1, 0.08, 0, wr * 0.9 + 0.05, sz * (half - 0.02), { tint: 0x2b2e33 });
  },
  lampPost(m, _W, H) {
    // Base, tapering pole, curved arm reaching over the light, lantern hood.
    m.cyl('steel', 0.16, 0.2, 0.35, 0, 0, 0, { seg: 10, tint: 0x2b2e33 });
    m.cyl('steel', 0.06, 0.09, H - 0.35, 0, 0.35, 0, { seg: 10, tint: 0x33373c });
    m.box('steel', 0.08, 0.08, 0.5, 0, H - 0.05, 0.2, { tint: 0x33373c });
    m.cyl('steel', 0.32, 0.18, 0.16, 0, H - 0.2, 0.42, { seg: 12, tint: 0x2b2e33 });
    m.sphere('steel', 0.05, 0, H + 0.02, 0, { seg: 8, tint: 0x2b2e33 });
  },
  planter(m, W, H, D) {
    // Concrete planter with a rim, soil, and a shrub.
    m.span('concrete', -W / 2 + 0.04, W / 2 - 0.04, 0, H - 0.06, -D / 2 + 0.04, D / 2 - 0.04);
    m.span('concrete', -W / 2, W / 2, H - 0.08, H, -D / 2, D / 2);
    m.span('dirt', -W / 2 + 0.08, W / 2 - 0.08, H - 0.1, H - 0.02, -D / 2 + 0.08, D / 2 - 0.08);
    const n = Math.max(2, Math.round((W * D) / 0.5));
    for (let i = 0; i < n; i++) {
      const r = 0.22 + m.rnd() * 0.18;
      m.sphere('foliage', r, (m.rnd() - 0.5) * (W - 0.5), H + r * 0.5, (m.rnd() - 0.5) * (D - 0.5), { seg: 7, sy: 0.85 });
    }
  },
  hedge(m, W, H, D) {
    // A clipped hedge: a solid core with leafy lumps all over.
    m.span('hedge', -W / 2 + 0.08, W / 2 - 0.08, 0, H - 0.1, -D / 2 + 0.08, D / 2 - 0.08);
    const along = W >= D, L = along ? W : D, T = along ? D : W;
    const n = Math.max(2, Math.round(L / 0.55));
    for (let i = 0; i < n; i++) {
      const u = -L / 2 + (i + 0.5) * (L / n);
      for (const [v, y, r] of [[0, H - 0.25, T * 0.55], [T * 0.32, H * 0.45, T * 0.42], [-T * 0.32, H * 0.45, T * 0.42]]) {
        const rr = r * (0.85 + m.rnd() * 0.25);
        const x = along ? u + (m.rnd() - 0.5) * 0.1 : v, z = along ? v : u + (m.rnd() - 0.5) * 0.1;
        const g = new THREE.IcosahedronGeometry(rr, 1);
        g.scale(along ? 1.1 : 0.9, 0.8, along ? 0.9 : 1.1);
        g.translate(x, y, z);
        m.add('hedge', g);
      }
    }
  },
  dumpster(m, W, H, D) {
    // Steel bin, wider at the top, with two plastic lids and wheels.
    const body: [number, number][] = [[-D / 2 + 0.12, 0.1], [D / 2 - 0.05, 0.1], [D / 2, H - 0.12], [-D / 2, H - 0.12]];
    const g = m.extrude('corrugated', body, W, 0, { tint: 0x5a9a6a });
    g.rotateY(Math.PI / 2);
    for (const s of [-1, 1]) m.box('rubber', W / 2 - 0.03, 0.06, D + 0.04, s * W / 4, H - 0.08, 0, { rx: -0.06, tint: 0x22262a });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.cyl('rubber', 0.06, 0.06, 0.05, sx * (W / 2 - 0.2), 0.06, sz * (D / 2 - 0.15), { axis: 'x', seg: 8, tint: 0x18191b });
    for (const s of [-1, 1]) m.box('steel', 0.05, 0.05, D * 0.8, s * (W / 2 + 0.02), H * 0.65, 0, { tint: 0x2b2e33 });
  },
  acUnit(m, W, H, D) {
    // Rooftop/ground air conditioner: a cabinet with fan grilles on top.
    m.span('paint', -W / 2, W / 2, 0.1, H, -D / 2, D / 2, 0xc4c8cc);
    m.span('steel', -W / 2 + 0.05, W / 2 - 0.05, 0, 0.1, -D / 2 + 0.05, D / 2 - 0.05, 0x2b2e33);
    const fans = W > D * 1.3 ? 2 : 1;
    for (let i = 0; i < fans; i++) {
      const x = -W / 2 + (W / fans) * (i + 0.5), r = Math.min(W / fans, D) * 0.38;
      m.cyl('steel', r, r, 0.03, x, H, 0, { seg: 18, tint: 0x1b1d21 });
      for (let k = 0; k < 4; k++) m.box('chrome', r * 1.8, 0.012, 0.025, x, H + 0.035, 0, { ry: (k / 4) * Math.PI, tint: 0x8a9096 });
    }
    for (let y = 0.25; y < H - 0.1; y += 0.07) m.box('chrome', W - 0.1, 0.012, 0.012, 0, y, D / 2 + 0.006, { tint: 0x7a8086 });
  },
  gate(m, W, H, _D) {
    // Wrought-iron gate: bars with spear tips between two rails.
    for (let x = -W / 2 + 0.06; x <= W / 2 - 0.05; x += 0.14) {
      m.cyl('steel', 0.016, 0.016, H - 0.12, x, 0, 0, { seg: 6, tint: 0x1d1f22 });
      m.cyl('chrome', 0, 0.035, 0.12, x, H - 0.12, 0, { seg: 4, tint: 0xb8903a });
    }
    for (const y of [0.15, H - 0.35]) m.box('steel', W, 0.05, 0.04, 0, y, 0, { tint: 0x1d1f22 });
  },
  post(m, W, H) {
    // A round wooden post (slightly uneven).
    m.cyl('bark', W * 0.42, W * 0.5, H, 0, 0, 0, { seg: 9, ry: m.rnd() * 3 });
    m.cyl('planks', W * 0.3, W * 0.42, 0.02, 0, H, 0, { seg: 9 });
  },
  trough(m, W, H, D) {
    // Galvanized water trough with rounded ends and water in it.
    m.span('chrome', -W / 2 + D / 2, W / 2 - D / 2, 0, H, -D / 2, D / 2, 0xa9b0b6);
    for (const s of [-1, 1]) m.cyl('chrome', D / 2, D / 2, H, s * (W / 2 - D / 2), 0, 0, { seg: 14, tint: 0xa9b0b6 });
    m.span('water', -W / 2 + D / 2, W / 2 - D / 2, H - 0.12, H - 0.08, -D / 2 + 0.04, D / 2 - 0.04);
  },

  // ---- Museum ------------------------------------------------------------------------------------------
  column(m, W, H, D, v) {
    // A classical column: square plinth, round base mouldings, a fluted shaft
    // (slightly tapered), and a capital. Variant 1: broken off (ruins).
    const r = Math.min(W, D) * 0.42;
    const broken = v === 1;
    m.span('marble', -W / 2, W / 2, 0, 0.12, -D / 2, D / 2);
    m.lathe('marble', [[r * 1.18, 0], [r * 1.18, 0.08], [r * 1.05, 0.12], [r * 1.1, 0.18], [r * 1.0, 0.24], [r * 1.0, 0.25]], 0, 0.12, 0, 24);
    const shaftH = broken ? H - 0.37 : H - 0.37 - 0.42;
    // Fluting: 16 shallow grooves made by alternating the radius.
    const flutes = 16, pts: number[] = [], idx: number[] = [];
    const ring = (y: number, rr: number) => {
      for (let i = 0; i < flutes * 2; i++) {
        const a = (i / (flutes * 2)) * Math.PI * 2;
        const k = i % 2 ? 0.93 : 1;
        pts.push(Math.cos(a) * rr * k, y, Math.sin(a) * rr * k);
      }
    };
    const segs = broken ? 4 : 1;
    for (let s = 0; s <= segs; s++) ring(0.37 + (s / segs) * shaftH, r * (1 - 0.12 * (s / segs)));
    const N = flutes * 2;
    for (let s = 0; s < segs; s++) for (let i = 0; i < N; i++) {
      const a = s * N + i, b2 = s * N + ((i + 1) % N), c = (s + 1) * N + ((i + 1) % N), d = (s + 1) * N + i;
      idx.push(a, d, c, a, c, b2);
    }
    const shaft = new THREE.BufferGeometry();
    shaft.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    shaft.setIndex(idx);
    shaft.computeVertexNormals();
    if (broken) {
      // Jagged top: lower some of the top ring's points.
      const p = shaft.getAttribute('position');
      // A rough break: a slanted, uneven top rather than spikes.
      const tilt = m.rnd() * Math.PI * 2;
      for (let i = segs * N; i < (segs + 1) * N; i++) {
        const a = ((i - segs * N) / N) * Math.PI * 2;
        p.setY(i, p.getY(i) - 0.12 - 0.12 * Math.sin(a + tilt) - m.rnd() * 0.06);
      }
      shaft.computeVertexNormals();
      m.cyl('marble', r * 0.8, r * 0.85, 0.01, 0, 0.37 + shaftH - 0.3, 0, { seg: 12 });
    }
    m.add('marble', shaft);
    if (!broken) {
      const top = 0.37 + shaftH;
      m.lathe('marble', [[r * 0.88, 0], [r * 1.02, 0.06], [r * 1.0, 0.1], [r * 1.25, 0.26], [r * 1.3, 0.3]], 0, top, 0, 24);
      m.span('marble', -W * 0.62, W * 0.62, top + 0.3, H, -D * 0.62, D * 0.62);
    }
  },
  statue(m, W, H, D, v) {
    // A marble figure on a moulded plinth. Variants: arm raised, holding a
    // spear, thinker (hand to chin), discus thrower.
    const P = Math.min(1.0, H * 0.34); // plinth height
    m.span('stone', -W / 2, W / 2, 0, 0.12, -D / 2, D / 2);
    m.span('stone', -W / 2 + 0.06, W / 2 - 0.06, 0.12, P - 0.1, -D / 2 + 0.06, D / 2 - 0.06);
    m.span('marble', -W / 2 + 0.02, W / 2 - 0.02, P - 0.1, P, -D / 2 + 0.02, D / 2 - 0.02);
    const s = (H - P) / 1.9; // figure scale (about 1.9 units tall)
    const y0 = P;
    const MB: SurfaceId = 'marble';
    // Legs (one forward), hips, torso, shoulders, neck, head.
    const legL = 0.85 * s;
    m.cyl(MB, 0.075 * s, 0.055 * s, legL, -0.1 * s, y0, 0.06 * s, { seg: 10 });
    m.cyl(MB, 0.075 * s, 0.055 * s, legL, 0.1 * s, y0, -0.04 * s, { seg: 10 });
    m.sphere(MB, 0.2 * s, 0, y0 + legL + 0.04 * s, 0, { sx: 1.05, sy: 0.6, sz: 0.75 });
    m.lathe(MB, [[0.17 * s, 0], [0.19 * s, 0.15 * s], [0.21 * s, 0.35 * s], [0.18 * s, 0.5 * s], [0.08 * s, 0.56 * s], [0.0001, 0.56 * s]], 0, y0 + legL, 0, 14);
    const sh = y0 + legL + 0.5 * s;
    m.sphere(MB, 0.07 * s, -0.22 * s, sh, 0, { seg: 8 });
    m.sphere(MB, 0.07 * s, 0.22 * s, sh, 0, { seg: 8 });
    m.cyl(MB, 0.045 * s, 0.05 * s, 0.1 * s, 0, sh + 0.02 * s, 0, { seg: 8 });
    m.sphere(MB, 0.105 * s, 0, sh + 0.2 * s, 0.01 * s, { seg: 12, sy: 1.15 });
    // A draped cloth over one shoulder (a slanted cone).
    const drape = new THREE.ConeGeometry(0.24 * s, 0.7 * s, 12, 1, true);
    drape.rotateZ(0.2);
    drape.translate(0.04 * s, y0 + legL + 0.08 * s, 0);
    m.add(MB, drape);
    // Arms (upper + lower) posed per variant.
    const arm = (side: number, upA: number, foreA: number, fwd: number) => {
      const ux = side * 0.25 * s, uy = sh;
      const ul = 0.32 * s, fl = 0.3 * s;
      const ex = ux + Math.sin(upA) * ul * side, ey = uy - Math.cos(upA) * ul, ez = fwd * ul;
      const g1 = new THREE.CylinderGeometry(0.04 * s, 0.045 * s, ul, 8);
      g1.translate(0, -ul / 2, 0);
      g1.rotateZ(upA * side);
      g1.rotateX(-Math.asin(Math.max(-1, Math.min(1, fwd))));
      g1.translate(ux, uy, 0);
      m.add(MB, g1);
      const g2 = new THREE.CylinderGeometry(0.032 * s, 0.04 * s, fl, 8);
      g2.translate(0, -fl / 2, 0);
      g2.rotateZ(foreA * side);
      g2.translate(ex, ey, ez);
      m.add(MB, g2);
      return [ex + Math.sin(foreA) * fl * side, ey - Math.cos(foreA) * fl, ez];
    };
    switch (v % 4) {
      case 0: arm(-1, 0.15, 0.1, 0); arm(1, 2.6, 2.9, 0); break;
      case 1: {
        arm(-1, 0.2, 0.3, 0);
        const [hx, hy, hz] = arm(1, 0.5, 1.4, 0.4);
        m.cyl('gold', 0.015 * s, 0.015 * s, 1.9 * s, hx, y0 + 0.02, hz, { seg: 6 });
        m.cyl('gold', 0, 0.04 * s, 0.18 * s, hx, y0 + 1.92 * s, hz, { seg: 6 });
        void hy;
        break;
      }
      case 2: arm(-1, 0.15, 0.2, 0); arm(1, 0.3, 2.5, 0.6); break;
      default: {
        arm(-1, 2.2, 2.4, -0.2);
        const [hx, hy, hz] = arm(1, 0.9, 1.2, 0.3);
        m.cyl('gold', 0.09 * s, 0.09 * s, 0.03 * s, hx, hy, hz, { axis: 'z', seg: 14 });
      }
    }
  },
  sculpture(m, W, H, D, v) {
    // Modern art: a twisted knot (or stacked rings) on a low plinth.
    m.span('stone', -W / 2, W / 2, 0, 0.4, -D / 2, D / 2);
    m.span('marble', -W / 2 - 0.02, W / 2 + 0.02, 0.38, 0.42, -D / 2 - 0.02, D / 2 + 0.02);
    const r = Math.min(W, D) * 0.32;
    if (v % 2 === 0) {
      const k = new THREE.TorusKnotGeometry(r, r * 0.22, 96, 10, 2, 3);
      k.scale(1, (H - 0.45) / (r * 2.6), 1);
      k.translate(0, 0.42 + (H - 0.45) / 2, 0);
      m.add('carpaint', k, 0xc0392b);
    } else {
      for (let i = 0; i < 4; i++) {
        const t = new THREE.TorusGeometry(r * (1 - i * 0.15), r * 0.12, 10, 28);
        t.rotateX(Math.PI / 2 + i * 0.5);
        t.rotateY(i * 0.8);
        t.translate(0, 0.42 + r + i * ((H - 0.45 - 2 * r) / 3), 0);
        m.add('gold', t);
      }
    }
  },
  painting(m, W, H, D, v) {
    // A picture in a moulded gold frame, hanging flat on the wall (front = +Z).
    const f = 0.1, depth = Math.max(0.04, D);
    const frame = (x0: number, x1: number, y0: number, y1: number) => {
      // Each side of the frame: a bevelled moulding (thicker on the outside).
      m.extrude('gold', [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], depth, 0, { bevel: 0.012 });
    };
    frame(-W / 2, W / 2, 0, f);
    frame(-W / 2, W / 2, H - f, H);
    frame(-W / 2, -W / 2 + f, f, H - f);
    frame(W / 2 - f, W / 2, f, H - f);
    // The canvas shows one of the 16 pictures in the art texture.
    const cw = W - f * 2 + 0.01, ch = H - f * 2 + 0.01;
    const g = new THREE.PlaneGeometry(cw, ch);
    const cell = ((v % 16) + 16) % 16, ci = cell % 4, cj = Math.floor(cell / 4);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (ci + 0.04 + uv.getX(i) * 0.92) / 4, (cj + 0.04 + uv.getY(i) * 0.92) / 4);
    g.translate(0, H / 2, -depth / 2 + depth * 0.4);
    m.add('art', g, undefined, true);
    // Backing board (hidden) so it isn't see-through from the side.
    m.span('desk', -W / 2 + f / 2, W / 2 - f / 2, f / 2, H - f / 2, -depth / 2, -depth / 2 + depth * 0.35, 0x3a2a1c);
  },
  displayCase(m, W, H, D, v) {
    // A cabinet base, a glass case with brass edges, and a gold vase inside.
    const base = H * 0.56;
    m.span('desk', -W / 2, W / 2, 0, 0.08, -D / 2, D / 2, 0x3a2a1c);
    m.span('desk', -W / 2 + 0.03, W / 2 - 0.03, 0.08, base - 0.04, -D / 2 + 0.03, D / 2 - 0.03, 0x5a4030);
    m.span('desk', -W / 2, W / 2, base - 0.04, base, -D / 2, D / 2, 0x3a2a1c);
    m.span('glass', -W / 2 + 0.02, W / 2 - 0.02, base, H - 0.02, -D / 2 + 0.02, D / 2 - 0.02);
    const e = 0.025;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.span('gold', sx * W / 2 - (sx > 0 ? e : 0), sx * W / 2 + (sx < 0 ? e : 0), base, H, sz * D / 2 - (sz > 0 ? e : 0), sz * D / 2 + (sz < 0 ? e : 0));
    for (const sz of [-1, 1]) m.span('gold', -W / 2, W / 2, H - e, H, sz * D / 2 - (sz > 0 ? e : 0), sz * D / 2 + (sz < 0 ? e : 0));
    for (const sx of [-1, 1]) m.span('gold', sx * W / 2 - (sx > 0 ? e : 0), sx * W / 2 + (sx < 0 ? e : 0), H - e, H, -D / 2, D / 2);
    m.span('velvet', -W / 2 + 0.05, W / 2 - 0.05, base, base + 0.03, -D / 2 + 0.05, D / 2 - 0.05);
    const s = Math.min(1, (H - base) / 0.65);
    if (v % 3 === 0) m.lathe('gold', [[0.0001, 0], [0.07, 0], [0.08, 0.03], [0.05, 0.06], [0.11, 0.18], [0.12, 0.26], [0.08, 0.36], [0.05, 0.4], [0.07, 0.44], [0.0001, 0.44]].map(([r, y]) => [r * s, y * s] as [number, number]), 0, base + 0.03, 0, 16);
    else if (v % 3 === 1) {
      // A mask on a stand.
      m.cyl('steel', 0.01, 0.01, 0.15, 0, base + 0.03, 0, { seg: 6 });
      m.sphere('gold', 0.11 * s, 0, base + 0.3 * s, 0, { sz: 0.55, sy: 1.3 });
    } else {
      // A crown on a cushion.
      m.box('velvet', 0.22, 0.06, 0.22, 0, base + 0.06, 0);
      m.cyl('gold', 0.09, 0.08, 0.08, 0, base + 0.09, 0, { seg: 16, open: true });
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; m.cyl('gold', 0, 0.02, 0.06, Math.cos(a) * 0.085, base + 0.17, Math.sin(a) * 0.085, { seg: 4 }); }
    }
  },
  fallenColumn(m, W, H, D) {
    // A toppled column: drums lying in a row along the longer side, a little out of line.
    const along = W >= D, L = along ? W : D, r = Math.min(H, along ? D : W) / 2;
    const n = Math.max(1, Math.round(L / (r * 2.2)));
    for (let i = 0; i < n; i++) {
      const u = -L / 2 + (L / n) * (i + 0.5), off = (m.rnd() - 0.5) * 0.12;
      if (along) m.cyl('marble', r * 0.97, r, L / n - 0.04, u, r, off, { axis: 'x', seg: 16 });
      else m.cyl('marble', r * 0.97, r, L / n - 0.04, off, r, u, { axis: 'z', seg: 16 });
    }
  },
  sarcophagus(m, W, H, D) {
    // A stone coffin on a step, with a ridged lid, a gold band and a carved face.
    m.span('stone', -W / 2, W / 2, 0, 0.25, -D / 2, D / 2);
    m.span('stone', -W / 2 + 0.1, W / 2 - 0.1, 0.25, H - 0.25, -D / 2 + 0.1, D / 2 - 0.1);
    const g = m.extrude('stone', [[-(D / 2 - 0.08), 0], [D / 2 - 0.08, 0], [D / 2 - 0.2, 0.18], [0, 0.25], [-(D / 2 - 0.2), 0.18]], W - 0.16);
    g.rotateY(Math.PI / 2);
    g.translate(0, H - 0.25, 0);
    m.span('gold', -W / 2 + 0.08, W / 2 - 0.08, H * 0.45, H * 0.52, -D / 2 + 0.09, D / 2 - 0.09);
    m.sphere('gold', 0.16, W / 2 - 0.35, H - 0.02, 0, { sy: 0.45, sx: 0.8 });
  },
  obelisk(m, W, H, D) {
    // A tapering four-sided shaft on a stepped base, with a gold tip.
    m.span('stone', -W / 2, W / 2, 0, 0.18, -D / 2, D / 2);
    m.span('stone', -W * 0.4, W * 0.4, 0.18, 0.3, -D * 0.4, D * 0.4);
    const r = Math.min(W, D) * 0.36;
    m.cyl('stone', r * 0.65, r, H - 0.3 - 0.35, 0, 0.3, 0, { seg: 4, ry: Math.PI / 4 });
    m.cyl('gold', 0, r * 0.65, 0.35, 0, H - 0.35, 0, { seg: 4, ry: Math.PI / 4 });
  },
  fountain(m, W, H) {
    // A round stone basin with water, a pedestal, an upper bowl and a gold finial.
    const R = W / 2;
    m.lathe('stone', [[R - 0.35, 0], [R, 0], [R + 0.05, 0.12], [R, 0.18], [R - 0.02, 0.62], [R + 0.06, 0.66], [R + 0.06, 0.74], [R - 0.38, 0.74], [R - 0.38, 0.2], [0.0001, 0.2]], 0, 0, 0, 40);
    m.cyl('water', R - 0.38, R - 0.38, 0.32, 0, 0.18, 0, { seg: 40 });
    m.lathe('stone', [[0.0001, 0], [0.45, 0], [0.45, 0.12], [0.3, 0.2], [0.24, 0.9], [0.32, 1.1], [0.2, 1.3], [0.0001, 1.3]], 0, 0.5, 0, 20);
    m.lathe('stone', [[0.0001, 0], [0.25, 0], [0.9, 0.18], [1.05, 0.3], [1.0, 0.34], [0.85, 0.26], [0.0001, 0.26]], 0, 1.75, 0, 28);
    m.cyl('water', 0.85, 0.85, 0.02, 0, 2.0, 0, { seg: 24 });
    m.lathe('gold', [[0.0001, 0], [0.1, 0], [0.12, 0.1], [0.06, 0.2], [0.09, 0.32], [0.0001, 0.42]], 0, 2.02, 0, 14);
    void H;
  },

  // ---- Countryside ----------------------------------------------------------------------------------------
  tent(m, W, H, D) {
    // A ridge tent: two sloping canvas sides, closed back, door flaps at the front, poles and guy ropes.
    const half = W / 2;
    const side = (s: number) => {
      const g = new THREE.BufferGeometry();
      const v: number[] = [s * half, 0, -D / 2, 0, H, -D / 2, 0, H, D / 2, s * half, 0, -D / 2, 0, H, D / 2, s * half, 0, D / 2];
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      if (s < 0) g.scale(1, 1, -1);
      g.computeVertexNormals();
      // Give it thickness: a slightly smaller copy inside, facing in.
      const inner = g.clone();
      inner.scale(0.98, 0.98, 0.98);
      const idx = inner.getAttribute('position');
      for (let i = 0; i < idx.count; i += 3) {
        const x = idx.getX(i + 1), y = idx.getY(i + 1), z = idx.getZ(i + 1);
        idx.setXYZ(i + 1, idx.getX(i + 2), idx.getY(i + 2), idx.getZ(i + 2));
        idx.setXYZ(i + 2, x, y, z);
      }
      inner.computeVertexNormals();
      m.add('canvas', g);
      m.add('canvas', inner, 0x8a7550);
    };
    side(1);
    side(-1);
    // Back wall, and two half door flaps at the front (one tied back).
    const tri = (z: number, x0: number, x1: number, tint: number, flip: boolean) => {
      const g = new THREE.BufferGeometry();
      const yA = H * (1 - Math.abs(x0) / half), yB = H * (1 - Math.abs(x1) / half);
      const v = [x0, 0, z, x1, 0, z, x1, yB, z, x0, 0, z, x1, yB, z, x0, yA, z];
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      if (flip) g.scale(1, 1, 1);
      g.computeVertexNormals();
      m.add('canvas', g, tint);
      const back = g.clone();
      const p = back.getAttribute('position');
      for (let i = 0; i < p.count; i += 3) {
        const x = p.getX(i + 1), y = p.getY(i + 1), zz = p.getZ(i + 1);
        p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
        p.setXYZ(i + 2, x, y, zz);
      }
      back.computeVertexNormals();
      m.add('canvas', back, tint);
    };
    for (let i = 0; i < 6; i++) tri(-D / 2, -half + (i / 6) * W, -half + ((i + 1) / 6) * W, 0x9a8258, false);
    for (let i = 0; i < 3; i++) tri(D / 2, -half + (i / 6) * W, -half + ((i + 1) / 6) * W, 0x8a7550, false);
    // Poles and ridge, ropes to pegs.
    for (const z of [-D / 2, D / 2]) m.cyl('planks', 0.02, 0.02, H + 0.12, 0, 0, z, { seg: 6 });
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
      const px = sx * (half + 0.55), pz = sz * (D / 2 + 0.35);
      const len = Math.hypot(px, H, pz - sz * D / 2);
      const g = new THREE.CylinderGeometry(0.006, 0.006, len, 4);
      g.translate(0, len / 2, 0);
      const dir = new THREE.Vector3(px, -H, pz - sz * D / 2).normalize();
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().negate()));
      g.translate(px, 0, pz);
      m.add('canvas', g, 0xd8d0b8);
      m.box('planks', 0.03, 0.12, 0.03, px, 0.04, pz);
    }
  },
  woodpile(m, W, H, D) {
    // Split logs stacked in rows, ends showing.
    const r = 0.11;
    const along = W >= D, L = along ? W : D, T = along ? D : W;
    const rows = Math.max(1, Math.floor(H / (r * 1.75)));
    for (let row = 0; row < rows; row++) {
      const n = Math.floor(T / (r * 2)) - (row % 2);
      for (let i = 0; i < n; i++) {
        const o = -T / 2 + r + (row % 2) * r + i * r * 2;
        const y = r + row * r * 1.72;
        const rr = r * (0.8 + m.rnd() * 0.25), len = L * (0.92 + m.rnd() * 0.08);
        if (along) m.cyl('bark', rr, rr, len, (m.rnd() - 0.5) * 0.08, y, o, { axis: 'x', seg: 7 });
        else m.cyl('bark', rr, rr, len, o, y, (m.rnd() - 0.5) * 0.08, { axis: 'z', seg: 7 });
        for (const s of [-1, 1]) {
          const x = along ? s * len / 2 : o, z = along ? o : s * len / 2;
          m.cyl('planks', rr * 0.85, rr * 0.85, 0.01, x, y, z, { axis: along ? 'x' : 'z', seg: 7, tint: 0xd8b888 });
        }
      }
    }
  },
  hayBale(m, W, H, D) {
    // A square bale: slightly bulging sides and two twine bands.
    const g = new THREE.BoxGeometry(W, H, D, 4, 3, 4);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + 0.04 * (1 - Math.abs(y) / (H / 2)) + (m.rnd() - 0.5) * 0.02;
      p.setXYZ(i, x * k, y, z * k);
    }
    g.computeVertexNormals();
    g.translate(0, H / 2, 0);
    m.add('hay', g);
    const along = W >= D;
    for (const s of [-0.25, 0.25]) {
      if (along) m.box('canvas', 0.025, H + 0.01, D + 0.02, s * W, H / 2, 0, { tint: 0x6b4a2a });
      else m.box('canvas', W + 0.02, H + 0.01, 0.025, 0, H / 2, s * D, { tint: 0x6b4a2a });
    }
  },
  roundBale(m, W, H, D) {
    // A big round bale lying on its side (rolled straw, spiral on the ends).
    const r = H / 2, along = W >= D, L = along ? W : D;
    m.cyl('hay', r, r, L * 0.96, 0, r, 0, { axis: along ? 'x' : 'z', seg: 20 });
    for (const s of [-1, 1]) {
      const g = new THREE.CircleGeometry(r * 0.97, 20);
      if (along) g.rotateY((s * Math.PI) / 2);
      else if (s < 0) g.rotateY(Math.PI);
      g.translate(along ? (s * L) / 2 : 0, r, along ? 0 : (s * L) / 2);
      m.add('hay', g, 0xd8c070);
      m.cyl('hay', r * 0.5, r * 0.5, 0.01, along ? (s * L) / 2 : 0, r, along ? 0 : (s * L) / 2, { axis: along ? 'x' : 'z', seg: 14, tint: 0xa88a40 });
    }
  },
  silo(m, W, H) {
    // A corrugated steel silo: ribbed cylinder, a dome roof, a ladder.
    const r = W / 2;
    m.cyl('corrugated', r, r, H - r * 0.6, 0, 0, 0, { seg: 28 });
    for (let y = 0.6; y < H - r * 0.6; y += 1.1) m.cyl('chrome', r + 0.03, r + 0.03, 0.07, 0, y, 0, { seg: 28, open: true, tint: 0x9aa1a8 });
    const dome = new THREE.SphereGeometry(r * 1.02, 28, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(1, 0.6, 1);
    dome.translate(0, H - r * 0.6, 0);
    m.add('chrome', dome, 0xb8bec5);
    m.cyl('chrome', 0.15, 0.2, 0.25, 0, H - 0.05, 0, { seg: 10, tint: 0x9aa1a8 });
    for (const s of [-0.22, 0.22]) m.box('steel', 0.04, H - r * 0.6, 0.04, s, (H - r * 0.6) / 2, r + 0.15);
    for (let y = 0.3; y < H - r * 0.6; y += 0.32) m.box('steel', 0.44, 0.03, 0.03, 0, y, r + 0.15);
  },
  fuelTank(m, W, H, D) {
    // A horizontal tank with domed ends, on two saddles.
    const along = W >= D, L = along ? W : D, r = Math.min(H * 0.42, (along ? D : W) / 2);
    const cy = H - r;
    m.cyl('paint', r, r, L - r, 0, cy, 0, { axis: along ? 'x' : 'z', seg: 18, tint: 0xeceeef });
    for (const s of [-1, 1]) {
      const cap = new THREE.SphereGeometry(r, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      cap.scale(1, 0.45, 1);
      if (along) cap.rotateZ(-s * Math.PI / 2);
      else cap.rotateX(s * Math.PI / 2);
      cap.translate(along ? s * (L - r) / 2 : 0, cy, along ? 0 : s * (L - r) / 2);
      m.add('paint', cap, 0xeceeef);
      const sx = along ? s * L * 0.3 : 0, sz = along ? 0 : s * L * 0.3;
      m.box('steel', along ? 0.12 : r * 1.6, cy, along ? r * 1.6 : 0.12, sx, cy / 2, sz, { tint: 0x3a3e44 });
    }
    m.cyl('chrome', 0.08, 0.08, 0.15, 0, H - 0.02, 0, { seg: 8, tint: 0x9aa1a8 });
    m.box('paint', along ? 0.6 : 0.01, 0.25, along ? 0.01 : 0.6, along ? 0 : r + 0.005, cy, along ? r + 0.005 : 0, { tint: 0xc0392b });
  },
  shippingContainer(m, W, H, D, _v, tint) {
    // A 20/40-foot container: corrugated steel walls (real ridges), a frame
    // with corner castings, and cargo doors with locking bars at one end.
    const paint = tint ?? 0x8a3b2c;
    const frame = 0.12, rib = 0.3, depth = 0.04;
    // Corrugated side walls: a zigzag profile along the length, extruded up.
    const side = (s: number) => {
      const pts: [number, number][] = [];
      const len = D - frame * 2;
      const n = Math.floor(len / rib);
      for (let i = 0; i <= n; i++) {
        const z = -len / 2 + (i / n) * len;
        pts.push([z, 0], [z + (len / n) * 0.3, depth], [z + (len / n) * 0.7, depth], [z + (len / n), 0]);
      }
      const shape = new THREE.Shape();
      shape.moveTo(pts[0][0], -0.02);
      for (const [z, d] of pts) shape.lineTo(z, d);
      shape.lineTo(pts[pts.length - 1][0], -0.02);
      const g = new THREE.ExtrudeGeometry(shape, { depth: H - frame * 2, bevelEnabled: false, curveSegments: 1 });
      // Shape is in (z, out) and extruded along "up".
      g.rotateX(-Math.PI / 2);
      g.rotateY(-Math.PI / 2);
      if (s < 0) g.rotateY(Math.PI); // (turned, not mirrored: mirroring would turn it inside out)
      g.translate(s * (W / 2 - depth), frame, 0);
      m.add('corrugated', g, paint);
    };
    side(1);
    side(-1);
    // Roof, floor edge and the closed (front) end panel.
    m.span('corrugated', -W / 2 + 0.02, W / 2 - 0.02, H - frame, H - 0.02, -D / 2 + 0.02, D / 2 - 0.02, paint);
    m.span('corrugated', -W / 2 + frame, W / 2 - frame, frame, H - frame, D / 2 - 0.06, D / 2 - 0.02, paint);
    // Doors (back end): two leaves with vertical ribs, four locking bars, handles.
    for (const s of [-1, 1]) {
      m.span('corrugated', s > 0 ? 0.01 : -W / 2 + frame, s > 0 ? W / 2 - frame : -0.01, frame, H - frame, -D / 2 + 0.02, -D / 2 + 0.06, paint);
      for (let k = 0; k < 4; k++) m.box('corrugated', 0.06, H - frame * 2 - 0.1, 0.03, s * (0.25 + k * 0.27), H / 2, -D / 2, { tint: paint });
      for (const x of [s * 0.18, s * (W / 2 - 0.35)]) {
        m.cyl('chrome', 0.022, 0.022, H - 0.25, x, 0.12, -D / 2 - 0.035, { seg: 6, tint: 0x9aa1a8 });
        m.box('chrome', 0.04, 0.25, 0.04, x + s * 0.06, H * 0.45, -D / 2 - 0.06, { tint: 0x8a9096 });
      }
    }
    // Frame rails and corner posts (darker), corner castings.
    const dark: [number, number, number] = [0.55, 0.55, 0.55];
    const fr = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => m.span('corrugated', x0, x1, y0, y1, z0, z1, paint);
    for (const y of [0, H - frame]) {
      fr(-W / 2, W / 2, y, y + frame, -D / 2, -D / 2 + frame);
      fr(-W / 2, W / 2, y, y + frame, D / 2 - frame, D / 2);
      fr(-W / 2, -W / 2 + frame, y, y + frame, -D / 2, D / 2);
      fr(W / 2 - frame, W / 2, y, y + frame, -D / 2, D / 2);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      fr(sx * W / 2 - (sx > 0 ? frame : 0), sx * W / 2 + (sx < 0 ? frame : 0), 0, H, sz * D / 2 - (sz > 0 ? frame : 0), sz * D / 2 + (sz < 0 ? frame : 0));
      for (const y of [0.09, H - 0.09]) m.box('steel', 0.18, 0.18, 0.18, sx * (W / 2 - 0.08), y, sz * (D / 2 - 0.08), { tint: dark });
    }
  },
  boat(m, W, H, D) {
    // An upturned rowing boat: a hull that narrows to a point at the bow.
    const along = W >= D, L = along ? W : D, B = along ? D : W;
    const g = new THREE.CylinderGeometry(B / 2, B / 2, L, 14, 6, false, 0, Math.PI);
    // Half cylinder (keel up) squashed to the boat's height, narrowing toward one end.
    g.rotateZ(Math.PI / 2);
    g.rotateX(Math.PI / 2);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) / L + 0.5; // 0 stern .. 1 bow
      const k = u > 0.6 ? Math.max(0.05, 1 - ((u - 0.6) / 0.4) ** 1.5) : 1 - (0.6 - u) * 0.25;
      p.setY(i, Math.max(0, p.getY(i)) * (H / (B / 2)));
      p.setZ(i, p.getZ(i) * k);
    }
    g.computeVertexNormals();
    if (!along) g.rotateY(Math.PI / 2);
    m.add('planks', g, 0xe8ecef);
    m.box('planks', along ? L * 0.9 : 0.06, 0.06, along ? 0.06 : L * 0.9, 0, H, 0, { tint: 0x6b4a2a });
    void B;
  },
};
