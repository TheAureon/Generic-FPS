import type { BoxDef, MapDef, MaterialId } from '../MapTypes';
import { MapKit, door, spawnAt, win } from '../kit';

/**
 * MUSEUM — a grand stone museum on a raised podium, surrounded by gardens.
 *
 *   Grand Hall (center): marble columns, a glass skylight, a statue in the
 *   middle, two staircases up to a U-shaped balcony with glass railings.
 *   West wing: sculpture gallery. East wing: painting gallery.
 *   North wing: antiquities (display cases, a sarcophagus) downstairs, a
 *   modern art gallery upstairs (reached from the balcony or its own stairs).
 *   South: entrance foyer with a portico of columns, a gift shop and a café.
 *   Outside: front stairs, a fountain plaza, hedge gardens, side paths, a
 *   service yard with a loading dock to the north, all inside a stone wall.
 *
 * Glass (skylight, display cases, railings, windows) blocks walking, but you
 * can see and shoot through it.
 * Coordinates: X west (-) to east (+), Z north (-) to south (+), Y up.
 */

const F = 1.2; // main floor (top of the podium)
const U = 6.2; // upper floor (balcony, modern gallery)
const GR = 7.2; // gallery ceilings
const WR = 10.2; // north wing ceiling (upstairs)
const HR = 12; // grand hall ceiling
const T = 0.6; // outer wall thickness
const IT = 0.3; // inner wall thickness
const WARM = 0xffe6c0;

const k = new MapKit({ doorHeight: 3 });
const { box, span } = { box: k.box.bind(k), span: k.span.bind(k) };

function ramp(x: number, z: number, w: number, d: number, low: number, high: number, dir: '+x' | '-x' | '+z' | '-z', material: MaterialId, base = 0): void {
  k.ramps.push({ x, z, w, d, low, high, dir, base, material });
}

/** A statue on a plinth (`s` = size). */
function statue(x: number, z: number, y = F, s = 1): void {
  const p = 1.0 * s;
  box(x, y, z, 1.2 * s, p, 1.2 * s, 'stone', { top: 'marble' });
  const b = y + p;
  box(x, b, z, 0.5 * s, 0.9 * s, 0.32 * s, 'marble'); // legs
  box(x, b + 0.9 * s, z, 0.62 * s, 0.72 * s, 0.36 * s, 'marble'); // body
  box(x - 0.4 * s, b + 0.98 * s, z, 0.16 * s, 0.62 * s, 0.18 * s, 'marble'); // arm down
  box(x + 0.4 * s, b + 1.45 * s, z, 0.16 * s, 0.62 * s, 0.18 * s, 'marble'); // arm raised
  box(x, b + 1.66 * s, z, 0.26 * s, 0.3 * s, 0.28 * s, 'marble'); // head
}

/** A modern sculpture: a painted pillar with a gold crossbar. */
function sculpture(x: number, z: number, y: number): void {
  box(x, y, z, 1.4, 0.4, 1.4, 'stone', { top: 'marble' });
  box(x, y + 0.4, z, 0.5, 2.2, 0.5, 'carpaint');
  box(x + 0.2, y + 1.7, z, 1.2, 0.3, 0.3, 'gold');
}

/**
 * A painting hanging on a wall: (x, z) is a point on the wall's surface,
 * `facing` the direction the painting faces, y its bottom edge.
 */
function painting(x: number, y: number, z: number, facing: '+x' | '-x' | '+z' | '-z', w = 1.6, h = 1.1): void {
  const nx = facing === '+x' ? 1 : facing === '-x' ? -1 : 0;
  const nz = facing === '+z' ? 1 : facing === '-z' ? -1 : 0;
  const along = nx !== 0 ? 'z' : 'x';
  const part = (off: number, depth: number, pw: number, ph: number, py: number, m: MaterialId) => {
    const cx = x + nx * off, cz = z + nz * off;
    if (along === 'z') box(cx, py, cz, depth, ph, pw, m);
    else box(cx, py, cz, pw, ph, depth, m);
  };
  part(0.025, 0.05, w + 0.2, h + 0.2, y, 'gold'); // frame
  part(0.065, 0.03, w, h, y + 0.1, 'art'); // canvas
}

/** A glass display case on a wooden base, with a gold artifact inside. */
function displayCase(x: number, z: number, y = F): void {
  box(x, y, z, 1.2, 0.9, 0.9, 'desk');
  box(x, y + 0.9, z, 1.2, 0.7, 0.9, 'glass');
  box(x, y + 0.9, z, 0.24, 0.36, 0.24, 'gold');
}

/** A bench with a velvet cushion. */
function bench(x: number, z: number, y: number, alongX: boolean): void {
  if (alongX) box(x, y, z, 2.0, 0.45, 0.6, 'desk', { top: 'velvet' });
  else box(x, y, z, 0.6, 0.45, 2.0, 'desk', { top: 'velvet' });
}

function hedge(x0: number, x1: number, z0: number, z1: number): void {
  span(x0, x1, 0, 1.3, z0, z1, 'hedge');
}

/** A garden lamp post. */
function lampPost(x: number, z: number): void {
  box(x, 0, z, 0.2, 4, 0.2, 'metal');
  box(x, 3.95, z, 0.6, 0.15, 0.6, 'metal');
  k.lamp(x, 3.93, z, 0.8, 9, 0xffe2b0);
}

function car(x: number, z: number, paint: MaterialId): void {
  box(x, 0.18, z, 1.8, 0.72, 4.3, paint);
  box(x, 0.9, z + 0.2, 1.6, 0.55, 2.3, 'partition', { top: paint });
  for (const dx of [-0.82, 0.82]) for (const dz of [-1.4, 1.4]) box(x + dx, 0, z + dz, 0.25, 0.62, 0.62, 'partition');
}

// ---- Grounds ------------------------------------------------------------------------------
span(-41, 41, -1, 0, -31, 43, 'grass');
// Stone boundary wall.
box(0, 0, -30.5, 82, 3.5, 1, 'stone');
box(0, 0, 42.5, 82, 3.5, 1, 'stone');
box(-40.5, 0, 6, 1, 3.5, 72, 'stone');
box(40.5, 0, 6, 1, 3.5, 72, 'stone');
// Gate pillars and a (closed) iron gate at the south end.
for (const x of [-4, 4]) box(x, 0, 41.4, 1.2, 4.4, 1.2, 'stone', { top: 'marble' });
span(-3.4, 3.4, 0, 3.2, 41.6, 41.8, 'metal');
// Paths (a few centimeters high so they don't flicker against the grass).
const P = 0.04;
span(-8, 8, 0, P, 29, 40, 'stone'); // fountain plaza
span(-2, 2, 0, P, 40, 41.6, 'stone');
span(-31, -8, 0, P, 33.5, 35.5, 'stone');
span(8, 31, 0, P, 33.5, 35.5, 'stone');
span(-35, -31, 0, P, -27, 35.5, 'stone'); // side paths
span(31, 35, 0, P, -27, 35.5, 'stone');
span(-31, -30, 0, P, -1.3, 1.3, 'stone'); // to the side entrances
span(30, 31, 0, P, -1.3, 1.3, 'stone');
span(-30, 30, 0, P, -30, -22.6, 'asphalt'); // service yard

// Fountain: a stone basin with water, a pillar and a bowl in the middle.
const FZ = 34.5;
span(-3.5, 3.5, P, 0.75, FZ - 3.5, FZ - 3.1, 'stone');
span(-3.5, 3.5, P, 0.75, FZ + 3.1, FZ + 3.5, 'stone');
span(-3.5, -3.1, P, 0.75, FZ - 3.1, FZ + 3.1, 'stone');
span(3.1, 3.5, P, 0.75, FZ - 3.1, FZ + 3.1, 'stone');
span(-3.1, 3.1, P, 0.5, FZ - 3.1, FZ + 3.1, 'water');
box(0, 0.5, FZ, 0.8, 1.2, 0.8, 'stone');
box(0, 1.7, FZ, 2, 0.25, 2, 'stone', { top: 'water' });
box(0, 1.95, FZ, 0.3, 0.3, 0.3, 'gold');

// Hedge gardens either side of the plaza, with a statue and a bench in each.
for (const s of [-1, 1]) {
  const a = (v: number) => s * v;
  const lo = (p: number, q: number) => [Math.min(a(p), a(q)), Math.max(a(p), a(q))] as const;
  hedge(...lo(14, 26), 25.5, 26.4);
  hedge(...lo(14, 26), 39.5, 40.4);
  hedge(...lo(25.5, 26.4), 27.5, 32.5);
  hedge(...lo(14, 14.9), 36.5, 39.5);
  hedge(...lo(10, 11), 28, 31.5);
  statue(a(20), 29.5, 0, 1.1);
  bench(a(20), 38, 0, true);
  lampPost(a(9), 31);
  lampPost(a(29), 37);
}
// Side strips: statues, hedges, benches, lamp posts.
statue(-37.5, -15, 0);
statue(-37.5, 8, 0);
hedge(-38.6, -37.6, -6, 1);
hedge(-29.6, -28.8, -18, -10);
hedge(28.8, 29.6, 6, 13);
hedge(37.6, 38.6, -14, -6);
statue(37.5, 2, 0);
bench(37.8, 12, 0, false);
bench(-37.8, -24, 0, false);
for (const s of [-1, 1]) for (const z of [-18, 0, 18]) lampPost(s * 36.6, z + 3);

// Service yard (north): loading dock, containers, crates, a van, dumpsters.
span(-7, 1, 0, F, -24.5, -22, 'concrete');
ramp(-9, -23.25, 4, 2.5, P, F, '+x', 'metal');
span(-26, -20, P, 2.6 + P, -29.6, -27.2, 'container');
span(22, 28, P, 2.6 + P, -29.6, -27.2, 'container');
box(-16.5, P, -28.6, 1.5, 1.5, 1.5, 'crate');
box(-15, P, -28.8, 1.2, 1.1, 1.2, 'crate');
box(-16.5, 1.5 + P, -28.6, 1.1, 1.1, 1.1, 'crate');
car(12, -26, 'carpaint');
car(5, -26.5, 'container');
box(19, P, -28.8, 2.2, 1.4, 1.3, 'container');
box(16.5, P, -23.4, 1.4, 1.2, 1.4, 'crate');
box(3, F, -23.2, 1.2, 1.0, 1.2, 'crate');

// ---- The podium and the portico ------------------------------------------------------------
// Floors (y 0..F): stone sides, the floor material of each area on top.
span(-10, 10, 0, F, -12, 10, 'stone', { top: 'marble' }); // grand hall
span(-28, -10, 0, F, -12, 10, 'stone', { top: 'marble' }); // sculpture gallery
span(10, 28, 0, F, -12, 10, 'stone', { top: 'desk' }); // painting gallery (wooden floor)
span(-28, 28, 0, F, -22, -12, 'stone', { top: 'tile' }); // antiquities
span(-28, 28, 0, F, 10, 18, 'stone', { top: 'marble' }); // foyer, gift shop, café
span(-14, 14, 0, F, 18, 23, 'stone', { top: 'marble' }); // portico
k.stairs(0, 26, 28, 6, 0, F, '-z'); // front steps
k.stairs(-29.5, 0, 3, 2.6, 0, F, '+x'); // side entrances
k.stairs(29.5, 0, 3, 2.6, 0, F, '-x');

// Portico: six columns, a roof and a stepped pediment.
for (const x of [-12, -8, -4.5, 4.5, 8, 12]) {
  box(x, F, 22.3, 1.1, 0.3, 1.1, 'stone');
  box(x, F + 0.3, 22.3, 0.85, 8.2 - F - 0.6, 0.85, 'marble');
  box(x, 8.2 - 0.3, 22.3, 1.1, 0.3, 1.1, 'stone');
}
span(-14, 14, 8.2, 9, 18, 23.2, 'stone', { bottom: 'marble' });
span(-12, 12, 9, 9.6, 18.2, 23.1, 'stone');
span(-8, 8, 9.6, 10.2, 18.2, 23, 'stone');
span(-4, 4, 10.2, 10.8, 18.2, 22.9, 'stone');

// ---- Outer walls ------------------------------------------------------------------------------
const stoneOut = (inside: '+x' | '-x' | '+z' | '-z') => ({ t: T, mat: 'stone' as MaterialId, faces: { [inside]: 'drywall' } as BoxDef['faces'] });
// North wall: two stories (antiquities below, modern gallery above), the loading dock door.
k.wall('x', -21.7, { ...stoneOut('+z'), from: -28, to: 28, y0: F, y1: U, openings: [win(-22, -18, 1.4, 3.6), door(-5, -1, 3.4), win(6, 10, 1.4, 3.6)] });
k.wall('x', -21.7, { ...stoneOut('+z'), from: -28, to: 28, y0: U, y1: WR + 0.4, openings: [win(-24, -20, 1.0, 2.8), win(-12, -8, 1.0, 2.8), win(2, 6, 1.0, 2.8), win(16, 20, 1.0, 2.8)] });
// South wall: the main entrance, windows into the gift shop and café.
k.wall('x', 17.7, { ...stoneOut('-z'), from: -28, to: 28, y0: F, y1: GR + 0.4, openings: [win(-24, -20, 1.0, 3.4), win(-16, -12, 1.0, 3.4), door(-3, 3, 4.2), win(12, 16, 1.0, 3.4), win(20, 24, 1.0, 3.4)] });
for (const s of [-1, 1]) {
  const x = s * 27.7;
  const inside = s < 0 ? '+x' : '-x';
  // North wing part (two stories).
  k.wall('z', x, { ...stoneOut(inside), from: -21.4, to: -12, y0: F, y1: U, openings: [win(-18.5, -15, 1.4, 3.6)] });
  k.wall('z', x, { ...stoneOut(inside), from: -21.4, to: -12, y0: U, y1: WR + 0.4, openings: [win(-18.5, -15, 1.0, 2.8)] });
  // Gallery part: a side entrance, high windows.
  k.wall('z', x, { ...stoneOut(inside), from: -12, to: 17.4, y0: F, y1: GR + 0.4, openings: [win(-9, -5, 3.6, 5.4), door(-1.3, 1.3, 3), win(5, 9, 3.6, 5.4), win(12, 16, 1.0, 3.4)] });
}

// ---- Inner walls ------------------------------------------------------------------------------
// Between the galleries and the north wing (two stories high).
k.wall('x', -12, { t: IT, from: -27.4, to: -10.15, y0: F, y1: WR + 0.4, openings: [door(-22, -18, 3.5)] });
k.wall('x', -12, { t: IT, from: 10.15, to: 27.4, y0: F, y1: WR + 0.4, openings: [door(18, 22, 3.5)] });
// Grand hall: north wall (antiquities below, door to the modern gallery from the balcony).
k.wall('x', -12, { t: IT, from: -10.15, to: 10.15, y0: F, y1: U, openings: [door(-3, 3, 4.4)] });
k.wall('x', -12, { t: IT, from: -10.15, to: 10.15, y0: U, y1: HR + 0.4, openings: [door(-2, 2, 2.8)] });
// Grand hall: side walls (a wide opening into each gallery, under the balcony), stone above the gallery roofs.
for (const s of [-1, 1]) {
  k.wall('z', s * 10, { t: IT, from: -11.85, to: 9.85, y0: F, y1: GR + 0.4, openings: [door(-10, -5, 4.2)] });
  k.wall('z', s * 10, { t: IT, mat: 'stone', faces: { [s < 0 ? '+x' : '-x']: 'drywall' }, from: -11.85, to: 9.85, y0: GR + 0.4, y1: HR + 0.4 });
}
// Grand hall: south wall (opening into the foyer).
k.wall('x', 10, { t: IT, from: -10.15, to: 10.15, y0: F, y1: GR + 0.4, openings: [door(-3, 3, 5)] });
k.wall('x', 10, { t: IT, mat: 'stone', faces: { '-z': 'drywall' }, from: -10.15, to: 10.15, y0: GR + 0.4, y1: HR + 0.4 });
// Galleries | gift shop and café.
k.wall('x', 10, { t: IT, from: -27.4, to: -10.15, y0: F, y1: GR, openings: [door(-22, -18, 3.5)] });
k.wall('x', 10, { t: IT, from: 10.15, to: 27.4, y0: F, y1: GR, openings: [door(18, 22, 3.5)] });
// Foyer | gift shop, foyer | café.
k.wall('z', -6, { t: IT, from: 10.15, to: 17.4, y0: F, y1: GR, openings: [door(12.5, 15.5, 3)] });
k.wall('z', 6, { t: IT, from: 10.15, to: 17.4, y0: F, y1: GR, openings: [door(12.5, 15.5, 3)] });

// ---- Roofs and the upper floors ---------------------------------------------------------------
const roof = (x0: number, x1: number, z0: number, z1: number, y: number) => span(x0, x1, y, y + 0.4, z0, z1, 'concrete', { bottom: 'ceiling', '-x': 'stone', '+x': 'stone', '-z': 'stone', '+z': 'stone' });
roof(-27.4, -10.15, -11.85, 17.4, GR); // west gallery and gift shop
roof(10.15, 27.4, -11.85, 17.4, GR); // east gallery and café
roof(-10.15, 10.15, 10.15, 17.4, GR); // foyer
roof(-27.4, 27.4, -21.4, -12.15, WR); // north wing
// Grand hall roof around a glass skylight (with metal glazing bars).
roof(-10.15, 10.15, -11.85, -8, HR);
roof(-10.15, 10.15, 6, 9.85, HR);
roof(-10.15, -5, -8, 6, HR);
roof(5, 10.15, -8, 6, HR);
span(-5, 5, HR + 0.15, HR + 0.25, -8, 6, 'glass');
for (const z of [-5.5, -3, -0.5, 2, 4.5]) span(-5, 5, HR + 0.25, HR + 0.35, z - 0.06, z + 0.06, 'metal');
span(-0.06, 0.06, HR + 0.25, HR + 0.35, -8, 6, 'metal');

// North wing upper floor, with an opening over its staircase (north-east corner).
k.slab(-27.4, 14, -21.4, -12.15, U - 0.4, 0.4, 'tile', 'ceiling', 'stone');
k.slab(14, 25, -18.6, -12.15, U - 0.4, 0.4, 'tile', 'ceiling', 'stone');
k.slab(25, 27.4, -21.4, -12.15, U - 0.4, 0.4, 'tile', 'ceiling', 'stone');
k.stairs(19.5, -20.15, 11, 2.5, F, U, '+x', F);
span(14, 25, U, U + 1, -18.63, -18.57, 'glass'); // railings around the stairwell
span(14, 25, U + 1, U + 1.06, -18.65, -18.55, 'metal');
span(13.97, 14.03, U, U + 1, -21.4, -18.6, 'glass');
span(13.95, 14.05, U + 1, U + 1.06, -21.4, -18.6, 'metal');

// Grand hall balcony: a strip along the north wall and one down each side, glass railings.
k.slab(-9.85, 9.85, -11.85, -9.5, U - 0.4, 0.4, 'marble', 'ceiling', 'marble');
for (const s of [-1, 1]) {
  const [x0, x1] = s < 0 ? [-9.85, -7.5] : [7.5, 9.85];
  k.slab(x0, x1, -9.5, -4, U - 0.4, 0.4, 'marble', 'ceiling', 'marble');
  const rx = s * 7.53;
  span(rx - 0.03, rx + 0.03, U, U + 1, -9.5, -4, 'glass');
  span(rx - 0.05, rx + 0.05, U + 1, U + 1.06, -9.5, -4, 'gold');
  // Stairs up the side walls, climbing north to the balcony.
  k.stairs(s * 8.75, 2, 2.5, 12, F, U, '-z', F);
}
span(-7.5, 7.5, U, U + 1, -9.53, -9.47, 'glass');
span(-7.55, 7.55, U + 1, U + 1.06, -9.55, -9.45, 'gold');

// ---- Grand hall --------------------------------------------------------------------------------
for (const x of [-5.5, 5.5]) {
  for (const z of [-7, -1.5, 4]) {
    box(x, F, z, 1.3, 0.4, 1.3, 'stone');
    box(x, F + 0.4, z, 1.0, HR - F - 0.8, 1.0, 'marble');
    box(x, HR - 0.4, z, 1.3, 0.4, 1.3, 'stone');
  }
}
statue(0, -1, F, 1.5);
bench(0, 4.5, F, true);
bench(0, -6.5, F, true);
painting(-6.2, F + 3, 9.85, '-z', 2.4, 1.7);
painting(6.2, F + 3, 9.85, '-z', 2.4, 1.7);
painting(-4.5, U + 1.2, -11.85, '+z', 2.0, 1.4);
painting(4.5, U + 1.2, -11.85, '+z', 2.0, 1.4);

// ---- West: sculpture gallery ----------------------------------------------------------------
span(-18.65, -18.35, F, F + 3.4, -10, -4, 'drywall', { top: 'marble' }); // freestanding walls
span(-18.65, -18.35, F, F + 3.4, 3, 8.5, 'drywall', { top: 'marble' });
statue(-22.5, -7);
statue(-14.5, -7);
statue(-22.5, 5.5);
statue(-14.5, 5.5);
statue(-18.5, -0.5, F, 1.3);
bench(-25.5, -0.5, F, false);
bench(-12.5, -0.5, F, false);
painting(-27.4, F + 1.4, -1.0, '+x', 1.0, 1.4);

// ---- East: painting gallery -----------------------------------------------------------------
span(18.35, 18.65, F, F + 3.4, -10, -4, 'drywall');
span(18.35, 18.65, F, F + 3.4, 3, 8.5, 'drywall');
for (const z of [-7, 5.75]) {
  painting(18.35, F + 1.1, z, '-x', 2.0, 1.4);
  painting(18.65, F + 1.1, z, '+x', 2.0, 1.4);
}
for (const z of [-8.5, -4.5, 4.5, 8]) painting(27.4, F + 1.2, z, '-x');
for (const x of [13.5, 24.5]) {
  painting(x, F + 1.2, -11.85, '+z');
  painting(x, F + 1.2, 9.85, '-z');
}
for (const z of [0, 5]) painting(10.15, F + 1.2, z, '+x');
bench(23, -6, F, false);
bench(23, 6, F, false);
bench(14, -0.5, F, true);

// ---- North wing, downstairs: antiquities -------------------------------------------------------
displayCase(-24.5, -16.5);
displayCase(-18, -19.5);
displayCase(-12, -16);
displayCase(-7, -19.5);
displayCase(6.5, -19.5);
displayCase(10.5, -15.5);
// A sarcophagus on a low plinth.
span(-2, 2, F, F + 0.3, -18.5, -16.3, 'stone');
span(-1.4, 1.4, F + 0.3, F + 1.2, -18.1, -16.7, 'stone', { top: 'gold' });
// An obelisk and a stone tablet.
box(-24.5, F, -20.2, 1.0, 0.3, 1.0, 'stone');
box(-24.5, F + 0.3, -20.2, 0.7, 3.6, 0.7, 'stone', { top: 'gold' });
span(-14, -11, F, F + 2.2, -21.4, -21.1, 'stone');

// ---- North wing, upstairs: modern gallery -------------------------------------------------------
sculpture(-20, -17, U);
sculpture(-6, -17.5, U);
sculpture(6, -16.5, U);
span(-14.15, -13.85, U, U + 3, -19.5, -14, 'drywall');
span(9.85, 10.15, U, U + 3, -19.5, -14, 'drywall');
for (const x of [-24, -18, -10, -2, 4]) painting(x, U + 1.1, -21.4, '+z');
for (const x of [-24, -18, -8, 7]) painting(x, U + 1.1, -12.15, '-z');
painting(-14.15, U + 0.9, -16.75, '-x', 2.4, 1.6);
painting(10.15, U + 0.9, -16.75, '+x', 2.4, 1.6);
bench(-10, -17, U, false);
bench(1, -15, U, true);

// ---- South: foyer, gift shop, café -------------------------------------------------------------
span(-5.4, -4.4, F, F + 1.1, 12, 16, 'desk', { top: 'marble' }); // ticket desk
span(4.4, 5.4, F, F + 1.1, 12, 16, 'desk', { top: 'marble' }); // cloakroom
// Gift shop: shelves and a counter.
for (const x of [-25, -20, -15]) span(x, x + 0.6, F, F + 1.8, 12.5, 16, 'desk');
span(-10.5, -7.5, F, F + 1.0, 11.4, 12.3, 'desk', { top: 'marble' });
// Café: a counter, tables and chairs.
span(23.5, 27.3, F, F + 1.05, 11, 11.9, 'desk', { top: 'marble' });
for (const x of [10, 14, 18, 22]) {
  box(x, F, 14.5, 0.9, 0.75, 0.9, 'desk');
  box(x - 0.85, F, 14.5, 0.5, 0.85, 0.5, 'partition');
  box(x + 0.85, F, 14.5, 0.5, 0.85, 0.5, 'partition');
}

// ---- Lights ---------------------------------------------------------------------------------------
for (const s of [-1, 1]) {
  for (const z of [-7, 6]) k.lamp(s * 7.5, HR - 0.3, z, 1.4, 12, WARM); // grand hall
  k.lamp(s * 8.7, U - 0.5, -7, 0.8, 6, WARM); // under the balcony
  for (const x of [16, 23]) for (const z of [-7, 0, 6]) k.lamp(s * x, GR - 0.1, z, 1.1, 8.5, WARM); // galleries
  k.lamp(s * 16, GR - 0.1, 14, 1.0, 8, WARM); // gift shop / café
  k.lamp(s * 23, GR - 0.1, 14, 1.0, 8, WARM);
  k.lamp(s * 7, 8.1, 20.5, 0.9, 8, WARM); // portico
}
k.lamp(0, U - 0.5, -10.7, 0.8, 6, WARM);
k.lamp(0, GR - 0.1, 14, 1.2, 9, WARM); // foyer
for (const x of [-21, -11, -1, 9, 19]) {
  k.lamp(x, U - 0.5, -16.8, 1.0, 8, WARM); // antiquities
  k.lamp(x, WR - 0.1, -16.8, 1.0, 8, WARM); // modern gallery
}

// ---- Pickups ----------------------------------------------------------------------------------------
k.pickups.push(
  { type: 'health', x: -25.5, y: F, z: -10 }, // sculpture gallery
  { type: 'health', x: 25.5, y: F, z: 0 }, // painting gallery
  { type: 'health', x: 14, y: F, z: 16.5 }, // café
  { type: 'health', x: -14, y: P, z: -26 }, // service yard
  { type: 'health', x: 20, y: 0, z: 32 }, // east garden
  { type: 'armor', x: 0, y: U, z: -10.7 }, // grand hall balcony
  { type: 'ammo', x: -12, y: F, z: 16.5 }, // gift shop
  { type: 'ammo', x: 2.5, y: F, z: -14 }, // antiquities
  { type: 'ammo', x: -20, y: 0, z: 32 }, // west garden
  { type: 'ammo', x: 37.5, y: 0, z: -8 }, // east side
  { type: 'ammo', x: -20, y: U, z: -14 }, // modern gallery
);

export const museum: MapDef = {
  id: 'museum',
  name: 'Museum',
  description: 'A grand museum: a marble hall with a balcony, sculpture and painting galleries, gardens and a fountain outside.',
  skyColor: 0xbcd0e2,
  // A bright, clear afternoon.
  sky: {
    zenith: 0x3d7bcc,
    horizon: 0xd0dbe4,
    ground: 0x5d6050,
    sunColor: 0xfff0d6,
    sunElevation: 46,
    sunAzimuth: 215,
    clouds: 0.3,
    skylineColor: 0x56616e,
  },
  fogNear: 70,
  fogFar: 230,
  indoorShading: 0.6,
  levels: [0, U],
  navSpacing: 0.75,
  boxes: k.boxes,
  ramps: k.ramps,
  lamps: k.lamps,
  pickups: k.pickups,
  playerSpawns: [
    spawnAt(0, P, 30.5, 0), spawnAt(-33, P, -10, 0), spawnAt(33, P, 10, 180), spawnAt(0, F, 14.5, 0),
    spawnAt(-12, P, -26, -90), spawnAt(0, U, -16, 180),
  ],
  botSpawns: [
    spawnAt(-21, F, -10.5, 180), spawnAt(21, F, -10.5, 180), spawnAt(-24, F, 2, 0), spawnAt(24, F, -2, 90),
    spawnAt(0, F, 7, 0), spawnAt(-20, F, -14.5, 0), spawnAt(14, F, -14.5, 90), spawnAt(-22.5, F, 14, 90),
    spawnAt(18, F, 16.5, 0), spawnAt(-20, P, 34.5, 0), spawnAt(20, P, 34.5, 0), spawnAt(8, U, -15, -90),
    spawnAt(33, P, -20, 0), spawnAt(-33, P, 20, 180),
  ],
};
