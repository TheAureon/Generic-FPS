import type { MapDef, PropDef, RampDef } from '../MapTypes';
import { MapKit, door, spawnAt, win } from '../kit';
import { fbm, makeTerrain, seededRandom, smoothstep, terrainRangeUnder } from '../terrain';

/**
 * FOREST — rolling wooded hills (180 x 180 m) with a stream running through.
 *
 *   - a clearing with a log cabin (you can go inside) and a porch
 *   - a wooden watchtower on a hill to the south-east (armor on top)
 *   - old stone ruins on a hill to the north-west
 *   - a campsite with tents and a fire pit to the west
 *   - a stream winding north to south, with two footbridges (or wade across)
 *   - dirt trails linking them; pines, leafy trees, bushes, rocks and fallen logs everywhere
 *
 * Bushes and low pine branches hide you from bots (not from bullets).
 * The ground is generated from a fixed seed, so it's the same every time.
 * Coordinates: X west (-) to east (+), Z north (-) to south (+), Y up.
 */

const HALF = 90;
const k = new MapKit({ doorHeight: 2.2 });
const { box, span } = { box: k.box.bind(k), span: k.span.bind(k) };

// ---- Landmarks ----------------------------------------------------------------------------
const CABIN = { x: 18, z: 4 };
const TOWER = { x: 52, z: -50 };
const RUINS = { x: -55, z: 50 };
const CAMP = { x: -62, z: -30 };

/** The stream's center line (x for a given z). */
const streamX = (z: number) => -15 + 20 * Math.sin(z / 32) + 5 * Math.sin(z / 13 + 1);

// ---- The ground -----------------------------------------------------------------------------
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const dist = (x: number, z: number, p: { x: number; z: number }) => Math.hypot(x - p.x, z - p.z);

/** Rolling hills: big gentle ones plus smaller bumps. */
const hills = (x: number, z: number) => fbm(x / 45, z / 45, 3) * 7 + fbm(x / 14, z / 14, 9, 3) * 1.2;
const levels = {
  cabin: hills(CABIN.x, CABIN.z),
  tower: hills(TOWER.x, TOWER.z) + 7,
  ruins: hills(RUINS.x, RUINS.z) + 5,
  camp: hills(CAMP.x, CAMP.z),
};

/** Hills with flattened spots for the landmarks. */
function inner(x: number, z: number): number {
  let h = hills(x, z);
  h = lerp(h, levels.cabin, smoothstep(24, 13, dist(x, z, CABIN)));
  h = lerp(h, levels.tower, smoothstep(28, 11, dist(x, z, TOWER)));
  h = lerp(h, levels.ruins, smoothstep(24, 10, dist(x, z, RUINS)));
  h = lerp(h, levels.camp, smoothstep(20, 11, dist(x, z, CAMP)));
  return h;
}

/** Everything except the stream: the hills, rising near the edges into a ring of cliffs too steep to climb. */
function land(x: number, z: number): number {
  const edge = Math.max(Math.abs(x), Math.abs(z));
  return inner(x, z) + smoothstep(70, 80, edge) * 3 + smoothstep(80.5, 84, edge) * 14 + Math.max(0, edge - 84) * 1.2;
}

/** Stream bed height: a little below the land on either side, smoothed along its length. */
function bedRaw(z: number): number {
  const cx = streamX(z);
  return Math.min(inner(cx, z), inner(cx - 10, z), inner(cx + 10, z)) - 1.6;
}
const bed = (z: number) => (bedRaw(z - 6) + bedRaw(z - 3) + bedRaw(z) + bedRaw(z + 3) + bedRaw(z + 6)) / 5;

function height(x: number, z: number): number {
  const h = land(x, z);
  // Carve the stream (only ever lowers the ground).
  const k = smoothstep(9, 2.5, Math.abs(x - streamX(z)));
  return h - k * Math.max(0, h - bed(z));
}

// Trails (also used to keep trees off them).
const trails: { points: [number, number][]; width: number }[] = [
  // Cabin → west footbridge → campsite.
  { points: [[CABIN.x - 6, CABIN.z + 1], [2, -4], [-10, -10], [-22, -12], [-34, -14], [-48, -22], [CAMP.x + 6, CAMP.z + 1]], width: 2.6 },
  // Cabin → north footbridge → ruins.
  { points: [[CABIN.x - 2, CABIN.z - 5], [12, 18], [6, 30], [0, 38], [-14, 44], [-30, 46], [RUINS.x + 8, RUINS.z]], width: 2.6 },
  // Cabin → watchtower.
  { points: [[CABIN.x + 5, CABIN.z - 3], [30, -12], [40, -26], [TOWER.x + 1, TOWER.z + 12]], width: 2.6 },
  // Campsite → ruins (along the west).
  { points: [[CAMP.x - 2, CAMP.z + 7], [-68, -10], [-66, 12], [-62, 30], [RUINS.x - 4, RUINS.z - 8]], width: 2.2 },
  // Cabin → east woods.
  { points: [[CABIN.x + 7, CABIN.z + 2], [40, 12], [55, 30], [60, 50]], width: 2.2 },
];

const terrain = makeTerrain(-HALF, -HALF, HALF * 2, HALF * 2, 2, height, { paths: trails });
/** Highest ground under a small footprint: a safe height to stand something on. */
const top = (x: number, z: number, r = 0.4) => terrainRangeUnder(terrain, x, z, r)[1];
const low = (x: number, z: number, r = 0.4) => terrainRangeUnder(terrain, x, z, r)[0];

// ---- The stream: water in segments down the bed ----------------------------------------------
for (let z = -HALF; z < HALF; z += 3) {
  const zc = z + 1.5;
  const surface = bed(zc) + 0.3;
  span(streamX(zc) - 4.5, streamX(zc) + 4.5, surface - 1.8, surface, z, z + 3, 'water');
}

// Footbridges: a plank deck from bank to bank, posts along both sides.
function footbridge(z: number): void {
  const cx = streamX(z), x0 = cx - 7.5, x1 = cx + 7.5;
  const hw = top(x0, z, 1.1) + 0.05, he = top(x1, z, 1.1) + 0.05;
  const lowEnd = Math.min(hw, he);
  const r: RampDef = { x: cx, z, w: x1 - x0, d: 2.2, low: hw, high: he, dir: '+x', base: lowEnd - 0.3, material: 'planks' };
  if (he < hw) Object.assign(r, { low: he, high: hw, dir: '-x' });
  k.ramps.push(r);
  for (let x = x0 + 1; x <= x1 - 0.9; x += 2.6) {
    const y = lerp(hw, he, (x - x0) / (x1 - x0));
    for (const s of [-1, 1]) k.model('post', x, y - 0.1, z + s * 1.0, 0.16, 1.15, 0.16);
  }
}
footbridge(-12);
footbridge(38);

// ---- The cabin ------------------------------------------------------------------------------------
{
  const { x: X, z: Z } = CABIN;
  const F = top(X, Z, 4.5) + 0.3; // floor, a step up from the ground
  const W = 4, D = 3; // half width (x) and half depth (z)
  const WALL = 2.7;
  span(X - W, X + W, low(X, Z, 4.5) - 0.5, F, Z - D, Z + D, 'timber', { top: 'desk' });
  // Porch in front (south), with two posts.
  span(X - W, X + W, low(X, Z + D + 1.2, 4) - 0.5, F - 0.05, Z + D, Z + D + 2.4, 'planks');
  const R = F + WALL;
  for (const s of [-1, 1]) k.model('post', X + s * (W - 0.2), F - 0.05, Z + D + 2.2, 0.22, R - 0.4 - F, 0.22);
  const wallOpts = { t: 0.3, mat: 'timber' as const, y0: F, y1: F + WALL };
  k.wall('x', Z - D + 0.15, { ...wallOpts, from: X - W, to: X + W, openings: [win(X - 2.5, X - 1, 0.9, 1.9), win(X + 1, X + 2.5, 0.9, 1.9)] });
  k.wall('x', Z + D - 0.15, { ...wallOpts, from: X - W, to: X + W, openings: [win(X - 3, X - 1.6, 0.9, 1.9), door(X - 0.9, X + 0.9), win(X + 1.6, X + 3, 0.9, 1.9)] });
  k.wall('z', X - W + 0.15, { ...wallOpts, from: Z - D + 0.3, to: Z + D - 0.3, openings: [win(Z - 0.8, Z + 0.8, 0.9, 1.9)] });
  k.wall('z', X + W - 0.15, { ...wallOpts, from: Z - D + 0.3, to: Z + D - 0.3, openings: [door(Z - 0.9, Z + 0.9)] });
  // Gable roof (two slopes) over the cabin, a lower one over the porch.
  k.ramps.push({ x: X, z: Z - D / 2 - 0.2, w: W * 2 + 0.8, d: D + 0.4, low: R, high: R + 1.6, dir: '+z', base: R, material: 'planks' });
  k.ramps.push({ x: X, z: Z + D / 2 + 0.2, w: W * 2 + 0.8, d: D + 0.4, low: R, high: R + 1.6, dir: '-z', base: R, material: 'planks' });
  k.ramps.push({ x: X, z: Z + D + 1.5, w: W * 2 + 0.4, d: 2.2, low: R - 0.45, high: R - 0.05, dir: '-z', base: R - 0.55, material: 'planks' });
  // Inside: a table, a bunk, a stove, a shelf.
  k.model('table', X - 1.5, F, Z - 0.6, 1.6, 0.75, 1.0, { variant: 1 });
  k.model('bed', X + 2.9, F, Z - 1.8, 1.9, 0.5, 0.9, { rot: 180, variant: 1 });
  k.model('stove', X - 3.3, F, Z - 2.1, 0.7, R - F - 0.05, 0.7);
  k.model('bookshelf', X + 0.6, F, Z - 2.55, 1.6, 1.6, 0.35);
  k.lamp(X, R - 0.08, Z, 1.0, 6.5, 0xffd9a0);
  // Woodpile and an axe block by the side.
  k.model('woodpile', X + W + 0.6, top(X + W + 0.6, Z - 2, 0.6) - 0.1, Z - 2, 0.9, 1.0, 1.6);
  k.pickups.push({ type: 'health', x: X - 1.5, y: F, z: Z + 1.4 });
}

// ---- The watchtower ----------------------------------------------------------------------------------
{
  const { x: X, z: Z } = TOWER;
  const G = levels.tower;
  const P = G + 4.8; // platform top
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.model('post', X + sx * 1.9, G - 0.5, Z + sz * 1.9, 0.34, 8.3, 0.34);
  span(X - 2.3, X + 2.3, P - 0.3, P, Z - 2.3, Z + 2.3, 'planks');
  // Railings (opening on the south side, where the stairs arrive).
  span(X - 2.3, X + 2.3, P, P + 1.0, Z - 2.3, Z - 2.15, 'planks');
  span(X - 2.3, X - 2.15, P, P + 1.0, Z - 2.15, Z + 2.3, 'planks');
  span(X + 2.15, X + 2.3, P, P + 1.0, Z - 2.15, Z + 2.3, 'planks');
  span(X - 2.15, X - 0.45, P, P + 1.0, Z + 2.15, Z + 2.3, 'planks');
  span(X + 1.25, X + 2.15, P, P + 1.0, Z + 2.15, Z + 2.3, 'planks');
  // Roof.
  span(X - 2.7, X + 2.7, G + 7.8, G + 8.05, Z - 2.7, Z + 2.7, 'planks');
  // Stairs up (south side).
  k.ramps.push({ x: X + 0.4, z: Z + 2.3 + 4.75, w: 1.5, d: 9.5, low: G, high: P, dir: '-z', base: G - 0.5, material: 'planks' });
  k.pickups.push({ type: 'armor', x: X - 0.6, y: P, z: Z - 0.6 });
  k.pickups.push({ type: 'ammo', x: X - 3.5, y: top(X - 3.5, Z + 4), z: Z + 4 });
}

// ---- The ruins ----------------------------------------------------------------------------------------
{
  const { x: X, z: Z } = RUINS;
  const G = levels.ruins;
  span(X - 6.5, X + 6.5, G - 0.6, G + 0.08, Z - 6.5, Z + 6.5, 'ruin');
  /** A broken wall from (x0, z0) to (x1, z1) (relative to the center): equal pieces of the given heights (0 = gap). */
  const broken = (x0: number, x1: number, z0: number, z1: number, heights: number[]) => {
    const n = heights.length;
    heights.forEach((h, i) => {
      if (h <= 0) return;
      const a = i / n, b = (i + 1) / n;
      const along = x1 - x0 > z1 - z0;
      span(X + (along ? x0 + (x1 - x0) * a : x0), X + (along ? x0 + (x1 - x0) * b : x1), G - 0.5, G + h,
        Z + (along ? z0 : z0 + (z1 - z0) * a), Z + (along ? z1 : z0 + (z1 - z0) * b), 'ruin');
    });
  };
  broken(-6, 6, -6, -5.2, [3.2, 3.4, 2.6, 1.2, 0, 0, 2.4, 2.0, 2.6]); // north
  broken(-6, -5.2, -5.2, 6, [2.8, 3.0, 2.2, 0, 0, 1.6, 1.2, 0.7]); // west
  broken(5.2, 6, -5.2, 6, [3.5, 3.1, 0.9, 0.6, 0, 0, 2.2, 2.6]); // east
  broken(-6, 6, 5.2, 6, [1.4, 1.0, 0.5, 0, 0, 0, 2.4, 3.0, 2.7]); // south
  // Broken columns and a fallen one.
  for (const [x, z, h] of [[-3, -3, 3.8], [3, -3, 1.6], [-3, 3, 2.4], [3, 3, 0.9]] as const) {
    k.model('column', X + x, G, Z + z, 1.0, 0.3 + h, 1.0, { variant: 1 });
  }
  k.modelSpan('fallenColumn', X - 1.5, X + 2.6, G + 0.08, G + 0.78, Z - 0.35, Z + 0.35);
  k.pickups.push({ type: 'health', x: X - 3.6, y: G + 0.08, z: Z + 0.2 });
  k.pickups.push({ type: 'ammo', x: X + 3.4, y: G + 0.08, z: Z - 0.5 });
}

// ---- The campsite -----------------------------------------------------------------------------------
{
  const { x: X, z: Z } = CAMP;
  const G = levels.camp;
  /** An A-frame tent (2.4 m wide, 3 m long). */
  const tent = (x: number, z: number, alongX: boolean) => {
    // Ridge along X (alongX) or Z; the box is what you bump into.
    k.model('tent', x, G - 0.05, z, alongX ? 3 : 2.4, 1.75, alongX ? 2.4 : 3, { rot: alongX ? 90 : 0 });
  };
  tent(X - 5, Z - 4, true);
  tent(X + 4, Z - 5, false);
  tent(X - 4, Z + 5, false);
  // Picnic table, supply crates.
  k.model('picnicTable', X + 4.5, G, Z + 3.5, 2.2, 0.78, 2.0);
  box(X + 6.5, G, Z - 1, 1.2, 1.0, 1.2, 'crate');
  box(X + 7.3, G, Z + 0.3, 1.0, 0.8, 1.0, 'crate');
  k.pickups.push({ type: 'health', x: X + 2.5, y: G, z: Z - 2.5 });
  k.pickups.push({ type: 'ammo', x: X - 1.5, y: G, z: Z + 3 });
}

// ---- Boundary: invisible walls behind the cliffs (in case someone gets up them, or along the stream) ----
for (const s of [-1, 1]) {
  k.boxes.push({ x: s * 87, y: -20, z: 0, w: 6, h: 80, d: 180, hidden: true });
  k.boxes.push({ x: 0, y: -20, z: s * 87, w: 180, h: 80, d: 6, hidden: true });
}

// ---- Trees, bushes, rocks, logs ------------------------------------------------------------------------
const props: PropDef[] = [];
const rnd = seededRandom(424242);
const nearTrail = (x: number, z: number, m: number) =>
  trails.some(({ points, width }) => points.some((p, i) => {
    const q = points[i + 1];
    if (!q) return false;
    const dx = q[0] - p[0], dz = q[1] - p[1], l2 = dx * dx + dz * dz;
    const u = Math.max(0, Math.min(1, ((x - p[0]) * dx + (z - p[1]) * dz) / l2));
    return Math.hypot(p[0] + dx * u - x, p[1] + dz * u - z) < width / 2 + m;
  }));
const keepClear: [number, number, number][] = [
  [CABIN.x, CABIN.z + 1, 13], [TOWER.x, TOWER.z + 3, 12], [RUINS.x, RUINS.z, 10], [CAMP.x, CAMP.z, 11],
];
/** Spots for spawns and pickups out in the woods (kept free of trees). */
const woodsSpots: [number, number][] = [
  [-30, 15], [30, 40], [62, 5], [-35, -55], [10, -45], [-15, 70], [40, 68], [70, -15], [-72, 62], [-5, -75], [5, 62], [60, -72], [-40, 30],
];
for (const [x, z] of woodsSpots) keepClear.push([x, z, 2.5]);
function free(x: number, z: number, r: number, gap: number): boolean {
  if (Math.max(Math.abs(x), Math.abs(z)) > 79) return false;
  if (Math.abs(x - streamX(z)) < 5.5 + r) return false;
  if (nearTrail(x, z, r + 0.6)) return false;
  if (keepClear.some(([cx, cz, cr]) => Math.hypot(x - cx, z - cz) < cr + r)) return false;
  return props.every((p) => Math.hypot(p.x - x, p.z - z) > gap);
}
function scatter(kind: PropDef['kind'], count: number, sizeLo: number, sizeHi: number, gap: number, r: number): void {
  for (let n = 0, tries = 0; n < count && tries < count * 40; tries++) {
    const x = (rnd() * 2 - 1) * 84, z = (rnd() * 2 - 1) * 84;
    // Thicker woods in some places, thinner in others.
    if (fbm(x / 30, z / 30, 21, 2) < -0.15 + rnd() * 0.1 && kind !== 'rock') continue;
    if (!free(x, z, r, gap)) continue;
    props.push({ kind, x, z, size: sizeLo + rnd() * (sizeHi - sizeLo), rot: rnd() * 360 });
    n++;
  }
}
// Rocks first (big ones are good cover), then trees, then logs, bushes and stumps in between.
scatter('rock', 34, 0.9, 2.3, 4, 2.2);
scatter('pine', 190, 0.8, 1.35, 4.2, 0.6);
scatter('tree', 110, 0.85, 1.3, 5, 0.7);
scatter('log', 26, 0.7, 1.1, 4, 2.8);
scatter('stump', 18, 0.8, 1.2, 2.5, 0.5);
scatter('bush', 150, 0.8, 1.4, 2.2, 0.9);
// Trees along the cliff tops, so the edge of the map looks like more forest.
for (let n = 0; n < 150; n++) {
  const a = rnd() * 2 - 1, d = 85 + rnd() * 4, side = Math.floor(rnd() * 4);
  const [x, z] = side === 0 ? [a * 89, -d] : side === 1 ? [a * 89, d] : side === 2 ? [-d, a * 89] : [d, a * 89];
  if (Math.abs(x - streamX(z)) < 8) continue;
  props.push({ kind: rnd() < 0.7 ? 'pine' : 'tree', x, z, size: 0.9 + rnd() * 0.5 });
}
// Bushes around the ruins and the cabin clearing's edge, a few rocks by the stream.
for (const [x, z, s] of [[-62, 44, 1.2], [-47, 57, 1.3], [-63, 56, 1.0], [-48, 41, 1.1], [30, -2, 1.2], [6, 12, 1.1], [27, 14, 1.3], [8, -8, 1.0]] as const) props.push({ kind: 'bush', x, z, size: s });
// The fire pit: a ring of stones and logs to sit on.
for (let i = 0; i < 7; i++) {
  const a = (i / 7) * Math.PI * 2;
  props.push({ kind: 'rock', x: CAMP.x + Math.cos(a) * 0.85, z: CAMP.z + Math.sin(a) * 0.85, size: 0.22, rot: i * 50 });
}
// Rubble around the ruins.
for (const [x, z, sz] of [[-7.5, -4, 0.45], [-7, 2, 0.35], [7.4, 0, 0.5], [7.6, -6.5, 0.3], [-1, -7.4, 0.4], [1.5, 7.5, 0.45], [-4.2, 7.3, 0.3], [4.5, -4.2, 0.25], [-4.4, 1.2, 0.22]] as const) {
  props.push({ kind: 'rock', x: RUINS.x + x, z: RUINS.z + z, size: sz, rot: x * 40 });
}
props.push({ kind: 'log', x: CAMP.x, z: CAMP.z + 2.4, size: 0.5, rot: 0 }, { kind: 'log', x: CAMP.x - 2.4, z: CAMP.z, size: 0.5, rot: 90 });

// ---- Pickups out in the woods ----------------------------------------------------------------------------
const at = (x: number, z: number) => ({ x, y: top(x, z), z });
k.pickups.push(
  { type: 'health', ...at(30, 40) },
  { type: 'health', ...at(-35, -55) },
  { type: 'ammo', ...at(62, 5) },
  { type: 'ammo', ...at(-15, 70) },
  { type: 'ammo', ...at(10, -45) },
  { type: 'health', ...at(streamX(38) + 9.5, 38) },
);

const spawn = (x: number, z: number) => spawnAt(x, top(x, z), z, (Math.atan2(x, z) * 180) / Math.PI);

export const forest: MapDef = {
  id: 'forest',
  name: 'Forest',
  description: 'Rolling wooded hills with a stream, a log cabin, a watchtower, old ruins and a campsite. Bushes hide you from bots.',
  skyColor: 0xc9d3cf,
  // Late afternoon: a low, warm sun through a light haze.
  sky: {
    zenith: 0x4a7fbf,
    mid: 0x9fb8cc,
    horizon: 0xd6d8cc,
    ground: 0x3e4a32,
    sunColor: 0xffe2b8,
    sunElevation: 32,
    sunAzimuth: 235,
    sunIntensity: 2.3,
    clouds: 0.32,
    skyline: false,
  },
  fogNear: 30,
  fogFar: 150,
  indoorShading: 0.35,
  navSpacing: 1.5,
  terrain,
  props,
  boxes: k.boxes,
  ramps: k.ramps,
  lamps: k.lamps,
  pickups: k.pickups,
  playerSpawns: [spawn(-30, 15), spawn(40, 68), spawn(70, -15), spawn(-5, -75), spawn(CABIN.x, CABIN.z + 9), spawn(-72, 62)],
  botSpawns: [
    spawn(5, 62), spawn(60, -72), spawn(-35, -55), spawn(30, 40), spawn(62, 5), spawn(-15, 70),
    spawn(10, -45), spawn(CAMP.x + 2, CAMP.z + 8), spawn(RUINS.x + 2, RUINS.z + 8.5), spawn(TOWER.x - 5, TOWER.z - 5),
    spawn(CABIN.x - 9, CABIN.z - 3), spawn(-40, 30),
  ],
};
