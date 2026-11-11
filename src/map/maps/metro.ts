import type { MapDef } from '../MapTypes';
import { door, gap, MapKit, spawnAt, win } from '../kit';

/**
 * METRO — an underground train station (64 x 42 m).
 *
 *   North: ticket hall (turnstiles, kiosk, the stairs up to the street, closed)
 *   North platform | track pit with two tracks | south platform
 *     a train stands on the north track (walk in at its doors, out the other side)
 *     a footbridge crosses the tracks; service steps lead down into the pit at both ends
 *   South: a service corridor with an electrical room
 *   East and west: dark tunnel mouths
 *
 * Coordinates: X west (-) to east (+), Z north (-) to south (+), Y up.
 */

const k = new MapKit({ doorHeight: 2.4 });
const HX = 32;
const PIT = -1.2; // track bed
const PN = -4, PS = 4; // platform edges (the pit is between)
const NW = -12, SW = 12; // platform back walls
const HALL = 5.5; // platform hall ceiling
const BRIDGE = 3.6; // footbridge deck

// ---- Floors ---------------------------------------------------------------------------------
k.span(-HX, HX, -1, 0, NW, PN, 'tile'); // north platform
k.span(-HX, HX, -1, 0, PS, SW, 'tile'); // south platform
k.span(-HX - 6, HX + 6, PIT - 1, PIT, PN, PS, 'dirt'); // track bed
// Platform edge faces (concrete) and the yellow safety lines.
k.span(-HX, HX, PIT, 0, PN - 0.3, PN, 'concrete');
k.span(-HX, HX, PIT, 0, PS, PS + 0.3, 'concrete');
k.span(-HX, HX, 0, 0.015, PN - 0.9, PN - 0.6, 'paint');
k.span(-HX, HX, 0, 0.015, PS + 0.6, PS + 0.9, 'paint');
// Rails: two tracks (sleepers and steel rails, low enough to walk over).
for (const tz of [-2, 2]) {
  for (let x = -HX - 5; x <= HX + 5; x += 1.2) k.boxes.push({ x, y: PIT, z: tz, w: 0.25, h: 0.08, d: 2.4, material: 'planks', decor: true });
  for (const dz of [-0.72, 0.72]) k.boxes.push({ x: 0, y: PIT + 0.08, z: tz + dz, w: (HX + 5) * 2, h: 0.12, d: 0.08, material: 'metal', decor: true });
}

// ---- The hall: walls, ceiling, end walls with tunnel mouths ------------------------------------
k.wall('x', NW - 0.2, { from: -HX, to: HX, y0: 0, y1: HALL, t: 0.4, mat: 'tile', faces: { '-z': 'concrete' }, openings: [door(-21.5, -18.5), door(12.5, 15.5)] });
k.wall('x', SW + 0.2, { from: -HX, to: HX, y0: 0, y1: HALL, t: 0.4, mat: 'tile', faces: { '+z': 'concrete' }, openings: [door(-23, -21), door(19, 21)] });
k.span(-HX - 6, HX + 6, HALL, HALL + 0.4, NW - 0.4, SW + 0.4, 'concrete', { bottom: 'ceiling' });
for (const sx of [-1, 1]) {
  const x = sx * (HX + 0.25);
  // End walls over the platforms; over the pit, a tunnel mouth.
  k.span(x - 0.25, x + 0.25, 0, HALL, NW, PN, 'tile');
  k.span(x - 0.25, x + 0.25, 0, HALL, PS, SW, 'tile');
  k.span(x - 0.25, x + 0.25, 3.0, HALL, PN, PS, 'concrete');
  // The tunnel: a short dark stretch, then it's sealed (invisible wall, black back wall).
  const t0 = sx * (HX + 0.5), t1 = sx * (HX + 6);
  k.span(Math.min(t0, t1), Math.max(t0, t1), PIT, 3.0, PN - 0.5, PN, 'concrete');
  k.span(Math.min(t0, t1), Math.max(t0, t1), PIT, 3.0, PS, PS + 0.5, 'concrete');
  k.span(Math.min(t0, t1), Math.max(t0, t1), 3.0, 3.4, PN - 0.5, PS + 0.5, 'concrete');
  k.span(t1 - sx * 0.3, t1, PIT, 3.0, PN, PS, 'metal');
  k.lamp(sx * (HX + 3), 2.85, 0, 0.7, 6, 0xff3a2a);
}

// ---- Footbridge over the tracks, with stairs down to each platform ------------------------------
k.span(-12, -9, BRIDGE - 0.25, BRIDGE, -7, 7, 'metal', { top: 'planks' });
for (const x of [-12.05, -8.95]) k.span(x - 0.03, x + 0.03, BRIDGE, BRIDGE + 1.05, -4, 4, 'glass');
// Stairs: from the bridge ends, down toward the east, on each platform.
k.stairs(-5, -5.75, 8, 2.5, 0, BRIDGE, '-x');
k.stairs(-5, 5.75, 8, 2.5, 0, BRIDGE, '-x');
// Glass sides on the stairs' open edges (nobody walks off the side).
for (const z of [-7.05, 7.05]) k.span(-12, -9, BRIDGE, BRIDGE + 1.05, z - 0.03, z + 0.03, 'glass');
// Support pillars for the bridge, down in the pit.
for (const z of [-3.5, 3.5]) k.span(-11, -10, PIT, BRIDGE - 0.25, z - 0.25, z + 0.25, 'concrete');

// ---- Service steps down into the pit at both ends ---------------------------------------------
for (const x of [-26, 26]) {
  k.ramps.push({ x, z: PN + 1.4, w: 2, d: 2.8, low: PIT, high: 0, dir: '-z', material: 'stairs', base: PIT });
  k.ramps.push({ x, z: PS - 1.4, w: 2, d: 2.8, low: PIT, high: 0, dir: '+z', material: 'stairs', base: PIT });
}

// ---- The train (north track): walk in through its doors ----------------------------------------
const TX0 = -6, TX1 = 18, TZ0 = -3.5, TZ1 = -0.5, TH = 2.4;
k.span(TX0, TX1, PIT, 0, TZ0, TZ1, 'metal', { top: 'floor' }); // underframe + floor (level with the platform)
k.span(TX0, TX1, PIT, 0, PN, TZ0, 'trim'); // the step between platform and train
const doors = [-3, 3, 9, 15];
const tdoor = (c: number) => door(c - 0.8, c + 0.8, 2.1);
k.wall('x', TZ0 + 0.06, { from: TX0, to: TX1, y0: 0, y1: TH, t: 0.12, mat: 'metal', faces: { '+z': 'drywall' }, openings: doors.flatMap((c, i) => [tdoor(c), ...(i < doors.length - 1 ? [win(c + 1.4, c + 4.6, 0.9, 1.9)] : [])]) });
k.wall('x', TZ1 - 0.06, { from: TX0, to: TX1, y0: 0, y1: TH, t: 0.12, mat: 'metal', faces: { '-z': 'drywall' }, openings: doors.flatMap((c, i) => [tdoor(c), ...(i < doors.length - 1 ? [win(c + 1.4, c + 4.6, 0.9, 1.9)] : [])]) });
k.span(TX0 - 0.15, TX0, 0, TH, TZ0, TZ1, 'metal');
k.span(TX1, TX1 + 0.15, 0, TH, TZ0, TZ1, 'metal');
k.span(TX0 - 0.15, TX1 + 0.15, TH, TH + 0.35, TZ0 - 0.1, TZ1 + 0.1, 'metal', { bottom: 'ceiling' });
// Seats between the doors, a pole by each door.
for (let i = 0; i < doors.length - 1; i++) {
  const c = (doors[i] + doors[i + 1]) / 2;
  k.model('bench', c, 0, TZ0 + 0.45, 2.6, 0.55, 0.5);
  k.model('bench', c, 0, TZ1 - 0.45, 2.6, 0.55, 0.5, { rot: 180 });
}
for (const c of doors) k.boxes.push({ x: c, y: 0, z: (TZ0 + TZ1) / 2, w: 0.06, h: TH, d: 0.06, material: 'metal', decor: true });
for (const c of [0, 6, 12]) k.lamp(c, TH - 0.08, (TZ0 + TZ1) / 2, 0.6, 4, 0xe8f2ff);

// ---- Platforms: pillars, benches, machines ----------------------------------------------------
for (const z of [-8, 8]) {
  for (const x of [-24, -16, 0, 8, 16, 24]) k.box(x, 0, z, 0.9, HALL, 0.9, 'tile');
  for (const x of [-20, 4, 20]) k.model('bench', x, 0, z, 2.2, 0.85, 0.6, { rot: z < 0 ? 180 : 0 });
}
k.model('vending', -28, 0, NW + 0.6, 1, 1.9, 0.8);
k.model('vending', 28, 0, SW - 0.6, 1, 1.9, 0.8, { rot: 180 });
k.model('dumpster', 29, 0, NW + 0.8, 2, 1.3, 1.2);
k.box(-29, 0, SW - 1, 1.4, 1.2, 1.4, 'crate');
k.box(-27.6, 0, SW - 0.8, 1.1, 0.9, 1.1, 'crate');
for (let x = -28; x <= 28; x += 8) for (const z of [-6, 6]) k.lamp(x, HALL - 0.1, z, 1.0, 9, 0xe0ecff);

// ---- Ticket hall (north) ------------------------------------------------------------------------
const TN = -24;
k.span(-HX, HX, -1, 0, TN, NW - 0.4, 'tile');
k.box(0, 0, TN - 0.3, HX * 2, 4.2, 0.6, 'tile', { '-z': 'concrete' });
k.box(-HX - 0.3, 0, (TN + NW) / 2, 0.6, 4.2, NW - TN, 'tile');
k.box(HX + 0.3, 0, (TN + NW) / 2, 0.6, 4.2, NW - TN, 'tile');
k.span(-HX - 0.6, HX + 0.6, 4.2, 4.6, TN - 0.6, NW - 0.4, 'concrete', { bottom: 'ceiling' });
// The turnstile line across the hall (low barriers with gaps to walk through).
for (let x = -26; x <= 26; x += 4) k.box(x, 0, -17, 2.6, 1.0, 0.5, 'metal');
// Kiosk with a counter, ticket machines, the stairs up to the (closed) street exit.
k.wall('x', -21.5, { from: -6, to: 2, y0: 0, y1: 2.6, mat: 'drywall', openings: [gap(-1, 1)] });
k.wall('z', -6, { from: TN, to: -21.5, y0: 0, y1: 2.6, mat: 'drywall' });
k.wall('z', 2, { from: TN, to: -21.5, y0: 0, y1: 2.6, mat: 'drywall' });
k.model('counter', -2, 0, -22.2, 3, 1.05, 0.6, { variant: 1 });
k.span(-6, 2, 2.6, 2.7, TN, -21.5, 'ceiling');
for (const x of [-12, -10, 8, 10]) k.model('vending', x, 0, TN + 0.5, 1, 1.9, 0.7);
k.stairs(22, -21.5, 4, 5, 0, 1.6, '-z');
k.model('gate', 22, 1.6, -23.85, 4, 2.4, 0.1, { decor: true });
for (const x of [-22, -12, 0, 12, 22]) k.lamp(x, 4.1, -15, 1.0, 9, 0xf3efe4);
k.lamp(-2, 2.55, -23, 0.8, 4, 0xffe2b0);

// ---- Service corridor (south) with an electrical room ------------------------------------------
const CS = 18;
k.span(-HX, HX, -1, 0, SW + 0.4, CS, 'concrete');
k.box(0, 0, CS + 0.2, HX * 2, 3.2, 0.4, 'concrete');
k.box(-HX - 0.2, 0, (SW + CS) / 2, 0.4, 3.2, CS - SW, 'concrete');
k.box(HX + 0.2, 0, (SW + CS) / 2, 0.4, 3.2, CS - SW, 'concrete');
k.span(-HX - 0.4, HX + 0.4, 3.2, 3.5, SW, CS + 0.4, 'concrete', { bottom: 'ceiling' });
// Electrical room in the middle of the corridor's south side.
k.wall('x', 15, { from: -6, to: 6, y0: 0, y1: 3.2, mat: 'concrete', openings: [door(-1, 1)] });
k.wall('z', -6, { from: 15, to: CS, y0: 0, y1: 3.2, mat: 'concrete' });
k.wall('z', 6, { from: 15, to: CS, y0: 0, y1: 3.2, mat: 'concrete' });
k.model('radio', -4, 0, 17, 1.6, 1.8, 0.6, { decor: true });
k.box(4, 0, 17, 1.2, 1.9, 0.8, 'metal');
// Pipes along the ceiling, a few crates.
k.boxes.push({ x: 0, y: 2.7, z: CS - 0.35, w: HX * 2, h: 0.25, d: 0.25, material: 'metal', decor: true });
k.boxes.push({ x: 0, y: 2.95, z: SW + 0.8, w: HX * 2, h: 0.18, d: 0.18, material: 'trim', decor: true });
k.box(-14, 0, 16.8, 1.3, 1.2, 1.3, 'crate');
k.box(14, 0, 16.8, 1.2, 1.0, 1.2, 'crate');
for (const x of [-24, -12, 12, 24]) k.lamp(x, 3.1, 15, 0.8, 7, 0xd8e8ff);
k.lamp(0, 3.1, 16.5, 0.7, 5, 0xffd080);

// ---- Pickups ----------------------------------------------------------------------------------
k.pickups.push(
  { type: 'health', x: -26, y: 0, z: -15 },
  { type: 'health', x: 26, y: 0, z: 15 },
  { type: 'health', x: 6, y: 0, z: -2 }, // in the train
  { type: 'health', x: 18, y: PIT, z: 2 }, // down on the tracks
  { type: 'armor', x: -10.5, y: BRIDGE, z: 0 }, // on the footbridge
  { type: 'armor', x: 0, y: 0, z: 16.5 }, // electrical room
  { type: 'ammo', x: -30, y: 0, z: -6 },
  { type: 'ammo', x: 30, y: 0, z: 6 },
  { type: 'ammo', x: -2, y: 0, z: -19 },
  { type: 'ammo', x: -20, y: PIT, z: -2 },
);

export const metro: MapDef = {
  id: 'metro',
  name: 'Metro',
  description: 'An underground station: two platforms, a train you can walk through, a footbridge, the tracks, a ticket hall and service tunnels.',
  skyColor: 0x1a1d22,
  sky: {
    zenith: 0x14171c,
    horizon: 0x2a2e36,
    ground: 0x111214,
    sunColor: 0xd8e4ff,
    sunElevation: 60,
    sunAzimuth: 180,
    sunIntensity: 0.4,
    skyLight: 0.55,
    clouds: 0,
    skyline: false,
  },
  fogNear: 40,
  fogFar: 140,
  indoorShading: 0.35,
  levels: [PIT, 0, BRIDGE],
  navSpacing: 0.75,
  objectives: {
    zones: [[-20, 0, -8], [6, 0, -2], [20, 0, 8]],
    hills: [[6, 0, -2], [0, 0, -15], [-10.5, BRIDGE, 0], [0, 0, 15.5], [10, PIT, 2], [-24, 0, 8]],
    flags: [[-26, 0, -20], [26, 0, 15.5]],
  },
  boxes: k.boxes,
  ramps: k.ramps,
  lamps: k.lamps,
  pickups: k.pickups,
  playerSpawns: [
    spawnAt(-28, 0, -20, 180), spawnAt(26, 0, -20, 180), spawnAt(-30, 0, 9, 90), spawnAt(30, 0, -9, -90),
    spawnAt(-26, 0, 15.5, 90), spawnAt(26, 0, 15.5, -90),
  ],
  botSpawns: [
    spawnAt(-14, 0, -20, 180), spawnAt(14, 0, -20, 180), spawnAt(-28, 0, -6, 90), spawnAt(28, 0, 6, -90),
    spawnAt(-12, 0, 15.5, 90), spawnAt(12, 0, 15.5, -90), spawnAt(0, 0, -2, 90), spawnAt(-20, PIT, 2, 90),
    spawnAt(22, PIT, -2, -90), spawnAt(10, 0, 9, 0), spawnAt(-24, 0, -9.5, 0), spawnAt(24, 0, 10, 180),
  ],
};
