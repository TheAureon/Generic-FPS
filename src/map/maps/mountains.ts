import type { MapDef, MaterialId, PropDef } from '../MapTypes';
import { MapKit, door, spawnAt, win } from '../kit';
import { fbm, makeTerrain, seededRandom, smoothstep, terrainRangeUnder } from '../terrain';

/**
 * MOUNTAIN PLAINS — wide grassy plains (210 x 210 m to play in) in a valley
 * ringed by snow-capped mountains.
 *
 *   - a farm (south-east): farmhouse, a big barn with a hayloft, a silo,
 *     a paddock and hay bales in the fields
 *   - a relay station (north) on a hill: a concrete bunker and a radio mast
 *     (armor inside)
 *   - a rocky ridge (west): a cliff on its east side, a gentle slope up the
 *     back, boulders at its foot. A good spot for the sniper rifle.
 *   - a river across the south with an old stone bridge (or wade across)
 *   - a lake (north-west) with a boathouse and a jetty
 *   - dry-stone walls between the fields, dirt roads, lone trees and pine groves
 *
 * Long sightlines: good for the rifle and sniper, with walls, bales and
 * rocks to move between. The mountains are scenery: you can't reach them.
 * Coordinates: X west (-) to east (+), Z north (-) to south (+), Y up.
 */

const PLAY = 105; // half size of the area you can walk in
const OUTER = 160; // half size of the whole terrain (mountains beyond the play area)
const k = new MapKit({ doorHeight: 2.2 });
const { box, span } = { box: k.box.bind(k), span: k.span.bind(k) };

// ---- Landmarks --------------------------------------------------------------------------------
const FARM = { x: 58, z: 70 };
const STATION = { x: 20, z: -78 };
const LAKE = { x: -30, z: -62, r: 17 };
/** The rocky ridge runs north-south along x = RIDGE.x, from z0 to z1. */
const RIDGE = { x: -65, z0: -45, z1: -5, h: 9 };

/** The river's center line (z for a given x). */
const riverZ = (x: number) => 30 + 12 * Math.sin(x / 40) + 5 * Math.sin(x / 17 + 2);

// ---- The ground -------------------------------------------------------------------------------
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const dist = (x: number, z: number, p: { x: number; z: number }) => Math.hypot(x - p.x, z - p.z);

/** Gentle rolling plains. */
const plains = (x: number, z: number) => fbm(x / 70, z / 70, 31) * 6 + fbm(x / 20, z / 20, 37, 3) * 1.0;
const levels = {
  farm: plains(FARM.x, FARM.z),
  station: plains(STATION.x, STATION.z) + 15,
  lake: plains(LAKE.x, LAKE.z) - 1.2,
};

/** Distance from the ridge's crest line, and which side of it (east = cliff). */
function ridgeHeight(x: number, z: number): number {
  const dz = z < RIDGE.z0 ? RIDGE.z0 - z : z > RIDGE.z1 ? z - RIDGE.z1 : 0;
  const dx = x - RIDGE.x;
  // East: a cliff (rises over 4 m). West and the ends: a long, walkable slope.
  const across = dx > 0 ? smoothstep(6, 2, Math.hypot(dx, dz * 0.25)) : smoothstep(32, 2, Math.hypot(dx, dz));
  const along = smoothstep(20, 0, dz);
  return RIDGE.h * Math.min(across, along) * (1 + fbm(x / 6, z / 6, 41, 2) * 0.12);
}

/** Everything except the water: plains, the landmarks' spots, the ridge and the mountains. */
function land(x: number, z: number): number {
  let h = plains(x, z);
  h = lerp(h, levels.farm, smoothstep(45, 30, dist(x, z, FARM)));
  h = lerp(h, levels.station, smoothstep(55, 12, dist(x, z, STATION)));
  h += ridgeHeight(x, z);
  // Mountains all round: rising from just outside the play area, with peaks and snow.
  const r = Math.pow(Math.pow(Math.abs(x), 4) + Math.pow(Math.abs(z), 4), 0.25);
  const m = smoothstep(100, 155, r);
  h += m * (48 + 30 * fbm(x / 35, z / 35, 77)) + m * m * 20 * Math.abs(fbm(x / 18, z / 18, 79, 3));
  return h;
}

/** River bed: a little below the plains beside it, smoothed along its length. */
function bedRaw(x: number): number {
  const cz = riverZ(x);
  return Math.min(plains(x, cz), plains(x, cz - 12), plains(x, cz + 12)) - 1.8;
}
const bed = (x: number) => (bedRaw(x - 8) + bedRaw(x - 4) + bedRaw(x) + bedRaw(x + 4) + bedRaw(x + 8)) / 5;

function height(x: number, z: number): number {
  let h = land(x, z);
  // The lake: a shallow bowl.
  h = lerp(h, Math.min(h, levels.lake - 1.0), smoothstep(LAKE.r + 4, LAKE.r - 6, dist(x, z, LAKE)));
  // The river (only ever lowers the ground).
  const k = smoothstep(11, 4, Math.abs(z - riverZ(x)));
  return h - k * Math.max(0, h - bed(x));
}

// Dirt roads (also used to keep trees and walls off them).
const roads: { points: [number, number][]; width: number }[] = [
  // Farm → stone bridge → crossroads → relay station.
  { points: [[FARM.x - 8, FARM.z - 4], [38, 52], [16, 44], [0, riverZ(0) + 10], [0, riverZ(0) - 10], [0, 12], [0, 0], [6, -24], [12, -48], [STATION.x - 2, STATION.z + 12]], width: 3.4 },
  // West to east across the middle (round the north end of the ridge).
  { points: [[-98, 6], [-72, 4], [-48, 6], [-22, 4], [0, 0], [26, -8], [52, -14], [78, -12], [98, -18]], width: 3 },
  // Crossroads → lake.
  { points: [[-22, 4], [-26, -18], [-12, -40], [-10, -56]], width: 2.6 },
];

const terrain = makeTerrain(-OUTER, -OUTER, OUTER * 2, OUTER * 2, 2.5, height, { material: 'grass', paths: roads, snowLine: 40 });
/** Highest / lowest ground under a small footprint. */
const top = (x: number, z: number, r = 0.4) => terrainRangeUnder(terrain, x, z, r)[1];
const low = (x: number, z: number, r = 0.4) => terrainRangeUnder(terrain, x, z, r)[0];

// ---- Water (you wade through it: it isn't solid) -------------------------------------------------
// The river, in 3 m strips (each sloping a little, so the surface is continuous), about knee deep.
for (let x = -OUTER; x < OUTER; x += 3) {
  const xc = x + 1.5;
  const a = bed(x) + 0.6, b = bed(x + 3) + 0.6;
  k.ramps.push({ x: xc, z: riverZ(xc), w: 3, d: 11, low: Math.min(a, b), high: Math.max(a, b), dir: b >= a ? '+x' : '-x', base: Math.min(a, b) - 2.5, material: 'water', decor: true });
}
// The lake, in 3 m strips across the circle.
const lakeSurface = levels.lake - 0.25;
for (let z = LAKE.z - LAKE.r; z < LAKE.z + LAKE.r; z += 3) {
  const zc = z + 1.5;
  const half = Math.sqrt(Math.max(0, LAKE.r * LAKE.r - (zc - LAKE.z) ** 2)) + 1.5;
  k.boxes.push({ x: LAKE.x, y: lakeSurface - 2, z: zc, w: half * 2, h: 2, d: 3, material: 'water', decor: true });
}

// ---- The stone bridge (on the main road) --------------------------------------------------------
{
  const rz = riverZ(0), z0 = rz - 10, z1 = rz + 10;
  const hn = top(0, z0, 2) + 0.05, hs = top(0, z1, 2) + 0.05;
  const lowEnd = Math.min(hn, hs);
  const dir = hs > hn ? '+z' : '-z';
  k.ramps.push({ x: 0, z: rz, w: 4.4, d: z1 - z0, low: Math.min(hn, hs), high: Math.max(hn, hs), dir, base: lowEnd - 0.9, material: 'ruin' });
  // Low walls (parapets) along both sides, in steps that follow the deck.
  for (let z = z0; z < z1 - 0.01; z += 2.5) {
    const y = lerp(hn, hs, (z + 1.25 - z0) / (z1 - z0));
    for (const s of [-1, 1]) span(s * 2.2 - 0.25, s * 2.2 + 0.25, y - 0.3, y + 0.75, z, z + 2.5, 'ruin');
  }
  // Two piers in the river.
  for (const z of [rz - 3, rz + 3]) span(-1.8, 1.8, bed(0) - 1, lowEnd - 0.85, z - 0.8, z + 0.8, 'ruin');
  k.pickups.push({ type: 'ammo', x: 6, y: top(6, z1 + 3), z: z1 + 3 });
}

// ---- The farm ----------------------------------------------------------------------------------------
{
  // Farmhouse: stone walls, a metal roof, two rooms.
  {
    const x0 = 43, x1 = 53, z0 = 72, z1 = 80, Y = top((x0 + x1) / 2, (z0 + z1) / 2, 5.5) + 0.3, WALL = 2.8;
    span(x0, x1, low((x0 + x1) / 2, (z0 + z1) / 2, 5.5) - 0.5, Y, z0, z1, 'stone', { top: 'desk' });
    const o = { t: 0.35, mat: 'stone' as MaterialId, y0: Y, y1: Y + WALL };
    k.wall('x', z0 + 0.175, { ...o, faces: { '+z': 'drywall' }, from: x0, to: x1, openings: [win(44.5, 46, 0.9, 1.9), win(50, 51.5, 0.9, 1.9)] });
    k.wall('x', z1 - 0.175, { ...o, faces: { '-z': 'drywall' }, from: x0, to: x1, openings: [win(44.2, 45.7, 0.9, 1.9), door(46.6, 48.4), win(50.5, 52, 0.9, 1.9)] });
    k.wall('z', x0 + 0.175, { ...o, faces: { '+x': 'drywall' }, from: z0 + 0.35, to: z1 - 0.35, openings: [win(75, 77, 0.9, 1.9)] });
    k.wall('z', x1 - 0.175, { ...o, faces: { '-x': 'drywall' }, from: z0 + 0.35, to: z1 - 0.35, openings: [door(75.1, 76.9)] });
    k.wall('z', 49, { t: 0.15, y0: Y, y1: Y + WALL, from: z0 + 0.35, to: z1 - 0.35, openings: [door(76.2, 78)] });
    const R = Y + WALL;
    k.ramps.push({ x: 48, z: 74.1, w: 11, d: 4.6, low: R - 0.3, high: R + 1.8, dir: '+z', base: R - 0.3, material: 'partition' });
    k.ramps.push({ x: 48, z: 77.9, w: 11, d: 4.6, low: R - 0.3, high: R + 1.8, dir: '-z', base: R - 0.3, material: 'partition' });
    k.model('table', 46, Y, 74.5, 1.6, 0.78, 1.0, { variant: 1 }); // kitchen table
    for (const dz of [-1, 1]) k.model('cafeChair', 46, Y, 74.5 + dz * 0.75, 0.45, 0.85, 0.45, { rot: dz > 0 ? 180 : 0, decor: true });
    k.model('counter', 44, Y, 73, 0.7, 0.92, 1.8, { rot: 90 }); // counter
    k.model('bed', 51.8, Y, 73.4, 1.9, 0.5, 1.0); // bed
    box(50, Y, 72.6, 1.2, 1.8, 0.4, 'desk'); // wardrobe
    k.lamp(46, R - 0.4, 76, 0.9, 6, 0xffdcaa);
    k.lamp(51, R - 0.4, 76, 0.9, 6, 0xffdcaa);
    k.pickups.push({ type: 'health', x: 47.5, y: Y, z: 77.5 });
  }
  // Barn: plank walls, a red metal roof, big doors at both ends, a hayloft.
  {
    const x0 = 58, x1 = 74, z0 = 59, z1 = 69, Y = top(66, 64, 8) + 0.1, WALL = 5.5, LOFT = Y + 3.2;
    span(x0, x1, low(66, 64, 8) - 0.5, Y, z0, z1, 'concrete', { top: 'floor' });
    const o = { t: 0.3, mat: 'barnwood' as MaterialId, y0: Y, y1: Y + WALL };
    k.wall('x', z0 + 0.15, { ...o, from: x0, to: x1, openings: [win(68, 70, 3.8, 4.8)] });
    k.wall('x', z1 - 0.15, { ...o, from: x0, to: x1, openings: [door(65, 67, 2.4), win(69.5, 71.5, 3.8, 4.8)] });
    k.wall('z', x0 + 0.15, { ...o, from: z0 + 0.3, to: z1 - 0.3, openings: [door(61.5, 66.5, 4.2)] });
    k.wall('z', x1 - 0.15, { ...o, from: z0 + 0.3, to: z1 - 0.3, openings: [door(61.5, 66.5, 2.9)] });
    // Hayloft over the east half, with a ramp up along the north wall.
    k.slab(66, x1 - 0.3, z0 + 0.3, z1 - 0.3, LOFT - 0.25, 0.25, 'planks', 'planks', 'planks');
    k.ramps.push({ x: 62.2, z: 60.3, w: 7.6, d: 2.0, low: Y, high: LOFT, dir: '+x', base: Y, material: 'planks' });
    span(66, 66.12, LOFT, LOFT + 1.0, 61.9, z1 - 0.3, 'planks'); // loft railing
    // Roof.
    const R = Y + WALL;
    k.ramps.push({ x: 66, z: 61.3, w: 17, d: 5.6, low: R - 0.3, high: R + 2.6, dir: '+z', base: R - 0.3, material: 'container' });
    k.ramps.push({ x: 66, z: 66.7, w: 17, d: 5.6, low: R - 0.3, high: R + 2.6, dir: '-z', base: R - 0.3, material: 'container' });
    // Hay bales: downstairs and in the loft.
    for (const [x, z, y] of [[60, 67.4, Y], [61.5, 67.4, Y], [60.7, 67.4, Y + 1.2], [72.4, 60.8, LOFT], [72.4, 62.2, LOFT], [72.4, 60.8, LOFT + 1.2], [70.9, 67.4, LOFT], [72.4, 67.4, LOFT]] as const) k.model('hayBale', x, y, z, 1.4, 1.2, 1.3);
    k.model('trough', 70, Y, 61, 3, 0.8, 1.0); // feed trough
    k.lamp(62, R - 0.3, 64, 1.0, 8, 0xffe2b0);
    k.lamp(70, R - 0.3, 64, 1.0, 8, 0xffe2b0);
    k.pickups.push({ type: 'ammo', x: 63, y: Y, z: 66 });
    k.pickups.push({ type: 'health', x: 69.5, y: LOFT, z: 65 });
  }
  // Silo and a water tank.
  k.model('silo', 79, top(79, 74, 2.5) - 0.5, 74, 4.2, 14, 4.2);
  k.model('fuelTank', 78, top(78, 62, 1.2), 62, 2.4, 1.6, 1.4);
  // Paddock fence (with a gate gap on the road side).
  const fence = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az), n = Math.round(len / 2.5);
    for (let i = 0; i <= n; i++) {
      const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n;
      k.model('post', x, low(x, z, 0.2) - 0.3, z, 0.16, top(x, z, 0.2) - low(x, z, 0.2) + 1.4, 0.16);
      if (i === n) break;
      const nx = ax + ((bx - ax) * (i + 1)) / n, nz = az + ((bz - az) * (i + 1)) / n;
      const y = Math.max(top(x, z, 0.2), top(nx, nz, 0.2));
      for (const ry of [0.5, 0.95]) {
        if (ax === bx) span(x - 0.04, x + 0.04, y + ry, y + ry + 0.1, Math.min(z, nz), Math.max(z, nz), 'desk');
        else span(Math.min(x, nx), Math.max(x, nx), y + ry, y + ry + 0.1, z - 0.04, z + 0.04, 'desk');
      }
    }
  };
  fence(76, 80, 96, 80);
  fence(96, 80, 96, 96);
  fence(76, 96, 96, 96);
  fence(76, 80, 76, 85);
  fence(76, 90, 76, 96);
}

// ---- The relay station ------------------------------------------------------------------------------
{
  const { x: X, z: Z } = STATION;
  const G = levels.station;
  // Concrete bunker.
  const x0 = X - 6, x1 = X + 4, z0 = Z - 4, z1 = Z + 3, WALL = 3.2;
  span(x0, x1, G - 0.6, G + 0.15, z0, z1, 'concrete', { top: 'floor' });
  const Y = G + 0.15;
  const o = { t: 0.4, mat: 'concrete' as MaterialId, y0: Y, y1: Y + WALL };
  k.wall('x', z0 + 0.2, { ...o, from: x0, to: x1, openings: [win(X - 4, X - 2.5, 1.2, 1.9), win(X + 0.5, X + 2, 1.2, 1.9)] });
  k.wall('x', z1 - 0.2, { ...o, from: x0, to: x1, openings: [door(X - 1.9, X - 0.1), win(X + 1, X + 2.6, 1.2, 1.9)] });
  k.wall('z', x0 + 0.2, { ...o, from: z0 + 0.4, to: z1 - 0.4, openings: [win(Z - 1.5, Z, 1.2, 1.9)] });
  k.wall('z', x1 - 0.2, { ...o, from: z0 + 0.4, to: z1 - 0.4, openings: [door(Z - 1.6, Z + 0.2)] });
  span(x0 - 0.3, x1 + 0.3, Y + WALL, Y + WALL + 0.35, z0 - 0.3, z1 + 0.3, 'concrete', { bottom: 'ceiling' });
  k.model('table', X - 4.2, Y, Z - 2.9, 2.6, 0.78, 0.9); // radio desk
  k.model('radio', X - 4.2, Y + 0.78, Z - 3.1, 1.6, 0.5, 0.45);
  k.model('radio', X + 2.6, Y, Z - 3.1, 1.4, 2.0, 0.7); // equipment cabinet
  k.model('officeChair', X - 4.2, Y, Z - 1.9, 0.55, 1.0, 0.55, { rot: 180, decor: true });
  k.lamp(X - 1, Y + WALL - 0.08, Z - 0.5, 1.0, 7, 0xe8f0ff);
  k.pickups.push({ type: 'armor', x: X - 1, y: Y, z: Z - 1.5 });
  // Radio mast: four legs with cross braces, on a concrete pad.
  const MX = X + 9, MZ = Z - 5, M = 22;
  span(MX - 1.6, MX + 1.6, G - 0.5, G + 0.25, MZ - 1.6, MZ + 1.6, 'concrete');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(MX + sx * 0.8, G + 0.25, MZ + sz * 0.8, 0.18, M, 0.18, 'metal');
  for (let y = G + 3; y < G + M; y += 3) {
    for (const s of [-1, 1]) {
      span(MX - 0.8, MX + 0.8, y, y + 0.1, MZ + s * 0.8 - 0.05, MZ + s * 0.8 + 0.05, 'metal');
      span(MX + s * 0.8 - 0.05, MX + s * 0.8 + 0.05, y, y + 0.1, MZ - 0.8, MZ + 0.8, 'metal');
    }
  }
  box(MX, G + 0.25 + M, MZ, 0.12, 4, 0.12, 'metal');
  // Fuel tanks, barriers along the road in.
  k.model('fuelTank', X - 9, G, Z - 2, 1.6, 1.6, 3.2);
  k.model('fuelTank', X - 9, G, Z + 2, 1.6, 1.6, 3.2);
  for (const x of [X - 4, X + 2]) box(x, top(x, Z + 9, 1), Z + 9, 3, 1, 0.5, 'trim');
  box(X + 6, G, Z + 2, 1.4, 1.2, 1.4, 'crate');
  k.pickups.push({ type: 'ammo', x: X + 6, y: G, z: Z + 4.5 });
}

// ---- The boathouse and jetty (lake) -------------------------------------------------------------------
{
  const HX = LAKE.x + 22, HZ = LAKE.z - 2;
  const Y = top(HX, HZ, 3) + 0.2, WALL = 2.5;
  span(HX - 3, HX + 3, low(HX, HZ, 3) - 0.5, Y, HZ - 2.5, HZ + 2.5, 'ruin', { top: 'desk' });
  const o = { t: 0.35, mat: 'ruin' as MaterialId, y0: Y, y1: Y + WALL };
  k.wall('x', HZ - 2.325, { ...o, from: HX - 3, to: HX + 3, openings: [win(HX - 0.8, HX + 0.8, 0.9, 1.8)] });
  k.wall('x', HZ + 2.325, { ...o, from: HX - 3, to: HX + 3 });
  k.wall('z', HX - 2.825, { ...o, from: HZ - 2.15, to: HZ + 2.15, openings: [door(HZ - 0.9, HZ + 0.9)] });
  k.wall('z', HX + 2.825, { ...o, from: HZ - 2.15, to: HZ + 2.15, openings: [win(HZ - 0.8, HZ + 0.8, 0.9, 1.8)] });
  k.ramps.push({ x: HX, z: HZ, w: 6.8, d: 5.6, low: Y + WALL, high: Y + WALL + 1.3, dir: '-x', base: Y + WALL, material: 'planks' });
  k.model('table', HX + 1.5, Y, HZ + 1.3, 1.6, 0.8, 0.9, { variant: 1 });
  k.pickups.push({ type: 'health', x: HX + 0.5, y: Y, z: HZ - 1 });
  // Jetty out over the water.
  const JY = lakeSurface + 0.35;
  span(LAKE.x + 8, LAKE.x + 19.5, JY - 0.2, JY, HZ - 0.8, HZ + 0.8, 'planks');
  for (let x = LAKE.x + 8.5; x < LAKE.x + 19.5; x += 2.5) for (const s of [-1, 1]) k.model('post', x, JY - 2, HZ + s * 0.75, 0.16, 2.6, 0.16);
  // A rowing boat (upside down on the shore) and crates.
  k.model('boat', HX - 4.5, top(HX - 4.5, HZ + 5, 1.5) - 0.05, HZ + 5, 3.2, 0.5, 1.2);
  box(HX + 4.5, top(HX + 4.5, HZ - 3, 0.8), HZ - 3, 1.2, 1.0, 1.2, 'crate');
}

// ---- The ridge: rocks on top, boulders at the foot of the cliff --------------------------------------
const props: PropDef[] = [];
const ridgeTop = (z: number) => top(RIDGE.x - 1.5, z, 1);
k.pickups.push({ type: 'health', x: RIDGE.x - 2, y: ridgeTop(-30), z: -30 });
k.pickups.push({ type: 'ammo', x: RIDGE.x - 2, y: ridgeTop(-16), z: -16 });
for (const [x, z, s] of [[RIDGE.x - 0.5, -38, 1.0], [RIDGE.x - 0.3, -24, 0.9], [RIDGE.x - 0.2, -10, 1.1], [RIDGE.x + 7, -40, 2.4], [RIDGE.x + 8, -30, 2.0], [RIDGE.x + 6.5, -20, 2.6], [RIDGE.x + 9, -12, 1.8], [RIDGE.x + 12, -34, 1.4], [RIDGE.x + 11, -6, 2.0]] as const) {
  props.push({ kind: 'rock', x, z, size: s, rot: x * 13 + z * 7 });
}

// ---- Dry-stone walls between the fields (gaps where roads cross) ---------------------------------------
const rnd = seededRandom(777);
const nearRoad = (x: number, z: number, m: number) =>
  roads.some(({ points, width }) => points.some((p, i) => {
    const q = points[i + 1];
    if (!q) return false;
    const dx = q[0] - p[0], dz = q[1] - p[1], l2 = dx * dx + dz * dz;
    const u = Math.max(0, Math.min(1, ((x - p[0]) * dx + (z - p[1]) * dz) / l2));
    return Math.hypot(p[0] + dx * u - x, p[1] + dz * u - z) < width / 2 + m;
  }));
const nearRiver = (x: number, z: number, m: number) => Math.abs(z - riverZ(x)) < 11 + m;
/** A stone wall along X (alongX) or Z, in 3 m pieces that follow the ground. */
function stoneWall(a: number, b: number, at: number, alongX: boolean): void {
  for (let p = a; p < b - 0.01; p += 3) {
    const c = p + 1.5;
    const [x, z] = alongX ? [c, at] : [at, c];
    if (nearRoad(x, z, 1.5) || nearRiver(x, z, 1) || rnd() < 0.1) continue;
    const g = top(x, z, 1.5), l = low(x, z, 1.5);
    const h = 0.95 + rnd() * 0.2;
    if (alongX) span(p, p + 3, l - 0.3, g + h, at - 0.35, at + 0.35, 'ruin');
    else span(at - 0.35, at + 0.35, l - 0.3, g + h, p, p + 3, 'ruin');
  }
}
stoneWall(12, 48, 12, true);
stoneWall(-16, -46, 30, false);
stoneWall(-50, -10, -25, true);
stoneWall(-45, -14, 55, true);
stoneWall(-14, 18, -20, true);
stoneWall(-50, -18, 32, false);
stoneWall(66, 98, 20, true);
stoneWall(-40, -12, 70, false);
stoneWall(30, 54, -30, true);
stoneWall(-60, -28, 82, false);
stoneWall(-88, -60, 40, true);
stoneWall(40, 90, -40, true);
stoneWall(60, 90, 70, false);

// ---- Hay bales in the fields --------------------------------------------------------------------------
for (const [cx, cz] of [[86, 88], [40, 90], [84, 50], [30, 70]] as const) {
  for (let i = 0; i < 4; i++) {
    const x = cx + (rnd() - 0.5) * 16, z = cz + (rnd() - 0.5) * 12;
    if (nearRoad(x, z, 1.5) || nearRiver(x, z, 2)) continue;
    const y = low(x, z, 0.8) - 0.05;
    const lift = top(x, z, 0.8) - low(x, z, 0.8);
    if (rnd() < 0.55) {
      // A big round bale.
      k.model('roundBale', x, y - 0.05, z, 1.5, 1.3 + lift, 1.3);
    } else {
      k.model('hayBale', x, y, z, 1.5, 1.25 + lift, 1.3);
      if (rnd() < 0.5) k.model('hayBale', x + 0.1, y + 1.25 + lift, z, 1.5, 1.25, 1.3);
    }
  }
}

// ---- Trees, bushes, rocks ---------------------------------------------------------------------------------
const keepClear: [number, number, number][] = [
  [FARM.x + 2, FARM.z + 4, 26], [STATION.x + 2, STATION.z, 17], [LAKE.x, LAKE.z, LAKE.r + 4], [LAKE.x + 22, LAKE.z - 2, 6], [0, riverZ(0), 13],
];
/** Spots for spawns and pickups out in the open (kept free of trees). */
const openSpots: [number, number][] = [
  [-85, -80], [85, -75], [-88, 85], [5, 92], [92, 10], [-20, -88], [-40, 20], [35, 15], [-85, -20], [62, -55], [-10, 58], [25, -60], [-55, 70], [70, 40],
];
for (const [x, z] of openSpots) keepClear.push([x, z, 3]);
function free(x: number, z: number, r: number, gap: number, inPlay = true): boolean {
  if (inPlay && Math.max(Math.abs(x), Math.abs(z)) > PLAY - 3) return false;
  if (nearRiver(x, z, r) || nearRoad(x, z, r + 0.5)) return false;
  if (keepClear.some(([cx, cz, cr]) => Math.hypot(x - cx, z - cz) < cr + r)) return false;
  if (Math.abs(x - RIDGE.x - 3) < 4 && z > RIDGE.z0 - 4 && z < RIDGE.z1 + 4) return false; // cliff face
  return props.every((p) => Math.hypot(p.x - x, p.z - z) > gap);
}
function scatter(kind: PropDef['kind'], count: number, sizeLo: number, sizeHi: number, gap: number, r: number, where?: (x: number, z: number) => boolean): void {
  for (let n = 0, tries = 0; n < count && tries < count * 60; tries++) {
    const x = (rnd() * 2 - 1) * (PLAY - 3), z = (rnd() * 2 - 1) * (PLAY - 3);
    if (where && !where(x, z)) continue;
    if (!free(x, z, r, gap)) continue;
    props.push({ kind, x, z, size: sizeLo + rnd() * (sizeHi - sizeLo), rot: rnd() * 360 });
    n++;
  }
}
// Pine groves near the mountains, a few lone leafy trees on the plains.
const edge = (x: number, z: number) => Math.max(Math.abs(x), Math.abs(z));
const grove = (x: number, z: number) => edge(x, z) > 78 && fbm(x / 25, z / 25, 91, 2) > -0.05;
scatter('pine', 110, 0.9, 1.4, 4.5, 0.6, grove);
scatter('tree', 30, 0.95, 1.4, 14, 0.8, (x, z) => edge(x, z) < 85);
scatter('rock', 45, 0.8, 2.6, 6, 2.2);
scatter('bush', 70, 0.8, 1.3, 4, 0.9);
scatter('log', 8, 0.8, 1.1, 6, 2.8, grove);
// Trees and rocks on the lower mountain slopes, outside the play area (scenery).
for (let n = 0; n < 420; n++) {
  const x = (rnd() * 2 - 1) * (OUTER - 8), z = (rnd() * 2 - 1) * (OUTER - 8);
  if (edge(x, z) < PLAY + 2) continue;
  const h = top(x, z, 1);
  if (h > 30 + rnd() * 6 || top(x, z, 2) - low(x, z, 2) > 3) continue; // not up in the snow, not on cliffs
  props.push({ kind: rnd() < 0.85 ? 'pine' : 'rock', x, z, size: 1 + rnd() * 0.6 });
}

// ---- Pickups out in the open -----------------------------------------------------------------------------
const at = (x: number, z: number) => ({ x, y: top(x, z), z });
k.pickups.push(
  { type: 'health', ...at(-40, 20) },
  { type: 'health', ...at(62, -55) },
  { type: 'ammo', ...at(35, 15) },
  { type: 'ammo', ...at(-10, 58) },
  { type: 'ammo', ...at(-55, 70) },
  { type: 'health', ...at(70, 40) },
);

const spawn = (x: number, z: number) => spawnAt(x, top(x, z), z, (Math.atan2(x, z) * 180) / Math.PI);

export const mountains: MapDef = {
  id: 'mountains',
  name: 'Mountain Plains',
  description: 'Wide grassy plains ringed by snowy mountains: a farm, a relay station on a hill, a rocky ridge, a river and a lake. Long sightlines.',
  skyColor: 0xcfdcea,
  // A bright, clear day.
  sky: {
    zenith: 0x2f6fc4,
    mid: 0x7fa8d8,
    horizon: 0xd3dfea,
    ground: 0x5a6448,
    sunColor: 0xfff4e2,
    sunElevation: 52,
    sunAzimuth: 150,
    sunIntensity: 2.5,
    clouds: 0.3,
    skyline: false,
  },
  fogNear: 90,
  fogFar: 430,
  indoorShading: 0.35,
  navSpacing: 2,
  playArea: { x0: -PLAY, z0: -PLAY, x1: PLAY, z1: PLAY },
  terrain,
  props,
  boxes: k.boxes,
  ramps: k.ramps,
  lamps: k.lamps,
  pickups: k.pickups,
  playerSpawns: [spawn(-85, -80), spawn(85, -75), spawn(-88, 85), spawn(5, 92), spawn(92, 10), spawn(-20, -88)],
  botSpawns: [
    spawn(-40, 20), spawn(35, 15), spawn(-85, -20), spawn(62, -55), spawn(-10, 58), spawn(25, -60),
    spawn(-55, 70), spawn(70, 40), spawn(FARM.x - 18, FARM.z - 6), spawn(STATION.x - 2, STATION.z + 8),
    spawn(RIDGE.x - 6, -26), spawn(0, 0),
  ],
};
