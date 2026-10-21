import type { MapDef } from '../MapTypes';

/**
 * Milestone 1 test room: a walled box with a few blocks, a step, and a ramp
 * up to a platform so movement, jumping, and crouching can be tried out.
 */
const S = 30; // room size (meters)
const WALL_H = 6;
const T = 1; // wall thickness

export const testRoom: MapDef = {
  id: 'test-room',
  name: 'Test Room',
  description: 'An empty room for trying out movement.',
  skyColor: 0x9cc4e4,
  sky: { zenith: 0x3b78c8, horizon: 0xbcd6ea, sunColor: 0xfff1dd, sunElevation: 55, sunAzimuth: 140, clouds: 0.3, skyline: false },
  fogNear: 60,
  fogFar: 160,
  boxes: [
    // Floor
    { x: 0, y: -1, z: 0, w: S + 2 * T, h: 1, d: S + 2 * T, material: 'floor' },
    // Outer walls
    { x: 0, y: 0, z: -S / 2 - T / 2, w: S + 2 * T, h: WALL_H, d: T, material: 'wall' },
    { x: 0, y: 0, z: S / 2 + T / 2, w: S + 2 * T, h: WALL_H, d: T, material: 'wall' },
    { x: -S / 2 - T / 2, y: 0, z: 0, w: T, h: WALL_H, d: S, material: 'wall' },
    { x: S / 2 + T / 2, y: 0, z: 0, w: T, h: WALL_H, d: S, material: 'wall' },

    // Crates to jump on / hide behind
    { x: -6, y: 0, z: -4, w: 1.5, h: 1.0, d: 1.5, material: 'crate' },
    { x: -4.5, y: 0, z: -4, w: 1.5, h: 1.5, d: 1.5, material: 'crate' },
    { x: 5, y: 0, z: 5, w: 3, h: 2.5, d: 1, material: 'concrete' },

    // A low step (walk up it without jumping)
    { x: 0, y: 0, z: 8, w: 4, h: 0.3, d: 2, material: 'concrete' },

    // Crouch tunnel: a slab you can only get under while crouching
    { x: -9, y: 1.3, z: 6, w: 3, h: 0.6, d: 4, material: 'metal' },
    { x: -10.75, y: 0, z: 6, w: 0.5, h: 1.9, d: 4, material: 'metal' },
    { x: -7.25, y: 0, z: 6, w: 0.5, h: 1.9, d: 4, material: 'metal' },

    // Raised platform at the back, reached by the ramp
    { x: 8, y: 0, z: -10, w: 8, h: 3, d: 6, material: 'concrete' },
    // Railing trim on the platform edge
    { x: 8, y: 3, z: -7.1, w: 8, h: 0.15, d: 0.2, material: 'trim' },
  ],
  ramps: [{ x: 1, z: -11, w: 6, d: 4, low: 0, high: 3, dir: '+x', material: 'metal' }],
  playerSpawns: [
    { x: 0, y: 0, z: 12, yaw: 0 },
    { x: -12, y: 0, z: 12, yaw: 0 },
    { x: 12, y: 0, z: 12, yaw: 0 },
    { x: -12, y: 0, z: -2, yaw: -90 },
  ],
  pickups: [
    { type: 'health', x: 12, y: 0, z: 8 },
    { type: 'armor', x: 9, y: 3, z: -12 },
    { type: 'ammo', x: -12, y: 0, z: 0 },
  ],
  lamps: [
    { x: 0, y: 4.5, z: -14.92, color: 0xffb35c, intensity: 1.4, range: 11, facing: '+z' },
    { x: -14.92, y: 4.5, z: 6, color: 0xbfe0ff, intensity: 1.2, range: 10, facing: '+x' },
  ],
  botSpawns: [
    { x: 8, y: 3, z: -11, yaw: 180 }, // on the platform
    { x: -12, y: 0, z: -12, yaw: 180 },
    { x: 12, y: 0, z: -2, yaw: 90 },
    { x: -2, y: 0, z: -4, yaw: 180 },
  ],
  // Practice dummies (none here now that there's a bot). Example:
  // practiceTargets: [{ x: 0, y: 0, z: 0, yaw: 180 }],
};
