import type { BoxDef, RampDef } from '../map/MapTypes';

/** Axis-aligned box in world space. */
export interface AABB {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  /** Internal: used to avoid checking the same object twice in one query. */
  _q?: number;
}

interface Ramp extends AABB {
  low: number;
  high: number;
  dir: RampDef['dir'];
}

/** A plane n·p <= d. A solid is the space inside all of its planes. */
interface Plane {
  nx: number;
  ny: number;
  nz: number;
  d: number;
}

interface Solid {
  planes: Plane[];
  /** Bounding box, for a quick reject before the exact test. */
  bounds: AABB;
}

export interface RayHit {
  distance: number;
  /** Surface normal at the hit point (points out of the surface). */
  nx: number;
  ny: number;
  nz: number;
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
  /** Every box and ramp as a convex shape, used for ray tests. */
  private solids: Solid[] = [];

  // A grid over the map (seen from above) so walking checks only look at
  // nearby boxes instead of all of them. Rebuilt when the map changes.
  private static CELL = 4;
  private boxGrid = new Map<number, AABB[]>();
  private rampGrid = new Map<number, Ramp[]>();
  private gridDirty = true;
  private queryId = 0;
  private nearBoxes: AABB[] = [];
  private nearRamps: Ramp[] = [];

  addBox(b: BoxDef): void {
    const box: AABB = {
      minX: b.x - b.w / 2,
      maxX: b.x + b.w / 2,
      minY: b.y,
      maxY: b.y + b.h,
      minZ: b.z - b.d / 2,
      maxZ: b.z + b.d / 2,
    };
    this.boxes.push(box);
    this.solids.push({ planes: boxPlanes(box), bounds: box });
    this.gridDirty = true;
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
    const ramp = this.ramps[this.ramps.length - 1];
    // Same as a box, but the top is replaced by the sloped surface.
    const planes = boxPlanes(ramp).filter((p) => p.ny !== 1);
    const k = (ramp.high - ramp.low);
    const w = ramp.maxX - ramp.minX, d = ramp.maxZ - ramp.minZ;
    // Surface: y = low + k * t, where t goes 0..1 along `dir`. Written as n·p <= d.
    switch (ramp.dir) {
      case '+x': planes.push(norm(-k / w, 1, 0, ramp.low - (k / w) * ramp.minX)); break;
      case '-x': planes.push(norm(k / w, 1, 0, ramp.low + (k / w) * ramp.maxX)); break;
      case '+z': planes.push(norm(0, 1, -k / d, ramp.low - (k / d) * ramp.minZ)); break;
      case '-z': planes.push(norm(0, 1, k / d, ramp.low + (k / d) * ramp.maxZ)); break;
    }
    this.solids.push({ planes, bounds: ramp });
    this.gridDirty = true;
  }

  private static key(ix: number, iz: number): number {
    return (ix + 2048) * 4096 + (iz + 2048);
  }

  private rebuildGrid(): void {
    const C = CollisionWorld.CELL;
    this.boxGrid.clear();
    this.rampGrid.clear();
    const insert = <T extends AABB>(grid: Map<number, T[]>, a: T) => {
      for (let ix = Math.floor(a.minX / C); ix <= Math.floor(a.maxX / C); ix++) {
        for (let iz = Math.floor(a.minZ / C); iz <= Math.floor(a.maxZ / C); iz++) {
          const k = CollisionWorld.key(ix, iz);
          let list = grid.get(k);
          if (!list) grid.set(k, (list = []));
          list.push(a);
        }
      }
    };
    for (const b of this.boxes) insert(this.boxGrid, b);
    for (const r of this.ramps) insert(this.rampGrid, r);
    this.gridDirty = false;
  }

  /** Collects boxes and ramps near a footprint into nearBoxes / nearRamps. */
  private gather(x: number, z: number, radius: number): void {
    if (this.gridDirty) this.rebuildGrid();
    const C = CollisionWorld.CELL;
    const q = ++this.queryId;
    this.nearBoxes.length = 0;
    this.nearRamps.length = 0;
    for (let ix = Math.floor((x - radius) / C); ix <= Math.floor((x + radius) / C); ix++) {
      for (let iz = Math.floor((z - radius) / C); iz <= Math.floor((z + radius) / C); iz++) {
        const k = CollisionWorld.key(ix, iz);
        for (const b of this.boxGrid.get(k) ?? EMPTY) {
          if (b._q !== q) { b._q = q; this.nearBoxes.push(b); }
        }
        for (const r of this.rampGrid.get(k) ?? EMPTY) {
          if (r._q !== q) { r._q = q; this.nearRamps.push(r as Ramp); }
        }
      }
    }
  }

  /**
   * Casts a ray against the map. Returns the closest hit within `maxDist`,
   * or null. `dir` must be normalized.
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): RayHit | null {
    let best: RayHit | null = null;
    let bestDist = maxDist;
    for (const s of this.solids) {
      if (!rayHitsBox(s.bounds, ox, oy, oz, dx, dy, dz, bestDist)) continue;
      let tEnter = 0, tExit = bestDist;
      let hitPlane: Plane | null = null;
      let missed = false;
      for (const p of s.planes) {
        const denom = p.nx * dx + p.ny * dy + p.nz * dz;
        const dist = p.d - (p.nx * ox + p.ny * oy + p.nz * oz);
        if (Math.abs(denom) < 1e-9) {
          if (dist < 0) { missed = true; break; }
          continue;
        }
        const t = dist / denom;
        if (denom < 0) {
          if (t > tEnter) { tEnter = t; hitPlane = p; }
        } else if (t < tExit) {
          tExit = t;
        }
        if (tEnter > tExit) { missed = true; break; }
      }
      // hitPlane null means the ray started inside the solid: ignore it.
      if (missed || !hitPlane || tEnter >= bestDist) continue;
      bestDist = tEnter;
      best = { distance: tEnter, nx: hitPlane.nx, ny: hitPlane.ny, nz: hitPlane.nz };
    }
    return best;
  }

  /** Is this point inside any solid box or ramp? */
  isInsideSolid(x: number, y: number, z: number, margin = 0.001): boolean {
    for (const s of this.solids) {
      const b = s.bounds;
      if (x < b.minX - margin || x > b.maxX + margin || y < b.minY - margin || y > b.maxY + margin || z < b.minZ - margin || z > b.maxZ + margin) continue;
      let inside = true;
      for (const p of s.planes) {
        if (p.nx * x + p.ny * y + p.nz * z > p.d - margin) {
          inside = false;
          break;
        }
      }
      if (inside) return true;
    }
    return false;
  }

  /** True if nothing solid is between the two points. */
  hasLineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return true;
    return this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len) === null;
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
    this.gather(body.x, body.z, body.radius);
    for (const b of this.nearBoxes) {
      if (b.maxY > stepTop && b.minY < head && CollisionWorld.overlapsXZ(b, body.x, body.z, body.radius)) {
        return b;
      }
    }
    for (const r of this.nearRamps) {
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
    this.gather(x, z, radius);
    for (const b of this.nearBoxes) {
      if (b.maxY <= maxY && b.maxY > best && CollisionWorld.overlapsXZ(b, x, z, radius)) best = b.maxY;
    }
    for (const r of this.nearRamps) {
      if (!CollisionWorld.overlapsXZ(r, x, z, radius)) continue;
      const h = this.rampHeightAt(r, x, z);
      if (h <= maxY && h > best) best = h;
    }
    return best;
  }

  /** Lowest ceiling above the body (bottom of a box above `minY`). */
  ceilingHeight(x: number, z: number, radius: number, minY: number): number {
    let best = Infinity;
    this.gather(x, z, radius);
    for (const b of this.nearBoxes) {
      if (b.minY >= minY && b.minY < best && CollisionWorld.overlapsXZ(b, x, z, radius)) best = b.minY;
    }
    return best;
  }
}

const EMPTY: never[] = [];

function norm(nx: number, ny: number, nz: number, d: number): Plane {
  const l = Math.hypot(nx, ny, nz);
  return { nx: nx / l, ny: ny / l, nz: nz / l, d: d / l };
}

function boxPlanes(b: AABB): Plane[] {
  return [
    { nx: 1, ny: 0, nz: 0, d: b.maxX },
    { nx: -1, ny: 0, nz: 0, d: -b.minX },
    { nx: 0, ny: 1, nz: 0, d: b.maxY },
    { nx: 0, ny: -1, nz: 0, d: -b.minY },
    { nx: 0, ny: 0, nz: 1, d: b.maxZ },
    { nx: 0, ny: 0, nz: -1, d: -b.minZ },
  ];
}

/** Quick test: does the ray touch this box within maxDist? */
function rayHitsBox(b: AABB, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): boolean {
  let tmin = 0, tmax = maxDist;
  const axes: [number, number, number, number][] = [
    [ox, dx, b.minX, b.maxX],
    [oy, dy, b.minY, b.maxY],
    [oz, dz, b.minZ, b.maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return false;
      continue;
    }
    let t1 = (lo - o) / d, t2 = (hi - o) / d;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  return true;
}
