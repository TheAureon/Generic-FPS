/**
 * Maps are plain data. To add a new map, copy `maps/testRoom.ts`, change the
 * numbers, and register it in `maps/index.ts`.
 *
 * Coordinates: X = east/west, Z = north/south, Y = up. One unit = one meter.
 */

export type MaterialId = 'floor' | 'wall' | 'concrete' | 'crate' | 'metal' | 'trim';

/** A solid box. x/z are the CENTER of the box, y is the BOTTOM of the box. */
export interface BoxDef {
  x: number;
  y: number;
  z: number;
  /** Size along X. */
  w: number;
  /** Height (size along Y). */
  h: number;
  /** Size along Z. */
  d: number;
  material?: MaterialId;
}

/** Which way the ramp goes UP. */
export type RampDir = '+x' | '-x' | '+z' | '-z';

/**
 * A walkable slope. x/z are the center of its footprint, w/d its size.
 * The surface goes from `low` height to `high` height in direction `dir`.
 * The space under the slope (down to `base`, default 0) is solid.
 */
export interface RampDef {
  x: number;
  z: number;
  w: number;
  d: number;
  low: number;
  high: number;
  dir: RampDir;
  base?: number;
  material?: MaterialId;
}

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  /** Facing direction in degrees (0 = looking toward -Z). */
  yaw: number;
}

/** A practice dummy (for testing weapons). */
export interface PracticeTargetDef {
  x: number;
  y: number;
  z: number;
  /** Facing direction in degrees (0 = facing toward -Z). */
  yaw?: number;
  /** If set, slides this many meters left and right. */
  strafe?: number;
}

export type PickupType = 'health' | 'armor' | 'ammo';

/** A spot where a pickup appears (and reappears a while after being taken). */
export interface PickupDef {
  type: PickupType;
  x: number;
  y: number;
  z: number;
}

/**
 * A lamp fixture: a glowing light on a wall or ceiling. Its light is
 * "baked" into the map when it loads (free while playing).
 */
export interface LampDef {
  x: number;
  y: number;
  z: number;
  /** Light color, e.g. 0xffb060 for warm, 0xbfe0ff for cool. */
  color: number;
  /** Brightness (1 = normal). */
  intensity: number;
  /** How far the light reaches (meters). */
  range: number;
  /** Which way the fixture faces: the direction the light shines from the wall. */
  facing: '+x' | '-x' | '+z' | '-z' | 'down';
}

export interface MapDef {
  id: string;
  name: string;
  description: string;
  skyColor: number;
  fogNear: number;
  fogFar: number;
  boxes: BoxDef[];
  ramps: RampDef[];
  playerSpawns: SpawnPoint[];
  botSpawns: SpawnPoint[];
  pickups?: PickupDef[];
  lamps?: LampDef[];
  practiceTargets?: PracticeTargetDef[];
}
