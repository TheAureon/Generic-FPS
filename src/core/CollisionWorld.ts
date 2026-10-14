import type { BoxDef, RampDef } from '../map/MapTypes';

/** Axis-aligned box in world space. */
export interface AABB {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

interface Ramp extends AABB {
  low: number;
  high: number;
  dir: RampDef['dir'];
}

/** A character's body for collision purposes: a box around a vertical cylinder. */
export interface Body {
  x: number;
  z: number;
  /** Y of the feet. */
  feet: number;
  height: number;
  radius: number;
}

/**
 * The static geometry of a map, used for walking and (later) line of sight
 * and bullets. Kept simple: just boxes and ramps.
 */
export class CollisionWorld {
  readonly boxes: AABB[] = [];
  readonly ramps: Ramp[] = [];

  addBox(b: BoxDef): void {
    this.boxes.push({
      minX: b.x - b.w / 2,
      maxX: b.x + b.w / 2,
      minY: b.y,
      maxY: b.y + b.h,
      minZ: b.z - b.d / 2,
      maxZ: b.z + b.d / 2,
    });
  }

  addRamp(r: RampDef): void {
    this.ramps.push({
      minX: r.x - r.w / 2,
      maxX: r.x + r.w / 2,
      minY: r.base ?? 0,
      maxY: Math.max(r.low, r.high),
      minZ: r.z - r.d / 2,
      maxZ: r.z + r.d / 2,
      low: r.low,
      high: r.high,
      dir: r.dir,
    });
  }

  /** Height of a ramp's surface at (x, z), clamped to the ramp's footprint. */
  rampHeightAt(r: Ramp, x: number, z: number): number {
    let t: number;
    switch (r.dir) {
      case '+x': t = (x - r.minX) / (r.maxX - r.minX); break;
      case '-x': t = (r.maxX - x) / (r.maxX - r.minX); break;
      case '+z': t = (z - r.minZ) / (r.maxZ - r.minZ); break;
      case '-z': t = (r.maxZ - z) / (r.maxZ - r.minZ); break;
    }
    t = Math.min(1, Math.max(0, t));
    return r.low + (r.high - r.low) * t;
  }

  /** Highest point of a ramp under a square footprint. */
  private rampMaxUnder(r: Ramp, x: number, z: number, radius: number): number {
    switch (r.dir) {
      case '+x': return this.rampHeightAt(r, x + radius, z);
      case '-x': return this.rampHeightAt(r, x - radius, z);
      case '+z': return this.rampHeightAt(r, x, z + radius);
      case '-z': return this.rampHeightAt(r, x, z - radius);
    }
  }

  private static overlapsXZ(a: AABB, x: number, z: number, radius: number): boolean {
    return x + radius > a.minX && x - radius < a.maxX && z + radius > a.minZ && z - radius < a.maxZ;
  }

  /**
   * Returns the obstacle the body would be stuck in, or null if the spot is free.
   * Anything whose top is within `stepHeight` of the feet is not a wall
   * (you just step up onto it).
   */
  findBlocker(body: Body, stepHeight: number): AABB | null {
    const stepTop = body.feet + stepHeight;
    const head = body.feet + body.height;
    for (const b of this.boxes) {
      if (b.maxY > stepTop && b.minY < head && CollisionWorld.overlapsXZ(b, body.x, body.z, body.radius)) {
        return b;
      }
    }
    for (const r of this.ramps) {
      if (r.minY < head && CollisionWorld.overlapsXZ(r, body.x, body.z, body.radius)) {
        if (this.rampMaxUnder(r, body.x, body.z, body.radius) > stepTop) return r;
      }
    }
    return null;
  }

  /**
   * Height of the highest walkable surface under the body that is no higher
   * than `maxY`. Returns -Infinity if there's nothing underneath.
   */
  groundHeight(x: number, z: number, radius: number, maxY: number): number {
    let best = -Infinity;
    for (const b of this.boxes) {
      if (b.maxY <= maxY && b.maxY > best && CollisionWorld.overlapsXZ(b, x, z, radius)) best = b.maxY;
    }
    for (const r of this.ramps) {
      if (!CollisionWorld.overlapsXZ(r, x, z, radius)) continue;
      const h = this.rampHeightAt(r, x, z);
      if (h <= maxY && h > best) best = h;
    }
    return best;
  }

  /** Lowest ceiling above the body (bottom of a box above `minY`). */
  ceilingHeight(x: number, z: number, radius: number, minY: number): number {
    let best = Infinity;
    for (const b of this.boxes) {
      if (b.minY >= minY && b.minY < best && CollisionWorld.overlapsXZ(b, x, z, radius)) best = b.minY;
    }
    return best;
  }
}
