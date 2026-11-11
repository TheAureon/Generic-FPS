import type { MapDef, MaterialId } from '../MapTypes';
import { door, MapKit, spawnAt, win, type Opening } from '../kit';

/**
 * OUTPOST — a walled desert village under a hot midday sun (80 x 64 m).
 *
 *   North row: houses, and a two-story lookout tower in the middle
 *   Center: the market square, with a well, stalls and carts
 *   South row: more houses
 *   Flat roofs you can climb onto (outside stairs), with plank bridges between
 *   some of them; the tower's upper floor connects to a roof by a bridge.
 *
 * Coordinates: X west (-) to east (+), Z north (-) to south (+), Y up.
 */

const k = new MapKit({ doorHeight: 2.2, sill: 1.0, head: 2.1 });
const HX = 40, HZ = 32;
const H = 3.4; // house wall height
const ROOF = H + 0.3; // roof top
const WALL: MaterialId = 'stone';

// ---- Ground and the village wall --------------------------------------------------------------
k.span(-HX - 1, HX + 1, -1, 0, -HZ - 1, HZ + 1, 'dirt');
k.box(0, 0, -HZ - 0.5, HX * 2 + 2, 4, 1, WALL);
k.box(0, 0, HZ + 0.5, HX * 2 + 2, 4, 1, WALL);
k.box(-HX - 0.5, 0, 0, 1, 4, HZ * 2, WALL);
k.box(HX + 0.5, 0, 0, 1, 4, HZ * 2, WALL);
// The two village gates (closed), on the west and east walls.
for (const sx of [-1, 1]) k.model('gate', sx * (HX - 0.05), 0, 0, 0.1, 3, 4, { rot: 90, decor: true });

/** Which side of a house: north (-z), south (+z), west (-x), east (+x). */
type Side = 'n' | 's' | 'w' | 'e';

interface HouseOpts {
  /** Openings per side, as positions along that side (doors and windows, 1.8 / 1.4 wide). */
  doors?: [Side, number][];
  windows?: [Side, number][];
  /** Outside stairs up to the roof: on this side, centered at this position along it. */
  stairs?: [Side, number];
  height?: number;
}

/** A flat-roofed house from x0..x1, z0..z1. */
function house(x0: number, x1: number, z0: number, z1: number, o: HouseOpts = {}): void {
  const h = o.height ?? H;
  const t = 0.4;
  const ops = (side: Side): Opening[] => [
    ...(o.doors ?? []).filter(([s]) => s === side).map(([, a]) => door(a - 0.9, a + 0.9)),
    ...(o.windows ?? []).filter(([s]) => s === side).map(([, a]) => win(a - 0.7, a + 0.7)),
  ];
  k.span(x0, x1, -0.02, 0.04, z0, z1, 'planks');
  k.wall('x', z0 + t / 2, { from: x0, to: x1, y0: 0, y1: h, t, mat: WALL, faces: { '+z': 'drywall' }, openings: ops('n') });
  k.wall('x', z1 - t / 2, { from: x0, to: x1, y0: 0, y1: h, t, mat: WALL, faces: { '-z': 'drywall' }, openings: ops('s') });
  k.wall('z', x0 + t / 2, { from: z0 + t, to: z1 - t, y0: 0, y1: h, t, mat: WALL, faces: { '+x': 'drywall' }, openings: ops('w') });
  k.wall('z', x1 - t / 2, { from: z0 + t, to: z1 - t, y0: 0, y1: h, t, mat: WALL, faces: { '-x': 'drywall' }, openings: ops('e') });
  k.span(x0 - 0.15, x1 + 0.15, h, h + 0.3, z0 - 0.15, z1 + 0.15, WALL, { bottom: 'ceiling', top: 'concrete' });
  if (o.stairs) {
    // Running straight at the wall, up to the roof edge.
    const [side, at] = o.stairs;
    const L = (h + 0.3) * 1.75, w = 1.6;
    if (side === 's') k.stairs(at, z1 + 0.15 + L / 2, w, L, 0, h + 0.3, '-z');
    if (side === 'n') k.stairs(at, z0 - 0.15 - L / 2, w, L, 0, h + 0.3, '+z');
    if (side === 'e') k.stairs(x1 + 0.15 + L / 2, at, L, w, 0, h + 0.3, '-x');
    if (side === 'w') k.stairs(x0 - 0.15 - L / 2, at, L, w, 0, h + 0.3, '+x');
  }
  // A lamp inside, and a lantern by the first door.
  k.lamp((x0 + x1) / 2, h - 0.1, (z0 + z1) / 2, 0.9, 7, 0xffd9a0);
}

/** A plank bridge between two roofs (x0..x1, z0..z1 at roof height), with rope rails. */
function bridge(x0: number, x1: number, z0: number, z1: number, y = ROOF): void {
  k.span(x0, x1, y - 0.12, y, z0, z1, 'planks');
  const alongX = x1 - x0 > z1 - z0;
  for (const s of [0, 1]) {
    if (alongX) k.span(x0, x1, y + 0.9, y + 0.96, s ? z1 - 0.05 : z0, s ? z1 : z0 + 0.05, 'planks');
    else k.span(s ? x1 - 0.05 : x0, s ? x1 : x0 + 0.05, y + 0.9, y + 0.96, z0, z1, 'planks');
  }
  // Invisible sides, so nobody falls off a narrow bridge by accident.
  if (alongX) for (const z of [z0 - 0.1, z1 + 0.1]) k.boxes.push({ x: (x0 + x1) / 2, y, z, w: x1 - x0, h: 1, d: 0.15, hidden: true });
  else for (const x of [x0 - 0.1, x1 + 0.1]) k.boxes.push({ x, y, z: (z0 + z1) / 2, w: 0.15, h: 1, d: z1 - z0, hidden: true });
}

// ---- North row ---------------------------------------------------------------------------------
house(-34, -24, -24, -14, { doors: [['e', -19]], windows: [['n', -29], ['s', -27]], stairs: ['s', -30.2] });
house(-18, -8, -26, -18, { doors: [['s', -13]], windows: [['n', -13], ['w', -22]] });
house(12, 22, -26, -16, { doors: [['w', -21]], windows: [['n', 17], ['e', -21]], stairs: ['s', 14.8] });
house(26, 36, -24, -14, { doors: [['s', 31]], windows: [['w', -17], ['n', 31]] });

// The lookout tower: two floors, stairs inside, a door on the upper floor to the bridge.
{
  const x0 = -4, x1 = 6, z0 = -28, z1 = -20, t = 0.4, H2 = H * 2;
  k.span(x0, x1, -0.02, 0.04, z0, z1, 'planks');
  k.wall('x', z0 + t / 2, { from: x0, to: x1, y0: 0, y1: H, t, mat: WALL, faces: { '+z': 'drywall' }, openings: [win(0, 1.4)] });
  k.wall('x', z1 - t / 2, { from: x0, to: x1, y0: 0, y1: H, t, mat: WALL, faces: { '-z': 'drywall' }, openings: [door(-1, 0.8)] });
  k.wall('z', x0 + t / 2, { from: z0 + t, to: z1 - t, y0: 0, y1: H, t, mat: WALL, faces: { '+x': 'drywall' } });
  k.wall('z', x1 - t / 2, { from: z0 + t, to: z1 - t, y0: 0, y1: H, t, mat: WALL, faces: { '-x': 'drywall' }, openings: [win(-24.7, -23.3)] });
  // The band of wall at floor level between the two stories.
  k.span(x0, x1, H, ROOF, z0, z0 + t, WALL);
  k.span(x0, x1, H, ROOF, z1 - t, z1, WALL);
  k.span(x0, x0 + t, H, ROOF, z0 + t, z1 - t, WALL);
  k.span(x1 - t, x1, H, ROOF, z0 + t, z1 - t, WALL);
  // Upper floor (with the stairwell opening), upper walls with windows all round.
  k.slab(x0 + t, 3.4, z0 + t, z1 - t, H, 0.3, 'planks');
  k.slab(3.4, x1 - t, z0 + t, -26, H, 0.3, 'planks');
  k.stairs(4.5, -23.5, 2.2, 5, 0, ROOF, '-z');
  k.wall('x', z0 + t / 2, { from: x0, to: x1, y0: ROOF, y1: H2, t, mat: WALL, faces: { '+z': 'drywall' }, openings: [win(-2, -0.6), win(1.5, 2.9)] });
  k.wall('x', z1 - t / 2, { from: x0, to: x1, y0: ROOF, y1: H2, t, mat: WALL, faces: { '-z': 'drywall' }, openings: [win(-2.5, -0.9), win(0.5, 2.1)] });
  k.wall('z', x0 + t / 2, { from: z0 + t, to: z1 - t, y0: ROOF, y1: H2, t, mat: WALL, faces: { '+x': 'drywall' }, openings: [door(-24.9, -23.1)] });
  k.wall('z', x1 - t / 2, { from: z0 + t, to: z1 - t, y0: ROOF, y1: H2, t, mat: WALL, faces: { '-x': 'drywall' }, openings: [win(-25.5, -24.1)] });
  // Railing around the stairwell opening.
  k.span(3.4, 3.46, ROOF, ROOF + 1, -26, -21, 'planks');
  k.span(x0 - 0.15, x1 + 0.15, H2, H2 + 0.3, z0 - 0.15, z1 + 0.15, WALL, { bottom: 'ceiling', top: 'concrete' });
  k.lamp(0, H - 0.1, -24, 0.9, 7, 0xffd9a0);
  k.lamp(0, H2 - 0.1, -24, 0.9, 7, 0xffd9a0);
  k.box(-2.5, ROOF, -26.5, 1.2, 1.0, 1.2, 'crate');
}
// Bridges: the west house's roof to the tower's upper floor, and between the north-east houses.
bridge(-8.15, -3.85, -24.9, -23.1);
bridge(22.15, 25.85, -21, -19.4);

// ---- South row ---------------------------------------------------------------------------------
house(-36, -26, 10, 22, { doors: [['n', -31]], windows: [['e', 13], ['s', -31]], stairs: ['n', -27.2] });
house(-20, -8, 14, 24, { doors: [['n', -14], ['e', 19]], windows: [['w', 20], ['s', -14]] });
house(8, 18, 14, 24, { doors: [['n', 13], ['w', 20]], windows: [['e', 19], ['s', 13]], stairs: ['n', 15.8] });
house(24, 34, 10, 22, { doors: [['w', 17], ['n', 29]], windows: [['s', 29], ['e', 16]] });
bridge(-25.85, -20.15, 16, 17.6);
bridge(18.15, 23.85, 15, 16.6);

// ---- Furniture in the houses -----------------------------------------------------------------
k.model('bed', -31.5, 0, -22, 1, 0.55, 2, { tint: 0xa8502c });
k.model('table', -27, 0, -17.5, 1.4, 0.75, 0.8);
k.box(-12, 0, -24.6, 1.2, 1.1, 1.2, 'crate');
k.model('stove', -10, 0, -24.8, 0.8, 0.9, 0.7);
k.model('shelf', 17, 0, -25.2, 3, 2, 0.6);
k.box(20.5, 0, -18, 1.3, 1.2, 1.3, 'crate');
k.model('bed', 34.4, 0, -20, 1, 0.55, 2, { tint: 0x3a5a7a });
k.model('woodpile', 28, 0, -23.2, 2, 0.8, 0.6);
k.model('table', -31, 0, 16, 1.6, 0.75, 0.9);
k.model('bed', -34.4, 0, 19.5, 1, 0.55, 2, { tint: 0x7a6a3a });
k.model('shelf', -14, 0, 23.2, 3, 2, 0.6);
k.box(-10, 0, 16.2, 1.2, 1.0, 1.2, 'crate');
k.model('counter', 13, 0, 22.6, 4, 1, 0.7);
k.model('table', 30, 0, 18, 1.4, 0.75, 0.8);
k.box(32.5, 0, 12, 1.3, 1.3, 1.3, 'crate');
// Some cover up on the roofs.
k.box(-29, ROOF, -21, 1.2, 1.0, 1.2, 'crate');
k.box(17, ROOF, -21, 1.6, 0.9, 1.0, 'crate');
k.box(-31, ROOF, 19, 1.2, 1.0, 1.2, 'crate');
k.box(13, ROOF, 20, 1.6, 0.9, 1.0, 'crate');
k.box(-14, ROOF, -22, 1.2, 1.0, 1.2, 'crate');

// ---- Market square ---------------------------------------------------------------------------
k.model('fountain', 0, 0, 0, 3.4, 1.0, 3.4);
/** A market stall: posts, a canvas awning (you can walk under it), a counter and goods. */
function stall(x: number, z: number, rot: number): void {
  const alongX = rot % 180 === 0;
  const W = 3.2, D = 2.2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const px = x + (alongX ? sx * W / 2 : sz * D / 2), pz = z + (alongX ? sz * D / 2 : sx * W / 2);
    k.model('post', px, 0, pz, 0.18, 2.5, 0.18);
  }
  k.boxes.push({ x, y: 2.45, z, w: alongX ? W + 0.4 : D + 0.4, h: 0.08, d: alongX ? D + 0.4 : W + 0.4, material: 'canvas', decor: true });
  const front = rot === 0 ? -1 : rot === 180 ? 1 : 0;
  const side = rot === 90 ? -1 : rot === 270 ? 1 : 0;
  k.model('counter', x + side * 0.6, 0, z + front * 0.6, alongX ? W - 0.4 : 0.6, 0.95, alongX ? 0.6 : W - 0.4, { variant: 1 });
  k.box(x - side * 0.5 + (alongX ? 1 : 0), 0, z - front * 0.5 + (alongX ? 0 : 1), 0.8, 0.7, 0.8, 'crate');
}
stall(-7, -6, 0);
stall(7, -6, 0);
stall(-7, 6, 180);
stall(7, 6, 180);
// Carts, hay and barrels around the square.
k.model('hayBale', -12, 0, 1, 1.2, 0.8, 2, { rot: 90 });
k.model('roundBale', 12, 0, -1.5, 1.6, 1.4, 1.6);
k.model('trough', 4.5, 0, -1.8, 2, 0.6, 0.7);
k.box(-4.8, 0, 2.2, 1, 1, 1, 'crate');
k.model('car', 16, 0, 3, 1.9, 1.5, 4.4, { tint: 0xc8b48a, rot: 10 });
k.model('car', -18, 0, -4, 4.4, 1.5, 1.9, { tint: 0x8a5a3a, rot: 95 });

// ---- West and east ends: ruined walls and a fuel dump --------------------------------------------
for (const [x, z, w, d] of [[-34, -4, 6, 0.6], [-30, 4, 0.6, 5], [-24, -2, 3, 0.6]] as [number, number, number, number][]) k.box(x, 0, z, w, 1.6, d, 'ruin');
k.box(-37, 0, 4, 1.4, 1.4, 1.4, 'crate');
k.model('fuelTank', 33, 0, -4, 4, 2.2, 2.2);
k.model('fuelTank', 33, 0, 1, 4, 2.2, 2.2);
k.box(27, 0, 5, 3, 1.2, 0.6, 'ruin');
k.box(25, 0, -5, 1.4, 1.2, 1.4, 'crate');

// Lanterns along the streets (on walls, facing out).
k.lamp(-23.6, 2.6, -19, 0.8, 7, 0xffc070, '+x');
k.lamp(-13, 2.6, -17.6, 0.8, 7, 0xffc070, '+z');
k.lamp(0, 2.6, -19.6, 0.8, 7, 0xffc070, '+z');
k.lamp(11.6, 2.6, -21, 0.8, 7, 0xffc070, '-x');
k.lamp(-14, 2.6, 13.6, 0.8, 7, 0xffc070, '-z');
k.lamp(13, 2.6, 13.6, 0.8, 7, 0xffc070, '-z');

// ---- Pickups ----------------------------------------------------------------------------------
k.pickups.push(
  { type: 'health', x: -29, y: 0, z: -19 },
  { type: 'health', x: 30, y: 0, z: 14 },
  { type: 'health', x: -2.5, y: 0, z: 3 },
  { type: 'health', x: 17, y: 0, z: -20 },
  { type: 'armor', x: 1, y: ROOF, z: -23 }, // tower, upper floor
  { type: 'armor', x: -14, y: ROOF, z: 19 },
  { type: 'ammo', x: -14, y: 0, z: -21 },
  { type: 'ammo', x: 13, y: 0, z: 18 },
  { type: 'ammo', x: -36, y: 0, z: -2 },
  { type: 'ammo', x: 36, y: 0, z: 5 },
  { type: 'ammo', x: 31, y: ROOF, z: -19 },
);

export const outpost: MapDef = {
  id: 'outpost',
  name: 'Outpost',
  description: 'A walled desert village at midday: flat roofs you can climb, bridges between them, a lookout tower and a market square.',
  skyColor: 0xd8e2ea,
  // Hot midday: a high white sun, a pale hazy horizon, hardly any cloud.
  sky: {
    zenith: 0x3d7cc8,
    horizon: 0xeadcc0,
    ground: 0x8a7458,
    sunColor: 0xfff2d8,
    sunElevation: 62,
    sunAzimuth: 160,
    sunIntensity: 2.9,
    skyLight: 1.1,
    clouds: 0.08,
    skyline: false,
  },
  fogNear: 70,
  fogFar: 230,
  indoorShading: 0.55,
  levels: [0, ROOF],
  navSpacing: 1.0,
  objectives: {
    zones: [[-20, 0, -10], [0, 0, 5], [20, 0, 9]],
    hills: [[0, 0, 4], [-13, 0, -22], [13, 0, 19], [1, ROOF, -24], [-30, 0, 0], [30, 0, 6]],
  },
  boxes: k.boxes,
  ramps: k.ramps,
  lamps: k.lamps,
  pickups: k.pickups,
  playerSpawns: [
    spawnAt(-37, 0, -28, 135), spawnAt(37, 0, 28, -45), spawnAt(-37, 0, 28, 45), spawnAt(37, 0, -28, -135),
    spawnAt(-36, 0, 2, 90), spawnAt(36, 0, -1, -90),
  ],
  botSpawns: [
    spawnAt(-20, 0, -29, 180), spawnAt(20, 0, -29, 180), spawnAt(-20, 0, 29, 0), spawnAt(20, 0, 29, 0),
    spawnAt(-29, 0, -19, 90), spawnAt(29, 0, 16, -90), spawnAt(0, 0, -24, 180), spawnAt(-14, 0, 19, 0),
    spawnAt(13, 0, 19, 0), spawnAt(17, 0, -21, 90), spawnAt(-10, 0, -10, 0), spawnAt(10, 0, 10, 180),
  ],
};
