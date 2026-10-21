/**
 * Maps are plain data. To add a new map, copy `maps/testRoom.ts`, change the
 * numbers, and register it in `maps/index.ts`.
 *
 * Coordinates: X = east/west, Z = north/south, Y = up. One unit = one meter.
 */

export type MaterialId =
  | 'floor' | 'wall' | 'concrete' | 'crate' | 'metal' | 'trim' | 'dirt' | 'container'
  // Indoors (office, museum...):
  | 'carpet' | 'tile' | 'drywall' | 'ceiling' | 'desk' | 'partition' | 'glass' | 'stairs'
  // Outdoors in town:
  | 'asphalt' | 'paint' | 'carpaint'
  // Museum and gardens:
  | 'marble' | 'stone' | 'grass' | 'hedge' | 'water' | 'art' | 'gold' | 'velvet';

/** The six sides of a box, for giving one side a different material. */
export type BoxFace = 'top' | 'bottom' | '-x' | '+x' | '-z' | '+z';

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
  /**
   * Different materials on some sides, e.g. an outer wall that's concrete
   * outside and painted inside: { material: 'concrete', faces: { '+z': 'drywall' } }.
   * Glass ('glass') blocks walking but bullets and eyesight pass through it.
   */
  faces?: Partial<Record<BoxFace, MaterialId>>;
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

/**
 * The sky and sunlight. Colors are hex (0xRRGGBB). The sun's position sets
 * where shadows fall: elevation 0 = on the horizon, 90 = straight up;
 * azimuth 0 = north (-Z), 90 = east (+X), 180 = south, 270 = west.
 */
export interface SkyDef {
  /** Sky color straight up, and at the horizon (also the color of the haze). */
  zenith: number;
  horizon: number;
  /** Optional color halfway up (e.g. for dusk: orange horizon, purple-blue middle, dark top). */
  mid?: number;
  /** Below the horizon (rarely seen). */
  ground?: number;
  sunColor: number;
  sunElevation: number;
  sunAzimuth: number;
  /** Strength of direct sunlight (default 2.4) and of light from the sky (default 1). */
  sunIntensity?: number;
  skyLight?: number;
  /** Cloud cover, 0 (clear) to 1 (overcast). */
  clouds?: number;
  cloudColor?: number;
  /** Distant buildings around the arena (default on), their color, and lit windows (for dusk). */
  skyline?: boolean;
  skylineColor?: number;
  litWindows?: boolean;
}

export interface MapDef {
  id: string;
  name: string;
  description: string;
  /** Plain sky color (used if `sky` isn't given). */
  skyColor: number;
  sky?: SkyDef;
  fogNear: number;
  fogFar: number;
  /**
   * Indoor shading (0..1): how much darker places get when they're enclosed
   * (rooms, under roofs). Use for maps with buildings you can enter.
   */
  indoorShading?: number;
  /** Floor heights of the levels (e.g. [0, 3.5]); the minimap shows the level you're on. */
  levels?: number[];
  /** Spacing of the bots' navigation grid (meters, default 1.25). Bigger = faster loading on huge maps. */
  navSpacing?: number;
  boxes: BoxDef[];
  ramps: RampDef[];
  playerSpawns: SpawnPoint[];
  botSpawns: SpawnPoint[];
  pickups?: PickupDef[];
  lamps?: LampDef[];
  practiceTargets?: PracticeTargetDef[];
}
