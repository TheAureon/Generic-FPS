import type { BoxDef, LampDef, MaterialId, PickupDef, RampDef, SpawnPoint } from './MapTypes';

/**
 * Helpers for writing building maps: walls with doors and windows cut in,
 * slabs, furniture boxes, lamps. A map file creates a kit, calls these, and
 * hands kit.boxes / kit.ramps / kit.lamps / kit.pickups to its MapDef.
 */

export type Opening = { at: [number, number]; kind: 'door' | 'window' | 'open'; top?: number; sill?: number };

export interface WallOpts {
  /** Span along the wall's axis. */
  from: number;
  to: number;
  /** Bottom and top heights. */
  y0: number;
  y1: number;
  /** Thickness (default 0.15). */
  t?: number;
  mat?: MaterialId;
  /** Material on some sides, e.g. drywall inside an outer wall. */
  faces?: BoxDef['faces'];
  openings?: Opening[];
}

export interface KitOptions {
  /** Default door height, window sill and window top (above the wall's bottom). */
  doorHeight?: number;
  sill?: number;
  head?: number;
}

export class MapKit {
  readonly boxes: BoxDef[] = [];
  readonly ramps: RampDef[] = [];
  readonly lamps: LampDef[] = [];
  readonly pickups: PickupDef[] = [];
  private doorH: number;
  private sill: number;
  private head: number;

  constructor(o: KitOptions = {}) {
    this.doorH = o.doorHeight ?? 2.3;
    this.sill = o.sill ?? 1.0;
    this.head = o.head ?? 2.4;
  }

  box(x: number, y: number, z: number, w: number, h: number, d: number, material: MaterialId, faces?: BoxDef['faces']): void {
    this.boxes.push({ x, y, z, w, h, d, material, faces });
  }

  /** A box drawn as a detailed model (see `src/map/models.ts`); the box is still the solid part. */
  model(kind: NonNullable<BoxDef['model']>, x: number, y: number, z: number, w: number, h: number, d: number, extra: Partial<BoxDef> = {}): void {
    this.boxes.push({ x, y, z, w, h, d, model: kind, ...extra });
  }

  /** A model filling the box given by its corners. */
  modelSpan(kind: NonNullable<BoxDef['model']>, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, extra: Partial<BoxDef> = {}): void {
    this.model(kind, (x0 + x1) / 2, y0, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, extra);
  }

  /** A box given by its corners (x0..x1, y0..y1, z0..z1). */
  span(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, material: MaterialId, faces?: BoxDef['faces']): void {
    this.box((x0 + x1) / 2, y0, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, material, faces);
  }

  /**
   * A wall along X (at z) or along Z (at x), with doors (open up to door
   * height, a header above), windows (sill + glass + header) and open gaps
   * cut into it.
   */
  wall(axis: 'x' | 'z', at: number, o: WallOpts): void {
    const t = o.t ?? 0.15;
    const mat = o.mat ?? 'drywall';
    const piece = (a: number, b: number, y0: number, y1: number, m: MaterialId = mat, thick = t) => {
      if (b - a < 0.01 || y1 - y0 < 0.01) return;
      const c = (a + b) / 2, len = b - a;
      const faces = m === mat ? o.faces : undefined;
      this.boxes.push(
        axis === 'x'
          ? { x: c, y: y0, z: at, w: len, h: y1 - y0, d: thick, material: m, faces }
          : { x: at, y: y0, z: c, w: thick, h: y1 - y0, d: len, material: m, faces },
      );
    };
    const ops = [...(o.openings ?? [])].sort((p, q) => p.at[0] - q.at[0]);
    let cur = o.from;
    ops.forEach((op, i) => {
      const [a, b] = op.at;
      piece(cur, a, o.y0, o.y1);
      if (op.kind === 'door') {
        piece(a, b, o.y0 + (op.top ?? this.doorH), o.y1);
        const next = ops[i + 1]?.at[0] ?? o.to;
        doorTrim(this.boxes, axis, at, t, a, b, o.y0, o.y0 + (op.top ?? this.doorH), mat, a - cur, next - b);
      }
      if (op.kind === 'window') {
        const sill = op.sill ?? this.sill, top = op.top ?? this.head;
        piece(a, b, o.y0, o.y0 + sill);
        piece(a, b, o.y0 + sill, o.y0 + top, 'glass', 0.06);
        piece(a, b, o.y0 + top, o.y1);
      }
      cur = b;
    });
    piece(cur, o.to, o.y0, o.y1);
  }

  /** A floor slab: `top` material above, `bottom` (ceiling) below, `side` around. */
  slab(x0: number, x1: number, z0: number, z1: number, y: number, h: number, top: MaterialId, bottom: MaterialId = 'ceiling', side: MaterialId = 'drywall'): void {
    this.span(x0, x1, y, y + h, z0, z1, side, { top, bottom });
  }

  lamp(x: number, y: number, z: number, intensity = 1.0, range = 7.5, color = 0xf3efe4, facing: LampDef['facing'] = 'down'): void {
    this.lamps.push({ x, y, z, color, intensity, range, facing });
  }

  stairs(x: number, z: number, w: number, d: number, low: number, high: number, dir: RampDef['dir'], base = 0): void {
    this.ramps.push({ x, z, w, d, low, high, dir, base, material: 'stairs' });
  }
}

/** The trim around a doorway, by wall material. */
function trimMaterial(wall: MaterialId): MaterialId {
  switch (wall) {
    case 'drywall': return 'paint';
    case 'timber': case 'planks': case 'barnwood': case 'ruin': return 'planks';
    case 'stone': case 'marble': return 'marble';
    case 'concrete': case 'wall': return 'metal';
    default: return 'desk';
  }
}

/**
 * A doorway's frame on both faces of the wall (two jambs and a head), plus,
 * for ordinary-width interior doors, the open door leaf resting against the
 * wall beside it. All looks only (nothing to bump into).
 * `before` / `after`: how much solid wall there is on each side of the opening.
 */
export function doorTrim(boxes: BoxDef[], axis: 'x' | 'z', at: number, t: number, a: number, b: number, y0: number, top: number, wall: MaterialId, before: number, after: number): void {
  const trim = trimMaterial(wall), w = 0.08, out = 0.025;
  const put = (u0: number, u1: number, ya: number, yb: number, n0: number, n1: number, material: MaterialId) => {
    const c = (u0 + u1) / 2, len = u1 - u0, nc = at + (n0 + n1) / 2, nd = n1 - n0;
    boxes.push(axis === 'x'
      ? { x: c, y: ya, z: nc, w: len, h: yb - ya, d: nd, material, decor: true }
      : { x: nc, y: ya, z: c, w: nd, h: yb - ya, d: len, material, decor: true });
  };
  for (const s of [-1, 1]) {
    const n0 = s > 0 ? t / 2 - 0.005 : -t / 2 - out, n1 = s > 0 ? t / 2 + out : -t / 2 + 0.005;
    put(a - w, a, y0, top + w, n0, n1, trim);
    put(b, b + w, y0, top + w, n0, n1, trim);
    put(a - w, b + w, top, top + w, n0, n1, trim);
  }
  // The door itself, swung open flat against the wall (interior doors only).
  const width = b - a;
  if (width > 1.25 || !(wall === 'drywall' || wall === 'timber' || wall === 'planks')) return;
  const leaf: MaterialId = 'desk';
  const n0 = t / 2 + 0.03, n1 = n0 + 0.045;
  if (before >= width + 0.1) put(a - w - width, a - w, y0 + 0.01, top - 0.01, n0, n1, leaf);
  else if (after >= width + 0.1) put(b + w, b + w + width, y0 + 0.01, top - 0.01, n0, n1, leaf);
}

export const door = (a: number, b: number, top?: number): Opening => ({ at: [a, b], kind: 'door', top });
export const win = (a: number, b: number, sill?: number, top?: number): Opening => ({ at: [a, b], kind: 'window', sill, top });
export const gap = (a: number, b: number): Opening => ({ at: [a, b], kind: 'open' });

/** A spawn point facing a direction in degrees (0 = north / -Z, 90 = west... as yaw). */
export function spawnAt(x: number, y: number, z: number, yaw: number): SpawnPoint {
  return { x, y, z, yaw };
}

/** A spawn point facing the map's center (0, 0). */
export function spawnFacingCenter(x: number, y: number, z: number): SpawnPoint {
  return { x, y, z, yaw: (Math.atan2(x, z) * 180) / Math.PI };
}
