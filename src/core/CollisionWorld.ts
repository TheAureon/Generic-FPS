import type { BoxDef, RampDef, TerrainDef } from '../map/MapTypes';
import { terrainHeightAt, terrainRangeUnder } from '../map/terrain';

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

export interface Ramp extends AABB {
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
  /** Internal: used to avoid testing the same solid twice in one ray. */
  _q?: number;
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

/** Leaves that hide what's behind them from bots (bushes, low branches). */
interface Foliage {
  x: number;
  y: number;
  z: number;
  r: number;
}

/**
 * The static geometry of a map, used for walking, line of sight and
 * bullets: boxes, ramps, and (optionally) hilly terrain.
 */
export class CollisionWorld {
  /** What findBlocker returns for ground that's too steep to walk up (not a box: don't slide along it). */
  static readonly STEEP: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };

  readonly boxes: AABB[] = [];
  readonly ramps: Ramp[] = [];
  /** Every box and ramp as a convex shape, used for ray tests. */
  private solids: Solid[] = [];

  // A grid over the map (seen from above) so walking checks only look at
  // nearby boxes instead of all of them. Rebuilt when the map changes.
  private static CELL = 4;
  private boxGrid = new Map<number, AABB[]>();
  private rampGrid = new Map<number, Ramp[]>();
  /** Every solid by grid cell, so rays only test what's along their path. */
  private solidGrid = new Map<number, Solid[]>();
  private gridDirty = true;
  private queryId = 0;
  private nearBoxes: AABB[] = [];
  private nearRamps: Ramp[] = [];
  private terrain: TerrainDef | null = null;
  /** Highest corner of each terrain cell, to skip cells a ray passes above. */
  private terrainCellMax = new Float32Array(0);
  private terrainMax = -Infinity;
  private foliage: Foliage[] = [];

  setTerrain(t: TerrainDef): void {
    this.terrain = t;
    const W = t.cols + 1;
    this.terrainCellMax = new Float32Array(t.cols * t.rows);
    for (let j = 0; j < t.rows; j++) {
      for (let i = 0; i < t.cols; i++) {
        const h = t.heights;
        const m = Math.max(h[j * W + i], h[j * W + i + 1], h[(j + 1) * W + i], h[(j + 1) * W + i + 1]);
        this.terrainCellMax[j * t.cols + i] = m;
        if (m > this.terrainMax) this.terrainMax = m;
      }
    }
  }

  /** Height of the terrain at (x, z) (-Infinity if there's no terrain there). */
  terrainHeight(x: number, z: number): number {
    return this.terrain ? terrainHeightAt(this.terrain, x, z) : -Infinity;
  }

  /** A ball of leaves that bots can't see through. */
  addFoliage(x: number, y: number, z: number, r: number): void {
    this.foliage.push({ x, y, z, r });
  }

  /** Line of sight that also counts leaves (bushes) as blocking. Leaves don't hide things up close. */
  hasClearView(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    return !this.foliageBetween(ax, ay, az, bx, by, bz) && this.hasLineOfSight(ax, ay, az, bx, by, bz);
  }

  private foliageBetween(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len2 = dx * dx + dy * dy + dz * dz;
    if (len2 < 16) return false;
    const minX = Math.min(ax, bx), maxX = Math.max(ax, bx), minZ = Math.min(az, bz), maxZ = Math.max(az, bz);
    for (const f of this.foliage) {
      if (f.x + f.r < minX || f.x - f.r > maxX || f.z + f.r < minZ || f.z - f.r > maxZ) continue;
      // Leaves around the viewer's own eyes don't count.
      if ((f.x - ax) ** 2 + (f.y - ay) ** 2 + (f.z - az) ** 2 < f.r * f.r) continue;
      const t = Math.max(0, Math.min(1, ((f.x - ax) * dx + (f.y - ay) * dy + (f.z - az) * dz) / len2));
      const px = ax + dx * t - f.x, py = ay + dy * t - f.y, pz = az + dz * t - f.z;
      if (px * px + py * py + pz * pz < f.r * f.r * 0.7) return true;
    }
    return false;
  }

  /** @param rayTransparent glass: blocks walking, but bullets and eyesight pass through */
  addBox(b: BoxDef, rayTransparent = false): void {
    const box: AABB = {
      minX: b.x - b.w / 2,
      maxX: b.x + b.w / 2,
      minY: b.y,
      maxY: b.y + b.h,
      minZ: b.z - b.d / 2,
      maxZ: b.z + b.d / 2,
    };
    this.boxes.push(box);
    if (!rayTransparent) this.solids.push({ planes: boxPlanes(box), bounds: box });
    this.gridDirty = true;
  }

  /** A ramp's shape (without adding it to the world). */
  static rampShape(r: RampDef): Ramp {
    return {
      minX: r.x - r.w / 2,
      maxX: r.x + r.w / 2,
      minY: r.base ?? 0,
      maxY: Math.max(r.low, r.high),
      minZ: r.z - r.d / 2,
      maxZ: r.z + r.d / 2,
      low: r.low,
      high: r.high,
      dir: r.dir,
    };
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
    this.solidGrid.clear();
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
    for (const sol of this.solids) {
      const a = sol.bounds;
      for (let ix = Math.floor(a.minX / C); ix <= Math.floor(a.maxX / C); ix++) {
        for (let iz = Math.floor(a.minZ / C); iz <= Math.floor(a.maxZ / C); iz++) {
          const k = CollisionWorld.key(ix, iz);
          let list = this.solidGrid.get(k);
          if (!list) this.solidGrid.set(k, (list = []));
          list.push(sol);
        }
      }
    }
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
    if (this.gridDirty) this.rebuildGrid();
    // Walk the grid cells the ray passes over (seen from above), nearest
    // first, testing only the solids in them. Stop once the next cell starts
    // farther away than the best hit so far.
    const C = CollisionWorld.CELL;
    const q = ++this.queryId;
    let ix = Math.floor(ox / C), iz = Math.floor(oz / C);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const adx = Math.abs(dx), adz = Math.abs(dz);
    let tMaxX = adx > 1e-12 ? ((ix + (dx > 0 ? 1 : 0)) * C - ox) / dx : Infinity;
    let tMaxZ = adz > 1e-12 ? ((iz + (dz > 0 ? 1 : 0)) * C - oz) / dz : Infinity;
    const tDeltaX = adx > 1e-12 ? C / adx : Infinity;
    const tDeltaZ = adz > 1e-12 ? C / adz : Infinity;
    const hit: { best: RayHit | null; dist: number } = { best: null, dist: maxDist };
    if (this.terrain) this.rayVsTerrain(ox, oy, oz, dx, dy, dz, hit);
    for (let guard = 0; guard < 4096; guard++) {
      const list = this.solidGrid.get(CollisionWorld.key(ix, iz));
      if (list) {
        for (const sol of list) {
          if (sol._q === q) continue;
          sol._q = q;
          rayVsSolid(sol, ox, oy, oz, dx, dy, dz, hit);
        }
      }
      const tNext = Math.min(tMaxX, tMaxZ);
      if (tNext > hit.dist) break;
      if (tMaxX < tMaxZ) {
        ix += stepX;
        tMaxX += tDeltaX;
      } else {
        iz += stepZ;
        tMaxZ += tDeltaZ;
      }
    }
    return hit.best;
  }

  /**
   * Ray vs the terrain: walks the grid cells under the ray (nearest first)
   * and tests the two triangles of each cell the ray dips low enough to touch.
   */
  private rayVsTerrain(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, hit: { best: RayHit | null; dist: number }): void {
    const t = this.terrain!;
    const C = t.cell, x1 = t.x0 + t.cols * C, z1 = t.z0 + t.rows * C;
    // Part of the ray over the terrain's area.
    let t0 = 0, t1 = hit.dist;
    for (const [o, d, lo, hi] of [[ox, dx, t.x0, x1], [oz, dz, t.z0, z1]]) {
      if (Math.abs(d) < 1e-12) {
        if (o < lo || o > hi) return;
        continue;
      }
      let a = (lo - o) / d, b = (hi - o) / d;
      if (a > b) [a, b] = [b, a];
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
    }
    if (t0 > t1 || Math.min(oy + dy * t0, oy + dy * t1) > this.terrainMax) return;
    const sx = ox + dx * t0, sz = oz + dz * t0;
    let i = Math.min(t.cols - 1, Math.max(0, Math.floor((sx - t.x0) / C)));
    let j = Math.min(t.rows - 1, Math.max(0, Math.floor((sz - t.z0) / C)));
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    let tMaxX = Math.abs(dx) > 1e-12 ? (t.x0 + (i + (dx > 0 ? 1 : 0)) * C - ox) / dx : Infinity;
    let tMaxZ = Math.abs(dz) > 1e-12 ? (t.z0 + (j + (dz > 0 ? 1 : 0)) * C - oz) / dz : Infinity;
    const tDX = Math.abs(dx) > 1e-12 ? C / Math.abs(dx) : Infinity;
    const tDZ = Math.abs(dz) > 1e-12 ? C / Math.abs(dz) : Infinity;
    const W = t.cols + 1, H = t.heights;
    let tc = t0;
    for (let guard = 0; guard < 8192; guard++) {
      const tEnd = Math.min(tMaxX, tMaxZ, t1);
      if (Math.min(oy + dy * tc, oy + dy * tEnd) <= this.terrainCellMax[j * t.cols + i]) {
        const xi = t.x0 + i * C, zj = t.z0 + j * C;
        const h00 = H[j * W + i], h10 = H[j * W + i + 1], h01 = H[(j + 1) * W + i], h11 = H[(j + 1) * W + i + 1];
        let best = Infinity, bnx = 0, bnz = 0;
        // Two triangles: y = base + a * (x - xi) + b * (z - zj).
        for (let tri = 0; tri < 2; tri++) {
          const a = tri === 0 ? (h10 - h00) / C : (h11 - h01) / C;
          const b = tri === 0 ? (h11 - h10) / C : (h01 - h00) / C;
          const denom = dy - a * dx - b * dz;
          if (denom >= 0) continue; // ray not heading into this slope
          const th = (h00 + a * (ox - xi) + b * (oz - zj) - oy) / denom;
          if (th < tc - 1e-6 || th > tEnd + 1e-6 || th < 0 || th >= best) continue;
          const fx = (ox + dx * th - xi) / C, fz = (oz + dz * th - zj) / C;
          if (tri === 0 ? fx < fz - 1e-6 : fx > fz + 1e-6) continue;
          best = th;
          bnx = -a;
          bnz = -b;
        }
        if (best < hit.dist) {
          const l = Math.hypot(bnx, 1, bnz);
          hit.dist = best;
          hit.best = { distance: best, nx: bnx / l, ny: 1 / l, nz: bnz / l };
          return;
        }
      }
      if (tEnd >= t1) return;
      tc = tEnd;
      if (tMaxX < tMaxZ) {
        i += stepX;
        tMaxX += tDX;
      } else {
        j += stepZ;
        tMaxZ += tDZ;
      }
      if (i < 0 || j < 0 || i >= t.cols || j >= t.rows) return;
    }
  }

  /** Is this point inside any solid box or ramp (or under the terrain)? */
  isInsideSolid(x: number, y: number, z: number, margin = 0.001): boolean {
    if (this.gridDirty) this.rebuildGrid();
    const C = CollisionWorld.CELL;
    const m = Math.max(0, margin);
    if (this.terrain && y < terrainHeightAt(this.terrain, x, z) - margin) return true;
    const q = ++this.queryId;
    for (let ix = Math.floor((x - m) / C); ix <= Math.floor((x + m) / C); ix++) {
      for (let iz = Math.floor((z - m) / C); iz <= Math.floor((z + m) / C); iz++) {
        for (const s of this.solidGrid.get(CollisionWorld.key(ix, iz)) ?? EMPTY) {
          if ((s as Solid)._q === q) continue;
          (s as Solid)._q = q;
          if (pointInSolid(s as Solid, x, y, z, margin)) return true;
        }
      }
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
    if (this.terrain) {
      const [, hi] = terrainRangeUnder(this.terrain, body.x, body.z, body.radius);
      if (hi > stepTop) return CollisionWorld.STEEP;
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
    if (this.terrain) {
      const h = terrainHeightAt(this.terrain, x, z);
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

/** Exact ray test against one convex solid; updates `hit` if it's closer. */
function rayVsSolid(s: Solid, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, hit: { best: RayHit | null; dist: number }): void {
  if (!rayHitsBox(s.bounds, ox, oy, oz, dx, dy, dz, hit.dist)) return;
  let tEnter = 0, tExit = hit.dist;
  let hitPlane: Plane | null = null;
  for (const p of s.planes) {
    const denom = p.nx * dx + p.ny * dy + p.nz * dz;
    const dist = p.d - (p.nx * ox + p.ny * oy + p.nz * oz);
    if (Math.abs(denom) < 1e-9) {
      if (dist < 0) return;
      continue;
    }
    const t = dist / denom;
    if (denom < 0) {
      if (t > tEnter) { tEnter = t; hitPlane = p; }
    } else if (t < tExit) {
      tExit = t;
    }
    if (tEnter > tExit) return;
  }
  // hitPlane null means the ray started inside the solid: ignore it.
  if (!hitPlane || tEnter >= hit.dist) return;
  hit.dist = tEnter;
  hit.best = { distance: tEnter, nx: hitPlane.nx, ny: hitPlane.ny, nz: hitPlane.nz };
}

function pointInSolid(s: Solid, x: number, y: number, z: number, margin: number): boolean {
  const b = s.bounds;
  if (x < b.minX - margin || x > b.maxX + margin || y < b.minY - margin || y > b.maxY + margin || z < b.minZ - margin || z > b.maxZ + margin) return false;
  for (const p of s.planes) if (p.nx * x + p.ny * y + p.nz * z > p.d - margin) return false;
  return true;
}

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
