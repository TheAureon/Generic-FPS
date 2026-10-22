import type { TerrainDef } from './MapTypes';

/**
 * Hilly ground: helpers to make a terrain from a height function, and to
 * read its height anywhere (used by collision, rendering and map files).
 *
 * Each grid cell is split into two triangles along the diagonal from its
 * (x0, z0) corner to its (x1, z1) corner; heights inside follow those flat
 * triangles exactly, so what you walk on matches what you see.
 */

/** Builds a terrain covering x0..x0+width, z0..z0+depth, sampling `height(x, z)` every `cell` meters. */
export function makeTerrain(
  x0: number, z0: number, width: number, depth: number, cell: number,
  height: (x: number, z: number) => number,
  extra: Partial<Pick<TerrainDef, 'material' | 'pathMaterial' | 'paths' | 'snowLine'>> = {},
): TerrainDef {
  const cols = Math.round(width / cell), rows = Math.round(depth / cell);
  const heights = new Float32Array((cols + 1) * (rows + 1));
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) heights[j * (cols + 1) + i] = height(x0 + i * cell, z0 + j * cell);
  }
  return { x0, z0, cell, cols, rows, heights, ...extra };
}

/** Height of the terrain at (x, z), or -Infinity outside it. */
export function terrainHeightAt(t: TerrainDef, x: number, z: number): number {
  const gx = (x - t.x0) / t.cell, gz = (z - t.z0) / t.cell;
  if (gx < 0 || gz < 0 || gx > t.cols || gz > t.rows) return -Infinity;
  const i = Math.min(t.cols - 1, Math.floor(gx)), j = Math.min(t.rows - 1, Math.floor(gz));
  const fx = gx - i, fz = gz - j;
  const W = t.cols + 1, h = t.heights;
  const h00 = h[j * W + i], h10 = h[j * W + i + 1], h01 = h[(j + 1) * W + i], h11 = h[(j + 1) * W + i + 1];
  return fx >= fz ? h00 + (h10 - h00) * fx + (h11 - h10) * fz : h00 + (h11 - h01) * fx + (h01 - h00) * fz;
}

/** Lowest and highest terrain height under a square footprint (x ± r, z ± r). */
export function terrainRangeUnder(t: TerrainDef, x: number, z: number, r: number): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const [dx, dz] of [[0, 0], [-r, -r], [r, -r], [-r, r], [r, r], [0, -r], [0, r], [-r, 0], [r, 0]]) {
    const h = terrainHeightAt(t, x + dx, z + dz);
    if (!Number.isFinite(h)) continue;
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  return [lo, hi];
}

// ---- Noise, for making natural-looking hills ------------------------------------------------

/** Smooth random values (-1..1) that change gradually with x, z. Same seed = same hills. */
export function valueNoise(x: number, z: number, seed = 1): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed), c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
}

/** Several layers of noise (big gentle hills + smaller bumps), about -1..1. */
export function fbm(x: number, z: number, seed = 1, octaves = 4): number {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x * f, z * f, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

function hash(x: number, z: number, seed: number): number {
  let h = (x * 374761393 + z * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h & 0xffff) / 0xffff) * 2 - 1;
}

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Repeatable random numbers (0..1) from a seed. */
export function seededRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
