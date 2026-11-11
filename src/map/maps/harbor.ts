import type { MapDef } from '../MapTypes';
import { door, gap, MapKit, spawnAt, win } from '../kit';

/**
 * HARBOR — a container dock at dusk (80 x 56 m of quay, plus a pier).
 *
 *   North road and fence
 *   West warehouse      | container yard (stacks you can climb) | east warehouse
 *   (mezzanine)         | gantry crane over the yard            | (mezzanine)
 *   Quay: bollards, crates, a fuel tank, the harbor office cabin
 *   South: the water, with a wooden pier sticking out into it
 *
 * Coordinates: X west (-) to east (+), Z north (-) to south (+), Y up.
 */

const k = new MapKit({ doorHeight: 2.3 });
const HX = 40; // half width
const NZ = -28, QZ = 20; // north fence, quay edge (water beyond)
const WH = 7.5; // warehouse height
const MEZZ = 3.6; // warehouse mezzanine floor

// ---- Ground, water, boundary --------------------------------------------------------------
k.span(-HX - 1, HX + 1, -1, 0, NZ - 1, QZ, 'asphalt');
// Water: a dark sheet below the quay, out to the horizon (decor: nothing walks on it).
k.boxes.push({ x: 0, y: -2.2, z: QZ + 30, w: 220, h: 0.2, d: 60, material: 'water', decor: true });
// Quay wall face and its top edge (concrete), yellow safety line.
k.span(-HX - 1, HX + 1, -3, -0.02, QZ, QZ + 0.6, 'concrete');
k.span(-HX, HX, 0, 0.02, QZ - 0.6, QZ - 0.45, 'paint');
// Nobody falls in: an invisible rail along the edge (gap for the pier).
k.boxes.push({ x: (-HX + -3.2) / 2, y: 0, z: QZ + 0.4, w: HX - 3.2, h: 3, d: 0.4, hidden: true });
k.boxes.push({ x: (HX + 3.2) / 2, y: 0, z: QZ + 0.4, w: HX - 3.2, h: 3, d: 0.4, hidden: true });
// North fence (concrete wall), side walls.
k.box(0, 0, NZ - 0.5, HX * 2 + 2, 3.2, 1, 'concrete');
k.box(-HX - 0.5, 0, (NZ + QZ) / 2, 1, 3.2, QZ - NZ, 'concrete');
k.box(HX + 0.5, 0, (NZ + QZ) / 2, 1, 3.2, QZ - NZ, 'concrete');
// Road markings along the north road.
for (let x = -36; x <= 36; x += 6) k.span(x - 1.5, x + 1.5, 0, 0.02, -24.1, -23.9, 'paint');

// ---- The pier: planks out over the water on posts, with a boat tied up ---------------------
k.span(-3.2, 3.2, -0.25, 0, QZ, QZ + 16, 'planks');
for (const z of [QZ + 4, QZ + 9, QZ + 14]) for (const x of [-3, 3]) k.model('post', x, -2.2, z, 0.35, 2.6, 0.35);
k.boxes.push({ x: -3.4, y: 0, z: QZ + 8, w: 0.3, h: 3, d: 16, hidden: true });
k.boxes.push({ x: 3.4, y: 0, z: QZ + 8, w: 0.3, h: 3, d: 16, hidden: true });
k.boxes.push({ x: 0, y: 0, z: QZ + 16.2, w: 7, h: 3, d: 0.3, hidden: true });
k.box(-2.2, 0, QZ + 15, 1.2, 1, 1.2, 'crate');
k.model('radio', 1.6, 0, QZ + 15.2, 0.8, 0.6, 0.5, { decor: true });

// ---- Warehouses ---------------------------------------------------------------------------
/** A big metal shed from x0..x1, z0..z1: roller door on the south, side door, high windows, roof. */
function warehouse(x0: number, x1: number, z0: number, z1: number, sideDoorAt: 'x0' | 'x1'): void {
  const t = 0.3;
  const cx = (x0 + x1) / 2;
  k.span(x0, x1, -0.02, 0, z0, z1, 'concrete');
  // South: a wide roller-door opening and a small door.
  k.wall('x', z1 - t / 2, { from: x0, to: x1, y0: 0, y1: WH, t, mat: 'metal', openings: [gap(cx - 3, cx + 3), door(x0 + 2.3, x0 + 4.0)] });
  k.span(cx - 3, cx + 3, 4.6, WH, z1 - t, z1, 'metal'); // over the roller door
  // North: high windows.
  k.wall('x', z0 + t / 2, { from: x0, to: x1, y0: 0, y1: WH, t, mat: 'metal', openings: [win(x0 + 4, x0 + 8, 4.5, 6.2), win(x1 - 8, x1 - 4, 4.5, 6.2)] });
  // Sides: one has a door out to the yard.
  const inner = sideDoorAt === 'x1' ? x1 - t / 2 : x0 + t / 2;
  const outer = sideDoorAt === 'x1' ? x0 + t / 2 : x1 - t / 2;
  k.wall('z', inner, { from: z0 + t, to: z1 - t, y0: 0, y1: WH, t, mat: 'metal', openings: [door(z0 + 6, z0 + 7.6), win(z1 - 6, z1 - 3, 4.5, 6.2)] });
  k.wall('z', outer, { from: z0 + t, to: z1 - t, y0: 0, y1: WH, t, mat: 'metal', openings: [win(z0 + 4, z0 + 7, 4.5, 6.2)] });
  k.span(x0, x1, WH, WH + 0.3, z0, z1, 'metal', { bottom: 'ceiling' });
  // Mezzanine along the north wall, with stairs and a railing.
  k.slab(x0 + t, x1 - t, z0 + t, z0 + 5, MEZZ - 0.25, 0.25, 'planks', 'metal', 'metal');
  const sx = sideDoorAt === 'x1' ? x0 + 2 : x1 - 2;
  k.stairs(sx, z0 + 9, 2.2, 8, 0, MEZZ, '-z');
  // (The railing leaves a gap at the top of the stairs.)
  const r0 = sideDoorAt === 'x1' ? x0 + 3.4 : x0 + t, r1 = sideDoorAt === 'x1' ? x1 - t : x1 - 3.4;
  k.span(r0, r1, MEZZ, MEZZ + 1.0, z0 + 5, z0 + 5.08, 'glass');
  k.span(r0, r1, MEZZ + 1.0, MEZZ + 1.06, z0 + 4.98, z0 + 5.1, 'metal');
  // Shelving rows and crates.
  for (const dz of [8.5, 12]) for (const dx of [-3, 3.5]) k.model('shelf', cx + dx, 0, z0 + dz, 5, 2.4, 1.1);
  k.box(cx - 6, 0, z1 - 3, 1.5, 1.5, 1.5, 'crate');
  k.box(cx - 4.4, 0, z1 - 2.6, 1.2, 1.1, 1.2, 'crate');
  k.box(cx + 6, 0, z1 - 3.5, 2.4, 1.3, 1.6, 'crate');
  k.box(cx + 2, MEZZ, z0 + 2.5, 1.5, 1.2, 1.5, 'crate');
  k.box(cx - 3, MEZZ, z0 + 2, 2, 1.0, 1.2, 'crate');
  // Lights.
  for (const dx of [-5, 5]) {
    k.lamp(cx + dx, WH - 0.15, z0 + 10, 1.4, 11, 0xffe0b0);
    k.lamp(cx + dx, MEZZ - 0.3, z0 + 2.5, 0.8, 6, 0xffe0b0);
  }
  k.lamp(cx, 4.4, z1 + 0.18, 1.3, 9, 0xffb060, '+z'); // over the roller door, outside
}
warehouse(-38, -18, -22, -6, 'x1');
warehouse(18, 38, -22, -6, 'x0');

// ---- Container yard -------------------------------------------------------------------------
const PAINT = [0x8a3b2c, 0x2f5d8a, 0x3d6b35, 0xc28a2c, 0x6e7d8f, 0x7a2f5a];
let pi = 0;
/** A container (6.06 x 2.59 x 2.44); `alongX` lies it east-west. */
function container(x: number, y: number, z: number, alongX: boolean): void {
  k.model('shippingContainer', x, y, z, alongX ? 6.06 : 2.44, 2.59, alongX ? 2.44 : 6.06, { rot: alongX ? 90 : 0, tint: PAINT[pi++ % PAINT.length] });
}
// Rows running north-south with lanes between them; some stacked two high.
const rows: [number, number, boolean][] = [
  [-12, -18, true], [-12, -11, false], [-12, -1, true],
  [-6, -15, false], [-6, -4, true], [-6, 4, false],
  [0, -19, true], [0, -9, false], [0, 1, true],
  [6, -15, false], [6, -4, true], [6, 4, false],
  [12, -18, true], [12, -11, false], [12, -1, true],
];
for (const [x, z, alongX] of rows) container(x, 0, z, alongX);
// A second layer on some (cover and sniper spots), reached by stairs.
container(-6, 2.59, -4, true);
container(0, 2.59, 1, true);
container(6, 2.59, -4, true);
container(0, 2.59, -9, false);
// Stairs up onto the stacks: a metal staircase on the south side of the middle stack.
const TOPY = 2.59 * 2;
k.stairs(0, 6.0, 2.2, 7.4, 0, TOPY, '-z');
// Walkway planks from the top of the middle stack across to the west and east stacks.
for (const sx of [-1, 1]) k.span(sx < 0 ? -3.6 : 2.4, sx < 0 ? -2.4 : 3.6, TOPY - 0.08, TOPY, -3.1, 0.1, 'metal');
// Crates in the lanes.
k.box(-9, 0, -7, 1.4, 1.2, 1.4, 'crate');
k.box(9, 0, -8, 1.4, 1.2, 1.4, 'crate');
k.box(-3, 0, -13, 1.2, 1.0, 1.2, 'crate');
k.box(3, 0, 7.5, 1.5, 1.5, 1.5, 'crate');

// ---- Gantry crane over the yard (legs are solid, the beam is high above) ---------------------
for (const x of [-15.5, 15.5]) for (const z of [-24.5, 9.5]) k.box(x, 0, z, 1, 16, 1, 'metal');
for (const z of [-24.5, 9.5]) k.box(0, 16, z, 32, 1.2, 1.2, 'metal');
k.box(0, 15, -7.5, 4, 2.6, 3, 'metal'); // the trolley and cab, up high
k.box(0, 12.5, -7.5, 0.3, 2.5, 0.3, 'trim'); // the cable

// ---- The quay -------------------------------------------------------------------------------
// Bollards along the edge.
for (let x = -36; x <= 36; x += 8) if (Math.abs(x) > 5) k.model('post', x, 0, QZ - 1, 0.5, 0.7, 0.5, { tint: 0x22252a });
// Cargo waiting to be loaded.
for (const [x, z] of [[-24, 12], [-21.5, 13], [22, 12], [25, 14]] as [number, number][]) k.box(x, 0, z, 1.6, 1.4, 1.6, 'crate');
k.box(-23, 1.4, 12.5, 1.2, 1, 1.2, 'crate');
container(-30, 0, 9, true);
container(30, 0, 9, true);
k.model('fuelTank', 14, 0, 14.5, 5, 2.4, 2.4);
// The harbor office: a small cabin with two rooms (windows all round).
const ox0 = -12, ox1 = -4, oz0 = 10, oz1 = 16;
k.span(ox0, ox1, -0.02, 0.05, oz0, oz1, 'tile');
k.wall('x', oz0 + 0.1, { from: ox0, to: ox1, y0: 0, y1: 3, t: 0.2, mat: 'planks', faces: { '+z': 'drywall' }, openings: [door(ox0 + 0.8, ox0 + 2.6), win(ox1 - 3, ox1 - 1)] });
k.wall('x', oz1 - 0.1, { from: ox0, to: ox1, y0: 0, y1: 3, t: 0.2, mat: 'planks', faces: { '-z': 'drywall' }, openings: [win(ox0 + 1, ox0 + 3), door(ox1 - 2.6, ox1 - 0.8)] });
k.wall('z', ox0 + 0.1, { from: oz0 + 0.2, to: oz1 - 0.2, y0: 0, y1: 3, t: 0.2, mat: 'planks', faces: { '+x': 'drywall' }, openings: [win(oz0 + 2, oz0 + 4)] });
k.wall('z', ox1 - 0.1, { from: oz0 + 0.2, to: oz1 - 0.2, y0: 0, y1: 3, t: 0.2, mat: 'planks', faces: { '-x': 'drywall' }, openings: [win(oz0 + 2, oz0 + 4)] });
k.wall('z', (ox0 + ox1) / 2, { from: oz0 + 0.2, to: oz1 - 0.2, y0: 0, y1: 3, mat: 'drywall', openings: [door(oz0 + 2, oz0 + 3.8)] });
k.span(ox0, ox1, 3, 3.2, oz0, oz1, 'metal', { bottom: 'ceiling' });
k.model('table', -10, 0, 12.2, 1.6, 0.75, 0.8);
k.model('radio', -10.2, 0.75, 12.2, 0.5, 0.35, 0.3, { decor: true });
k.model('bookshelf', -4.5, 0, 11.4, 0.35, 1.9, 1.2, { rot: 90 });
k.lamp(-10, 2.9, 13, 0.9, 5);
k.lamp(-6, 2.9, 13, 0.9, 5);

// Lamp posts: along the quay and the road.
for (const x of [-28, -14, 14, 28]) {
  k.model('lampPost', x, 0, 17.5, 0.3, 5.2, 0.3, { rot: 180 });
  k.lamp(x, 4.82, 17.08, 1.2, 11, 0xffb060);
}
for (const x of [-24, 0, 24]) {
  k.model('lampPost', x, 0, -26.4, 0.3, 5.2, 0.3);
  k.lamp(x, 4.82, -25.98, 1.0, 10, 0xffb060);
}

// ---- Pickups ----------------------------------------------------------------------------------
k.pickups.push(
  { type: 'health', x: -28, y: 0, z: -14 },
  { type: 'health', x: 28, y: 0, z: -14 },
  { type: 'health', x: -8, y: 0, z: 13 },
  { type: 'health', x: 0, y: 0, z: QZ + 13 },
  { type: 'armor', x: 0, y: 2.59 * 2, z: 1 },
  { type: 'armor', x: -28, y: MEZZ, z: -19.5 },
  { type: 'ammo', x: -3, y: 0, z: -7.5 },
  { type: 'ammo', x: 3, y: 0, z: -13 },
  { type: 'ammo', x: 24, y: 0, z: 16 },
  { type: 'ammo', x: -24, y: 0, z: 16 },
  { type: 'ammo', x: 28, y: MEZZ, z: -19.5 },
);

export const harbor: MapDef = {
  id: 'harbor',
  name: 'Harbor',
  description: 'A container dock at dusk: stacks you can climb, two warehouses with mezzanines, a crane, and a pier.',
  skyColor: 0xd89a6a,
  // Dusk over the sea: a low orange sun in the west, a purple-blue sky, city lights coming on.
  sky: {
    zenith: 0x22325e,
    mid: 0x7a5f86,
    horizon: 0xf2a466,
    ground: 0x2a2e36,
    sunColor: 0xffb378,
    sunElevation: 9,
    sunAzimuth: 255,
    sunIntensity: 2.0,
    skyLight: 0.8,
    clouds: 0.35,
    cloudColor: 0xf0b8a0,
    skylineColor: 0x2b3040,
    litWindows: true,
  },
  fogNear: 60,
  fogFar: 210,
  indoorShading: 0.55,
  levels: [0, MEZZ],
  navSpacing: 1.0,
  objectives: {
    zones: [[-28, 0, -11], [0, 0, -14], [28, 0, -11]],
    hills: [[0, 0, -14], [-8, 0, 13.5], [0, 0, QZ + 8], [-28, 0, -11], [28, 0, -11], [0, 2.59 * 2, 1]],
  },
  boxes: k.boxes,
  ramps: k.ramps,
  lamps: k.lamps,
  pickups: k.pickups,
  playerSpawns: [
    spawnAt(-28, 0, -10, 180), spawnAt(28, 0, -10, 180), spawnAt(-34, 0, 14, 90), spawnAt(34, 0, 14, -90),
    spawnAt(0, 0, -25, 0), spawnAt(0, 0, QZ + 12, 0),
  ],
  botSpawns: [
    spawnAt(-24, 0, -26, 0), spawnAt(24, 0, -26, 0), spawnAt(-9, 0, -14, 0), spawnAt(9, 0, -14, 0),
    spawnAt(-30, 0, 14, 90), spawnAt(30, 0, 14, -90), spawnAt(-3, 0, 8, 180), spawnAt(17, 0, 4, 180),
    spawnAt(-24, MEZZ, -19.5, 180), spawnAt(24, MEZZ, -19.5, 180), spawnAt(-17, 0, 4, 180), spawnAt(-6, 0, 13, 0),
  ],
};
