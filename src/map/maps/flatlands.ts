import type { BoxDef, MapDef, PickupDef, RampDef, SpawnPoint } from '../MapTypes';

/**
 * FLATLANDS — a huge, flat dusty plain (200 x 200 m) with scattered cover.
 *
 *   - the center: a ring of jersey barriers with crates
 *   - 8 outposts (shipping container, crates, a low wall) with most pickups
 *   - 4 corner towers with ramps (armor on top of two of them)
 *   - everywhere else: one random piece of cover per 24 m square
 *
 * The layout is generated from a fixed seed, so it's the same every time.
 * Coordinates: X west (-) to east (+), Z north (-) to south (+), Y up.
 */

const HALF = 100;
const WALL_H = 4;
const CELL = 24;

/** Repeatable random numbers. */
let seed = 20240607;
function rnd(): number {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
}

const boxes: BoxDef[] = [
  // Ground and the boundary wall.
  { x: 0, y: -1, z: 0, w: HALF * 2 + 2, h: 1, d: HALF * 2 + 2, material: 'dirt' },
  { x: 0, y: 0, z: -HALF - 0.5, w: HALF * 2 + 2, h: WALL_H, d: 1, material: 'concrete' },
  { x: 0, y: 0, z: HALF + 0.5, w: HALF * 2 + 2, h: WALL_H, d: 1, material: 'concrete' },
  { x: -HALF - 0.5, y: 0, z: 0, w: 1, h: WALL_H, d: HALF * 2, material: 'concrete' },
  { x: HALF + 0.5, y: 0, z: 0, w: 1, h: WALL_H, d: HALF * 2, material: 'concrete' },
];
const ramps: RampDef[] = [];
const pickups: PickupDef[] = [];

// ---- The center: a ring of barriers with crates and a block in the middle ----
boxes.push(
  { x: 0, y: 0, z: -6.5, w: 5, h: 1, d: 0.5, material: 'trim' },
  { x: 0, y: 0, z: 6.5, w: 5, h: 1, d: 0.5, material: 'trim' },
  { x: -6.5, y: 0, z: 0, w: 0.5, h: 1, d: 5, material: 'trim' },
  { x: 6.5, y: 0, z: 0, w: 0.5, h: 1, d: 5, material: 'trim' },
  { x: 0, y: 0, z: 0, w: 2, h: 2.4, d: 2, material: 'concrete' },
  { x: -4.5, y: 0, z: -4.5, w: 1.4, h: 1.2, d: 1.4, material: 'crate' },
  { x: 4.5, y: 0, z: 4.5, w: 1.4, h: 1.2, d: 1.4, material: 'crate' },
  { x: 4.5, y: 0, z: -4.5, w: 1.2, h: 1, d: 1.2, material: 'crate' },
  { x: -4.5, y: 0, z: 4.5, w: 1.2, h: 1, d: 1.2, material: 'crate' },
);
pickups.push({ type: 'health', x: -2.5, y: 0, z: 2.5 }, { type: 'ammo', x: 2.5, y: 0, z: -2.5 });

// ---- Outposts: a container, crates and a low wall, facing the center ----
const outposts: [number, number][] = [[-60, -12], [60, 12], [-12, 60], [12, -60], [-60, 36], [60, -36], [36, 60], [-36, -60]];
outposts.forEach(([cx, cz], i) => {
  const alongX = Math.abs(cx) < Math.abs(cz); // north/south outposts lie along X
  const toCenter = alongX ? -Math.sign(cz) : -Math.sign(cx);
  // Container: 6 long, 2.4 wide, 2.6 tall.
  boxes.push(alongX ? { x: cx, y: 0, z: cz, w: 6, h: 2.6, d: 2.4, material: 'container' } : { x: cx, y: 0, z: cz, w: 2.4, h: 2.6, d: 6, material: 'container' });
  // Crates at one end, a low wall in front (toward the center).
  const end = (i % 2 ? 1 : -1) * 4.2;
  boxes.push(alongX ? { x: cx + end, y: 0, z: cz, w: 1.5, h: 1.5, d: 1.5, material: 'crate' } : { x: cx, y: 0, z: cz + end, w: 1.5, h: 1.5, d: 1.5, material: 'crate' });
  boxes.push(alongX ? { x: cx + end, y: 1.5, z: cz, w: 1.1, h: 1.1, d: 1.1, material: 'crate' } : { x: cx, y: 1.5, z: cz + end, w: 1.1, h: 1.1, d: 1.1, material: 'crate' });
  const wallOff = toCenter * 4;
  boxes.push(alongX ? { x: cx, y: 0, z: cz + wallOff, w: 4, h: 1.15, d: 0.5, material: 'concrete' } : { x: cx + wallOff, y: 0, z: cz, w: 0.5, h: 1.15, d: 4, material: 'concrete' });
  // A pickup between the container and the wall.
  const px = alongX ? cx : cx + toCenter * 2.1;
  const pz = alongX ? cz + toCenter * 2.1 : cz;
  pickups.push({ type: i % 2 ? 'ammo' : 'health', x: px, y: 0, z: pz });
});

// ---- Corner towers: a concrete block with a ramp from the center side ----
const towers: [number, number][] = [[-84, -84], [84, 84], [84, -84], [-84, 84]];
towers.forEach(([cx, cz], i) => {
  const sx = Math.sign(cx);
  const H = 3.5;
  boxes.push({ x: cx, y: 0, z: cz, w: 5, h: H, d: 5, material: 'concrete' });
  // Ramp on the center side, rising toward the tower.
  ramps.push({ x: cx - sx * 6, z: cz, w: 7, d: 2.6, low: 0, high: H, dir: sx > 0 ? '+x' : '-x', material: 'metal' });
  // Low barriers around the top (not on the ramp side).
  boxes.push(
    { x: cx, y: H, z: cz - 2.3, w: 5, h: 1, d: 0.4, material: 'trim' },
    { x: cx, y: H, z: cz + 2.3, w: 5, h: 1, d: 0.4, material: 'trim' },
    { x: cx + sx * 2.3, y: H, z: cz, w: 0.4, h: 1, d: 4.2, material: 'trim' },
  );
  if (i < 2) pickups.push({ type: 'armor', x: cx, y: H, z: cz });
});

// ---- Scattered cover: one piece per 24 m square (none near the center or on outposts/towers) ----
const taken = new Set<string>([...outposts, ...towers].map(([x, z]) => `${x},${z}`));
for (let i = 0; i < 8; i++) {
  for (let j = 0; j < 8; j++) {
    const cx = -84 + i * CELL, cz = -84 + j * CELL;
    if (taken.has(`${cx},${cz}`) || (Math.abs(cx) < 20 && Math.abs(cz) < 20)) continue;
    const x = cx + (rnd() - 0.5) * 12, z = cz + (rnd() - 0.5) * 12;
    const turn = rnd() < 0.5;
    const kind = rnd();
    if (kind < 0.25) {
      boxes.push(turn ? { x, y: 0, z, w: 2.6, h: 1.2, d: 0.8, material: 'concrete' } : { x, y: 0, z, w: 0.8, h: 1.2, d: 2.6, material: 'concrete' });
    } else if (kind < 0.45) {
      boxes.push({ x, y: 0, z, w: 1.6, h: 1.6, d: 1.6, material: 'crate' });
      boxes.push({ x: x + 1.5, y: 0, z: z + 0.3, w: 1.2, h: 1.1, d: 1.2, material: 'crate' });
    } else if (kind < 0.6) {
      boxes.push({ x, y: 0, z, w: 1.5, h: 4, d: 1.5, material: 'concrete' });
    } else if (kind < 0.8) {
      boxes.push(turn ? { x, y: 0, z, w: 5, h: 1, d: 0.5, material: 'trim' } : { x, y: 0, z, w: 0.5, h: 1, d: 5, material: 'trim' });
    } else if (kind < 0.92) {
      boxes.push(turn ? { x, y: 0, z, w: 5, h: 1.15, d: 0.5, material: 'concrete' } : { x, y: 0, z, w: 0.5, h: 1.15, d: 5, material: 'concrete' });
    } else {
      boxes.push(turn ? { x, y: 0, z, w: 6, h: 2.6, d: 2.4, material: 'container' } : { x, y: 0, z, w: 2.4, h: 2.6, d: 6, material: 'container' });
    }
  }
}

/** A spawn point facing the middle of the map. */
function spawn(x: number, z: number, y = 0): SpawnPoint {
  return { x, y, z, yaw: (Math.atan2(x, z) * 180) / Math.PI };
}

export const flatlands: MapDef = {
  id: 'flatlands',
  name: 'Flatlands',
  description: 'A huge, flat dusty plain with scattered cover, outposts and corner towers. Long sightlines.',
  skyColor: 0xbcd3e6,
  // Bright midday: a high sun (short shadows), a few clouds, a distant skyline in the haze.
  sky: {
    zenith: 0x3a78c9,
    horizon: 0xcfdbe4,
    ground: 0x6a604f,
    sunColor: 0xfff3e0,
    sunElevation: 58,
    sunAzimuth: 160,
    sunIntensity: 2.5,
    clouds: 0.28,
    skylineColor: 0x56606c,
  },
  fogNear: 90,
  fogFar: 330,
  // A big map: a coarser grid for bot navigation keeps loading quick.
  navSpacing: 2,
  boxes,
  ramps,
  // Spawns sit on the corners between the 24 m squares, so they're always clear of cover.
  playerSpawns: [spawn(-72, 0), spawn(72, 0), spawn(0, -72), spawn(0, 72), spawn(-48, 72), spawn(48, -72)],
  botSpawns: [
    spawn(-72, -48), spawn(72, 48), spawn(-24, -72), spawn(24, 72), spawn(72, -24), spawn(-72, 24),
    spawn(-48, -24), spawn(48, 24), spawn(24, -48), spawn(-24, 48), spawn(-48, 48), spawn(48, -48),
  ],
  pickups,
};
