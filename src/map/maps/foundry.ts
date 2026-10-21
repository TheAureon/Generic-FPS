import type { BoxDef, MapDef, SpawnPoint } from '../MapTypes';

/**
 * FOUNDRY — the main arena (60 x 44 m).
 *
 *   West yard | Center               | East yard
 *   raised    | two-story building   | raised
 *   deck      | with a roof you can  | deck
 *   + ramp    | reach by a ramp      | + ramp
 *
 * Two dividing walls (x = -15 and x = +15) each have two doorways: these
 * are the choke points between the yards and the center. The center
 * building has doors on the north, south, and east sides.
 *
 * Coordinates: X runs west (-) to east (+), Z runs north (-) to south (+),
 * Y is up. Box x/z = center, y = bottom.
 */

const HALF_X = 30;
const HALF_Z = 22;
const WALL_H = 7;
const DIVIDER_H = 4;

// The center building: 12 x 12, walls 0.5 thick, 3 m tall, roof on top.
const BLD = 6;
const BLD_H = 3;
const ROOF_T = 0.5;
const DOOR = 2.4; // doorway width
const DOOR_H = 2.4;

const perimeter: BoxDef[] = [
  { x: 0, y: -1, z: 0, w: HALF_X * 2 + 2, h: 1, d: HALF_Z * 2 + 2, material: 'floor' },
  { x: 0, y: 0, z: -HALF_Z - 0.5, w: HALF_X * 2 + 2, h: WALL_H, d: 1, material: 'wall' },
  { x: 0, y: 0, z: HALF_Z + 0.5, w: HALF_X * 2 + 2, h: WALL_H, d: 1, material: 'wall' },
  { x: -HALF_X - 0.5, y: 0, z: 0, w: 1, h: WALL_H, d: HALF_Z * 2, material: 'wall' },
  { x: HALF_X + 0.5, y: 0, z: 0, w: 1, h: WALL_H, d: HALF_Z * 2, material: 'wall' },
];

// Dividing walls with two 3 m doorways each (at z = -12 and z = +12).
const dividers: BoxDef[] = [-15, 15].flatMap((x) => [
  { x, y: 0, z: -17.75, w: 1, h: DIVIDER_H, d: 8.5, material: 'concrete' as const },
  { x, y: 0, z: 0, w: 1, h: DIVIDER_H, d: 21, material: 'concrete' as const },
  { x, y: 0, z: 17.75, w: 1, h: DIVIDER_H, d: 8.5, material: 'concrete' as const },
]);

const side = (BLD - DOOR / 2) / 2 + DOOR / 2; // center of a wall segment beside a door
const segLen = BLD - DOOR / 2;
const building: BoxDef[] = [
  // North wall (door in the middle) + lintel over the door
  { x: -side, y: 0, z: -BLD + 0.25, w: segLen, h: BLD_H, d: 0.5, material: 'wall' },
  { x: side, y: 0, z: -BLD + 0.25, w: segLen, h: BLD_H, d: 0.5, material: 'wall' },
  { x: 0, y: DOOR_H, z: -BLD + 0.25, w: DOOR, h: BLD_H - DOOR_H, d: 0.5, material: 'wall' },
  // South wall
  { x: -side, y: 0, z: BLD - 0.25, w: segLen, h: BLD_H, d: 0.5, material: 'wall' },
  { x: side, y: 0, z: BLD - 0.25, w: segLen, h: BLD_H, d: 0.5, material: 'wall' },
  { x: 0, y: DOOR_H, z: BLD - 0.25, w: DOOR, h: BLD_H - DOOR_H, d: 0.5, material: 'wall' },
  // West wall (solid)
  { x: -BLD + 0.25, y: 0, z: 0, w: 0.5, h: BLD_H, d: BLD * 2 - 1, material: 'wall' },
  // East wall (door in the middle)
  { x: BLD - 0.25, y: 0, z: -side, w: 0.5, h: BLD_H, d: segLen - 0.5, material: 'wall' },
  { x: BLD - 0.25, y: 0, z: side, w: 0.5, h: BLD_H, d: segLen - 0.5, material: 'wall' },
  { x: BLD - 0.25, y: DOOR_H, z: 0, w: 0.5, h: BLD_H - DOOR_H, d: DOOR + 0.5, material: 'wall' },
  // Roof
  { x: 0, y: BLD_H, z: 0, w: BLD * 2, h: ROOF_T, d: BLD * 2, material: 'metal' },
  // Low walls around the roof edge (cover up top). Gap on the west side for the ramp.
  { x: 0, y: BLD_H + ROOF_T, z: -BLD + 0.2, w: BLD * 2, h: 1, d: 0.4, material: 'trim' },
  { x: 0, y: BLD_H + ROOF_T, z: BLD - 0.2, w: BLD * 2, h: 1, d: 0.4, material: 'trim' },
  { x: BLD - 0.2, y: BLD_H + ROOF_T, z: 0, w: 0.4, h: 1, d: BLD * 2 - 0.8, material: 'trim' },
  { x: -BLD + 0.2, y: BLD_H + ROOF_T, z: -3.9, w: 0.4, h: 1, d: 3.4, material: 'trim' },
  { x: -BLD + 0.2, y: BLD_H + ROOF_T, z: 3.9, w: 0.4, h: 1, d: 3.4, material: 'trim' },
  // Crate on the roof
  { x: 1.5, y: BLD_H + ROOF_T, z: 0, w: 1.5, h: 1.2, d: 1.5, material: 'crate' },
  // Inside: a couple of crates
  { x: -3, y: 0, z: -3, w: 1.4, h: 1.1, d: 1.4, material: 'crate' },
  { x: 3, y: 0, z: 3.2, w: 1.4, h: 1.1, d: 1.4, material: 'crate' },
];

const center: BoxDef[] = [
  // Low walls north and south of the building
  { x: 0, y: 0, z: -11, w: 6, h: 1.2, d: 0.6, material: 'concrete' },
  { x: 0, y: 0, z: 11, w: 6, h: 1.2, d: 0.6, material: 'concrete' },
  // Tall pillars (full cover)
  { x: -10, y: 0, z: -8, w: 1.5, h: 4, d: 1.5, material: 'concrete' },
  { x: 10, y: 0, z: -8, w: 1.5, h: 4, d: 1.5, material: 'concrete' },
  { x: -10, y: 0, z: 8, w: 1.5, h: 4, d: 1.5, material: 'concrete' },
  { x: 10, y: 0, z: 8, w: 1.5, h: 4, d: 1.5, material: 'concrete' },
  // Crates
  { x: -8.5, y: 0, z: -16, w: 2, h: 1.3, d: 2, material: 'crate' },
  { x: 8.5, y: 0, z: 16, w: 2, h: 1.3, d: 2, material: 'crate' },
  { x: 9, y: 0, z: -17, w: 1.5, h: 2.2, d: 1.5, material: 'crate' },
  { x: -9, y: 0, z: 17, w: 1.5, h: 2.2, d: 1.5, material: 'crate' },
];

// West yard: raised deck along the west wall, reached by a ramp from the south.
const west: BoxDef[] = [
  { x: -27.5, y: 0, z: 0, w: 5, h: 2.5, d: 20, material: 'concrete' },
  // Low wall on the deck edge (gaps at both ends to drop down)
  { x: -25.2, y: 2.5, z: 0, w: 0.4, h: 1, d: 14, material: 'trim' },
  { x: -20, y: 0, z: -15, w: 2, h: 2, d: 2, material: 'crate' },
  { x: -21.5, y: 0, z: -12.8, w: 1.5, h: 1.2, d: 1.5, material: 'crate' },
  { x: -19, y: 0, z: 6, w: 2, h: 2, d: 2, material: 'crate' },
  { x: -22, y: 0, z: 17, w: 3, h: 1.2, d: 1.5, material: 'crate' },
  { x: -20, y: 0, z: -2, w: 1.5, h: 4, d: 1.5, material: 'concrete' },
];

// East yard: mirror image, ramp from the north.
const east: BoxDef[] = [
  { x: 27.5, y: 0, z: 0, w: 5, h: 2.5, d: 20, material: 'concrete' },
  { x: 25.2, y: 2.5, z: 0, w: 0.4, h: 1, d: 14, material: 'trim' },
  { x: 20, y: 0, z: 15, w: 2, h: 2, d: 2, material: 'crate' },
  { x: 21.5, y: 0, z: 12.8, w: 1.5, h: 1.2, d: 1.5, material: 'crate' },
  { x: 19, y: 0, z: -6, w: 2, h: 2, d: 2, material: 'crate' },
  { x: 22, y: 0, z: -17, w: 3, h: 1.2, d: 1.5, material: 'crate' },
  { x: 20, y: 0, z: 2, w: 1.5, h: 4, d: 1.5, material: 'concrete' },
];

/** A spawn point facing the middle of the arena. */
function spawn(x: number, y: number, z: number): SpawnPoint {
  return { x, y, z, yaw: (Math.atan2(x, z) * 180) / Math.PI };
}

export const foundry: MapDef = {
  id: 'foundry',
  name: 'Foundry',
  description: 'Two yards with raised decks, split from a central two-story building by walls with doorways.',
  skyColor: 0xa9c6de,
  // Late afternoon: a warm, fairly low sun from the south-west (long shadows), scattered clouds.
  sky: {
    zenith: 0x3d74c2,
    horizon: 0xc2d4e2,
    ground: 0x5a544c,
    sunColor: 0xffd9a8,
    sunElevation: 34,
    sunAzimuth: 228,
    sunIntensity: 2.6,
    skyLight: 0.95,
    clouds: 0.42,
    skylineColor: 0x3e4651,
  },
  fogNear: 60,
  fogFar: 190,
  boxes: [...perimeter, ...dividers, ...building, ...center, ...west, ...east],
  ramps: [
    // Up to the building roof from the west (rises toward +x, reaching the roof edge).
    { x: -10, z: 0, w: 8, d: 3, low: 0, high: BLD_H + ROOF_T, dir: '+x', material: 'metal' },
    // West deck ramp, from the south (rises toward -z).
    { x: -27.5, z: 13, w: 5, d: 6, low: 0, high: 2.5, dir: '-z', material: 'metal' },
    // East deck ramp, from the north (rises toward +z).
    { x: 27.5, z: -13, w: 5, d: 6, low: 0, high: 2.5, dir: '+z', material: 'metal' },
  ],
  playerSpawns: [
    spawn(-22, 0, -18),
    spawn(22, 0, 18),
    spawn(-27.5, 2.5, -5),
    spawn(27.5, 2.5, 5),
    spawn(0, 0, -18),
    spawn(0, 0, 18),
  ],
  pickups: [
    { type: 'health', x: -2, y: 0, z: 2 }, // inside the building
    { type: 'health', x: -20, y: 0, z: 12 },
    { type: 'health', x: 20, y: 0, z: -12 },
    { type: 'armor', x: -2, y: BLD_H + ROOF_T, z: -3 }, // on the roof: worth the climb
    { type: 'ammo', x: -12.5, y: 0, z: -18 },
    { type: 'ammo', x: 12.5, y: 0, z: 18 },
    { type: 'ammo', x: -27.5, y: 2.5, z: 8 },
    { type: 'ammo', x: 27.5, y: 2.5, z: -8 },
  ],
  // Lamps: warm sodium lights in the yards, cool white lights by the building.
  lamps: [
    { x: 0, y: 2.85, z: 0, color: 0xffd9a0, intensity: 1.6, range: 9, facing: 'down' }, // inside the building
    { x: 0, y: 2.7, z: -6.08, color: 0xbfe0ff, intensity: 0.8, range: 7, facing: '-z' }, // above the north door
    { x: 0, y: 2.7, z: 6.08, color: 0xbfe0ff, intensity: 0.8, range: 7, facing: '+z' }, // above the south door
    { x: 6.08, y: 2.7, z: 0, color: 0xbfe0ff, intensity: 0.8, range: 7, facing: '+x' }, // above the east door
    { x: -14.42, y: 3.2, z: -16, color: 0xffa04a, intensity: 1.5, range: 10, facing: '+x' }, // west wall, by the north doorway
    { x: -15.58, y: 3.2, z: 16, color: 0xffa04a, intensity: 1.5, range: 10, facing: '-x' }, // west wall, yard side
    { x: 14.42, y: 3.2, z: 16, color: 0xffa04a, intensity: 1.5, range: 10, facing: '-x' }, // east wall, by the south doorway
    { x: 15.58, y: 3.2, z: -16, color: 0xffa04a, intensity: 1.5, range: 10, facing: '+x' }, // east wall, yard side
    { x: -29.92, y: 5, z: 0, color: 0xffb35c, intensity: 1.6, range: 11, facing: '+x' }, // over the west deck
    { x: 29.92, y: 5, z: 0, color: 0xffb35c, intensity: 1.6, range: 11, facing: '-x' }, // over the east deck
    { x: -22, y: 5, z: -21.92, color: 0xbfe0ff, intensity: 1.2, range: 10, facing: '+z' }, // west yard, north wall
    { x: 22, y: 5, z: 21.92, color: 0xbfe0ff, intensity: 1.2, range: 10, facing: '-z' }, // east yard, south wall
  ],
  botSpawns: [
    spawn(-22, 0, 18),
    spawn(22, 0, -18),
    spawn(-27.5, 2.5, 5),
    spawn(27.5, 2.5, -5),
    spawn(0, 0, 0),
    spawn(3, BLD_H + ROOF_T, 3),
    spawn(-10, 0, -18),
    spawn(10, 0, 18),
  ],
};
