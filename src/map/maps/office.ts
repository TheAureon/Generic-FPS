import type { BoxDef, LampDef, MapDef, MaterialId, PickupDef, RampDef, SpawnPoint } from '../MapTypes';

/**
 * OFFICE — a two-story office building (48 x 28 m) with a parking lot.
 *
 *   Ground floor: glass-fronted lobby (double height), a corridor, three
 *   private offices, a meeting room, an open-plan cubicle workspace and a
 *   break room. Stairwells in the north-west and north-east corners.
 *   Upper floor: open office, executive office, conference room, and a
 *   walkway with a glass railing overlooking the lobby.
 *   Outside: plaza and sidewalks, a parking lot with cars and lamp posts to
 *   the south, side paths, and a back alley with dumpsters to the north.
 *
 * Glass (windows, railings) blocks walking, but you can see and shoot through it.
 * Coordinates: X west (-) to east (+), Z north (-) to south (+), Y up.
 */

const GF = 0; // ground floor
const UF = 3.5; // upper floor
const SLAB = 3.2; // underside of the upper floor
const TOP = 7; // roof
const DOOR = 2.3; // door height
const SILL = 1.0, HEAD = 2.4; // window bottom and top (above the floor)
const EXT = 0.4; // outer wall thickness
const INT = 0.15; // inner wall thickness

const boxes: BoxDef[] = [];
const ramps: RampDef[] = [];
const lamps: LampDef[] = [];
const pickups: PickupDef[] = [];

type Opening = { at: [number, number]; kind: 'door' | 'window' | 'open' };
interface WallOpts {
  from: number;
  to: number;
  y0: number;
  y1: number;
  t?: number;
  mat?: MaterialId;
  /** Material on the other side(s), e.g. drywall inside an outer wall. */
  faces?: BoxDef['faces'];
  openings?: Opening[];
}

/**
 * A wall along X (at z) or along Z (at x), with doors (open up to door
 * height, with a header above), windows (sill + glass + header) and open
 * gaps (nothing at all) cut into it.
 */
function wall(axis: 'x' | 'z', at: number, o: WallOpts): void {
  const t = o.t ?? INT;
  const mat = o.mat ?? 'drywall';
  const piece = (a: number, b: number, y0: number, y1: number, m: MaterialId = mat, thick = t) => {
    if (b - a < 0.01 || y1 - y0 < 0.01) return;
    const c = (a + b) / 2, len = b - a;
    boxes.push(
      axis === 'x'
        ? { x: c, y: y0, z: at, w: len, h: y1 - y0, d: thick, material: m, faces: m === mat ? o.faces : undefined }
        : { x: at, y: y0, z: c, w: thick, h: y1 - y0, d: len, material: m, faces: m === mat ? o.faces : undefined },
    );
  };
  const ops = [...(o.openings ?? [])].sort((p, q) => p.at[0] - q.at[0]);
  let cur = o.from;
  for (const op of ops) {
    const [a, b] = op.at;
    piece(cur, a, o.y0, o.y1);
    if (op.kind === 'door') piece(a, b, o.y0 + DOOR, o.y1);
    if (op.kind === 'window') {
      piece(a, b, o.y0, o.y0 + SILL);
      piece(a, b, o.y0 + SILL, o.y0 + HEAD, 'glass', 0.06);
      piece(a, b, o.y0 + HEAD, o.y1);
    }
    cur = b;
  }
  piece(cur, o.to, o.y0, o.y1);
}
const door = (a: number, b: number): Opening => ({ at: [a, b], kind: 'door' });
const win = (a: number, b: number): Opening => ({ at: [a, b], kind: 'window' });
const gap = (a: number, b: number): Opening => ({ at: [a, b], kind: 'open' });

/** A floor slab: carpet or tile on top, ceiling tiles underneath. */
function slab(x0: number, x1: number, z0: number, z1: number, top: MaterialId, y = SLAB, h = UF - SLAB): void {
  boxes.push({ x: (x0 + x1) / 2, y, z: (z0 + z1) / 2, w: x1 - x0, h, d: z1 - z0, material: 'drywall', faces: { top, bottom: 'ceiling' } });
}
/** Ground floor surface (top at y = 0). */
function floor(x0: number, x1: number, z0: number, z1: number, top: MaterialId): void {
  boxes.push({ x: (x0 + x1) / 2, y: -1, z: (z0 + z1) / 2, w: x1 - x0, h: 1, d: z1 - z0, material: top });
}
function box(x: number, y: number, z: number, w: number, h: number, d: number, material: MaterialId, faces?: BoxDef['faces']): void {
  boxes.push({ x, y, z, w, h, d, material, faces });
}
/** A box drawn as a detailed model (the box is still the solid part). */
function model(kind: NonNullable<BoxDef['model']>, x: number, y: number, z: number, w: number, h: number, d: number, extra: Partial<BoxDef> = {}): void {
  boxes.push({ x, y, z, w, h, d, model: kind, ...extra });
}
function lamp(x: number, y: number, z: number, intensity = 1.0, range = 7.5, color = 0xf3efe4): void {
  lamps.push({ x, y, z, color, intensity, range, facing: 'down' });
}

/** A cubicle pod: two desks back to back with a partition between, monitors and chairs. */
function pod(x: number, y: number, z: number): void {
  model('table', x, y, z, 3.0, 0.75, 1.6);
  model('partition', x, y + 0.75, z, 3.0, 0.55, 0.06);
  model('partition', x + 1.53, y, z, 0.06, 1.3, 1.6, { rot: 90 });
  model('monitor', x - 0.7, y + 0.75, z - 0.35, 0.55, 0.36, 0.05, { rot: 180 });
  model('monitor', x + 0.7, y + 0.75, z + 0.35, 0.55, 0.36, 0.05);
  // Chairs (you can walk through them, so the aisles stay clear).
  model('officeChair', x - 0.7, y, z - 1.05, 0.55, 1.0, 0.55, { decor: true });
  model('officeChair', x + 0.7, y, z + 1.05, 0.55, 1.0, 0.55, { decor: true, rot: 180 });
}

// ---- Ground and outside ----------------------------------------------------------------
// Parking lot (asphalt, a curb lower) under everything; a plaza and sidewalks around the building.
box(0, -1.12, 6, 64, 1, 56, 'asphalt');
floor(-27, 27, -17, -14, 'floor'); // north sidewalk
floor(-27, 27, 14, 18, 'floor'); // south plaza
floor(-27, -24, -14, 14, 'floor'); // west path
floor(24, 27, -14, 14, 'floor'); // east path
// Perimeter wall (brick).
box(0, -0.12, -22.5, 66, 3.6, 1, 'wall');
box(0, -0.12, 34.5, 66, 3.6, 1, 'wall');
box(-32.5, -0.12, 6, 1, 3.6, 56, 'wall');
box(32.5, -0.12, 6, 1, 3.6, 56, 'wall');

// Parking spaces: painted lines, cars in some of the spaces.
for (let i = 0; i <= 14; i++) {
  const x = -21 + i * 3;
  box(x, -0.12, 21, 0.1, 0.02, 5, 'paint');
  box(x, -0.12, 31, 0.1, 0.02, 5, 'paint');
}
function car(x: number, z: number, paint: number, rot = 0): void {
  model('car', x, -0.12, z, 1.8, 1.45, 4.3, { tint: paint, rot });
}
car(-16.5, 21, 0x6e7d8f);
car(-7.5, 21, 0x8a2f26);
car(4.5, 21, 0xd8d8d2);
car(13.5, 31, 0x2f4f7a, 180);
car(-1.5, 31, 0x3a3d42, 180);
car(-19.5, 31, 0x8a6a2a, 180);
// Lamp posts along the parking aisle.
for (const x of [-18, -6, 6, 18]) {
  model('lampPost', x, -0.12, 26, 0.3, 4.9, 0.3);
  lamp(x, 4.52, 26.42, 0.9, 9, 0xffe2b0);
}
// Plaza planters (concrete with soil) and benches.
for (const x of [-14, 14]) model('planter', x, 0, 16, 2.2, 0.7, 1.2);
for (const x of [-9, 9]) model('bench', x, 0, 16.6, 2, 0.85, 0.6, { rot: 180 });
// Back alley: dumpsters, crates, air conditioning units.
model('dumpster', -12, 0, -19.5, 2.2, 1.4, 1.3);
model('dumpster', -9.2, 0, -19.5, 2.2, 1.4, 1.3);
box(6, 0, -19.8, 1.5, 1.5, 1.5, 'crate');
box(7.6, 0, -19.6, 1.2, 1.1, 1.2, 'crate');
model('acUnit', 16, 0, -19.2, 2.5, 1.6, 1.5);
model('acUnit', 19, 0, -19.2, 2.5, 1.6, 1.5);
// Side paths: crates and a stack of pallets.
box(-28.5, 0, 6, 1.4, 1.2, 1.4, 'crate');
box(28.5, 0, -6, 1.4, 1.2, 1.4, 'crate');
box(28.5, 0, 9, 1.2, 0.5, 1.6, 'desk');

// ---- Building shell ----------------------------------------------------------------------
// Floors inside (carpet in work areas, tile in the lobby, corridor and break room).
floor(-24, 5, -14, -2, 'carpet');
floor(5, 17, -14, -2, 'tile'); // break room
floor(17, 24, -14, -2, 'carpet');
floor(-24, 24, -2, 2, 'tile');
floor(-24, -8, 2, 14, 'carpet');
floor(-8, 8, 2, 14, 'tile');
floor(8, 24, 2, 14, 'carpet');

// Outer walls, both floors: concrete outside, painted inside, windows all round.
const N = -14 + EXT / 2, S = 14 - EXT / 2, W = -24 + EXT / 2, E = 24 - EXT / 2;
const outer = { t: EXT, mat: 'concrete' as MaterialId };
wall('x', N, { ...outer, from: -24, to: 24, y0: GF, y1: UF, faces: { '+z': 'drywall' }, openings: [win(-15, -12.5), win(-9, -6.5), win(-3, -0.5), door(1.4, 3.2), win(7, 9.5), win(12, 14.5)] });
wall('x', N, { ...outer, from: -24, to: 24, y0: UF, y1: TOP, faces: { '+z': 'drywall' }, openings: [win(-15, -12.5), win(-9, -6.5), win(-3, -0.5), win(2.5, 5), win(7, 9.5), win(12, 14.5)] });
wall('x', S, { ...outer, from: -24, to: 24, y0: GF, y1: UF, faces: { '-z': 'drywall' }, openings: [win(-22, -20), win(-17, -15), win(-12, -10), win(-7.5, -4), door(-3, 3), win(4, 7.5), win(10, 13), win(15, 18), win(20, 23)] });
wall('x', S, { ...outer, from: -24, to: 24, y0: UF, y1: TOP, faces: { '-z': 'drywall' }, openings: [win(-22, -19), win(-15, -12), win(-7.5, -4), win(-2.5, 2.5), win(4, 7.5), win(10, 13), win(15, 18), win(20, 23)] });
wall('z', W, { ...outer, from: -14 + EXT, to: 14 - EXT, y0: GF, y1: UF, faces: { '+x': 'drywall' }, openings: [door(-1, 1), win(7, 10)] });
wall('z', W, { ...outer, from: -14 + EXT, to: 14 - EXT, y0: UF, y1: TOP, faces: { '+x': 'drywall' }, openings: [win(-1, 1), win(6, 10)] });
wall('z', E, { ...outer, from: -14 + EXT, to: 14 - EXT, y0: GF, y1: UF, faces: { '-x': 'drywall' }, openings: [door(-1, 1), win(6, 10)] });
wall('z', E, { ...outer, from: -14 + EXT, to: 14 - EXT, y0: UF, y1: TOP, faces: { '-x': 'drywall' }, openings: [win(-1, 1), win(6, 10)] });

// Upper floor slab, with openings over the two staircases and over the lobby (atrium).
const IN = 24 - EXT; // inner face of the outer walls
slab(-IN, IN, -IN + 10, -10.8, 'carpet'); // north strip (landings at the top of the stairs)
slab(-21, 21, -10.8, -2, 'carpet'); // between the staircases
slab(-IN, IN, -2, 2, 'tile'); // upper corridor
slab(-IN, -8, 2, 14 - EXT, 'carpet'); // above the offices (executive office)
slab(8, IN, 2, 14 - EXT, 'carpet'); // above the meeting room (conference room)
// Roof.
boxes.push({ x: 0, y: TOP - 0.3, z: 0, w: IN * 2, h: 0.3, d: 28 - EXT * 2, material: 'concrete', faces: { bottom: 'ceiling' } });

// ---- Staircases (north-west and north-east corners) ----------------------------------------
for (const sx of [-1, 1]) {
  // The stairs climb north, from the corridor up to the landing.
  ramps.push({ x: sx * 22.3, z: -6.8, w: 2.6, d: 8, low: GF, high: UF, dir: '-z', material: 'stairs' });
  // Stairwell side wall (both floors), glass railing on the upper floor beside the stairs.
  wall('z', sx * 17, { from: -IN + 10, to: -2, y0: GF, y1: TOP - 0.3 });
  box(sx * 21, UF, -6.4, 0.06, 1.0, 8.8, 'glass');
  box(sx * 21, UF + 1.0, -6.4, 0.08, 0.06, 8.8, 'metal'); // handrail
}

// ---- Ground floor rooms ----------------------------------------------------------------------
// Corridor walls. North side: stairwells, workspace (two wide openings), break room.
wall('x', -2, { from: -IN, to: IN, y0: GF, y1: SLAB, openings: [door(-23.4, -21.2), gap(-12, -10), gap(0, 2), door(9.9, 11.6), door(21.2, 23.4)] });
// South side: three offices, the lobby (one big opening), the meeting room.
wall('x', 2, { from: -IN, to: IN, y0: GF, y1: SLAB, openings: [door(-21.8, -20.2), door(-16.8, -15.2), door(-11.5, -9.9), door(-8, 8), door(9.9, 11.6)] });
// Workspace | break room.
wall('z', 5, { from: -IN + 10, to: -2, y0: GF, y1: SLAB, openings: [door(-8.2, -6.4)] });
// Office dividers.
wall('z', -18.7, { from: 2, to: 14 - EXT, y0: GF, y1: SLAB });
wall('z', -13.4, { from: 2, to: 14 - EXT, y0: GF, y1: SLAB });
// Lobby side walls go up both floors (it's double height).
wall('z', -8, { from: 2, to: 14 - EXT, y0: GF, y1: TOP - 0.3 });
wall('z', 8, { from: 2, to: 14 - EXT, y0: GF, y1: TOP - 0.3 });

// Workspace: six cubicle pods.
for (const x of [-13, -7, -1]) for (const z of [-10.6, -6.4]) pod(x, GF, z);
// Break room: counter with tile top, fridge, vending machine, a table.
model('counter', 11, GF, -13.2, 10, 0.92, 0.7);
model('fridge', 16.4, GF, -12.3, 0.8, 1.9, 0.7);
model('vending', 5.5, GF, -3.0, 0.8, 1.9, 1.0, { rot: 90 });
model('table', 11, GF, -7.5, 2.4, 0.75, 1.2, { variant: 1 });
for (const dz of [-1, 1]) model('cafeChair', 11 + dz * 0.6, GF, -7.5 + dz * 0.95, 0.45, 0.85, 0.45, { rot: dz > 0 ? 180 : 0, decor: true });
// Offices: desk, bookshelf, chair.
for (const cx of [-21.35, -16.05, -10.7]) {
  model('officeDesk', cx, GF, 10.8, 1.7, 0.75, 0.8, { rot: 180 });
  model('bookshelf', cx - 1.9, GF, 8, 0.35, 1.9, 1.2, { rot: 90 });
  model('officeChair', cx, GF, 9.8, 0.55, 1.0, 0.55);
  model('monitor', cx + 0.2, GF + 0.75, 11.0, 0.55, 0.36, 0.05, { rot: 180, decor: true });
}
// Lobby: reception desk, sofas, planters.
model('counter', 0, GF, 7.6, 4.2, 1.1, 0.9, { variant: 1 });
model('counter', -2.4, GF, 6.8, 0.6, 1.1, 2.4, { rot: 270, variant: 1 });
model('sofa', -5, GF, 11.6, 2.2, 0.8, 0.9, { rot: 180 });
model('sofa', 5, GF, 11.6, 2.2, 0.8, 0.9, { rot: 180, tint: 0x7a5a48 });
model('planter', -6.6, GF, 3.6, 1, 0.9, 1);
model('planter', 6.6, GF, 3.6, 1, 0.9, 1);
// Meeting room: long table with chairs.
model('table', 16, GF, 8, 6, 0.75, 1.6, { variant: 1 });
for (const x of [13.5, 16, 18.5]) for (const z of [6.7, 9.3]) model('officeChair', x, GF, z, 0.55, 1.0, 0.55, { rot: z < 8 ? 0 : 180 });

// ---- Upper floor rooms -------------------------------------------------------------------------
// Corridor walls. North side: stairwell landings, the open office.
wall('x', -2, { from: -IN, to: IN, y0: UF, y1: TOP - 0.3, openings: [door(-20.5, -17.5), door(-10, -8), door(-1, 1), door(8, 10), door(17.5, 20.5)] });
// South side: executive office, glass railing over the lobby, conference room.
wall('x', 2, { from: -IN, to: -8, y0: UF, y1: TOP - 0.3, openings: [door(-12.2, -10.4)] });
wall('x', 2, { from: 8, to: IN, y0: UF, y1: TOP - 0.3, openings: [door(10.3, 12.1)] });
box(0, UF, 2.05, 16, 1.0, 0.06, 'glass');
box(0, UF + 1.0, 2.05, 16, 0.06, 0.1, 'metal'); // handrail
// Open office: ten pods.
for (const x of [-12, -6, 0, 6, 12]) for (const z of [-9.8, -5.8]) pod(x, UF, z);
// Executive office: big desk, bookshelves, sofa.
model('officeDesk', -16, UF, 9.5, 2.6, 0.78, 1.1, { rot: 180 });
model('officeChair', -16, UF, 8.4, 0.6, 1.1, 0.6, { tint: 0x2a2a2a });
model('bookshelf', -23.2, UF, 6, 0.4, 2.2, 3, { rot: 90 });
model('sofa', -11, UF, 12.5, 2.4, 0.8, 0.9, { rot: 180, tint: 0x4a3426 });
// Conference room: big table and chairs.
model('table', 16, UF, 8, 7, 0.75, 2, { variant: 1 });
for (const x of [13, 16, 19]) for (const z of [6.4, 9.6]) model('officeChair', x, UF, z, 0.55, 1.0, 0.55, { rot: z < 8 ? 0 : 180 });

// ---- Lights ---------------------------------------------------------------------------------------
const gfL = SLAB - 0.08, ufL = TOP - 0.38;
for (const x of [-12, -4.5, 1.5]) lamp(x, gfL, -8.5);
lamp(11, gfL, -8.5);
for (const x of [-18, -6, 6, 18]) lamp(x, gfL, 0, 0.9, 6.5);
for (const x of [-21.35, -16.05, -10.7]) lamp(x, gfL, 8, 0.9, 6);
lamp(13, gfL, 8);
lamp(19, gfL, 8);
lamp(0, ufL, 8, 1.6, 11); // lobby (high ceiling)
for (const x of [-12, -4, 4, 12]) lamp(x, ufL, -8);
for (const x of [-18, -6, 6, 18]) lamp(x, ufL, 0, 0.9, 6.5);
lamp(-19, ufL, 8);
lamp(-12, ufL, 8);
lamp(13, ufL, 8);
lamp(19, ufL, 8);
lamp(-19.5, ufL, -12.2, 0.8, 6);
lamp(19.5, ufL, -12.2, 0.8, 6);

// ---- Pickups ----------------------------------------------------------------------------------------
pickups.push(
  { type: 'health', x: 9, y: GF, z: -4.5 }, // break room
  { type: 'health', x: -21.35, y: GF, z: 5 }, // west office
  { type: 'health', x: 20, y: UF, z: 4.5 }, // conference room
  { type: 'health', x: 0, y: GF, z: 31 }, // parking lot
  { type: 'armor', x: -13, y: UF, z: 5.5 }, // executive office
  { type: 'ammo', x: -5, y: GF, z: -3.4 }, // workspace aisle
  { type: 'ammo', x: 3, y: UF, z: -3.4 }, // open office aisle
  { type: 'ammo', x: -5, y: 0, z: -19.5 }, // back alley
  { type: 'ammo', x: 28.5, y: 0, z: 3 }, // east path
);

/** A spawn point facing a given direction (degrees; 0 = north). */
function spawn(x: number, y: number, z: number, yaw: number): SpawnPoint {
  return { x, y, z, yaw };
}

export const office: MapDef = {
  id: 'office',
  name: 'Office',
  description: 'A two-story office: cubicles, a glass lobby, stairwells, and a parking lot outside.',
  skyColor: 0xb7cde0,
  sky: {
    zenith: 0x4479c0,
    horizon: 0xc9d6e0,
    ground: 0x55524c,
    sunColor: 0xffe8c8,
    sunElevation: 40,
    sunAzimuth: 200,
    clouds: 0.38,
    skylineColor: 0x4e5866,
  },
  fogNear: 60,
  fogFar: 200,
  indoorShading: 0.62,
  levels: [GF, UF],
  // A finer bot navigation grid, so bots always find their way through doors.
  navSpacing: 0.75,
  // Game modes: Control zones in the workspace, the lobby and the break room; the hill moves around inside and out.
  objectives: {
    zones: [[-15, GF, -8.5], [0, GF, 10.5], [11, GF, -4.5]],
    hills: [[0, GF, 10.5], [0, UF, -3.4], [-10, GF, -3.4], [0, -0.12, 26], [11, GF, -4.5], [0, 0, -19.5]],
  },
  boxes,
  ramps,
  lamps,
  pickups,
  playerSpawns: [
    spawn(0, GF, 4.2, 180), spawn(-10, -0.12, 26, 0), spawn(10, -0.12, 26, 0), spawn(0, 0, -19.5, 90),
    spawn(0, UF, 0, 90), spawn(-28.5, 0, -3, 0),
  ],
  botSpawns: [
    spawn(-14, GF, 0, 90), spawn(14, GF, 0, -90), spawn(13, GF, -4.5, 0), spawn(16, GF, 4, 180),
    spawn(0, UF, -3.4, 0), spawn(-16, UF, 5, 180), spawn(16, UF, 4, 180), spawn(-20, -0.12, 26, 0),
    spawn(20, -0.12, 26, 0), spawn(10, 0, -19.5, 180), spawn(28.5, 0, 0, 0), spawn(-16.05, GF, 5, 0),
  ],
};
