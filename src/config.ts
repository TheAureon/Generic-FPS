/**
 * ===========================================================================
 *  GAME CONFIG — all the tunable numbers live here.
 * ===========================================================================
 *  Change a number, save the file, and the browser reloads with the new value.
 *  Units: distances in meters, speeds in meters/second, times in seconds,
 *  angles in degrees (unless noted).
 */

export const CONFIG = {
  player: {
    /** Standing height (feet to top of head). */
    height: 1.8,
    /** Height while crouching. */
    crouchHeight: 1.1,
    /** How far below the top of the head the eyes (camera) sit. */
    eyeFromTop: 0.12,
    /** Body radius used for collisions with walls. */
    radius: 0.35,

    walkSpeed: 5.5,
    sprintSpeed: 8.5,
    crouchSpeed: 2.6,

    /** How quickly you reach full speed on the ground (higher = snappier). */
    groundAcceleration: 60,
    /** How much you can steer while in the air (lower = floatier jumps). */
    airAcceleration: 12,

    /** Upward speed when you jump. ~6.8 gives a jump of about 1.15 m. */
    jumpSpeed: 6.8,
    gravity: 20,

    /** Max height you can walk up without jumping (stairs, small ledges). */
    stepHeight: 0.45,
    /** How fast you crouch / stand up. */
    crouchTransitionSpeed: 10,

    maxHealth: 100,
    /** Most armor you can have. Armor soaks up part of each hit. */
    maxArmor: 100,
    startingArmor: 0,
    /** Fraction of damage armor absorbs (0.6 = armor takes 60%, health 40%). */
    armorAbsorption: 0.6,
    /** Seconds before you respawn after dying. */
    respawnDelay: 3,
  },

  camera: {
    /** Extra field of view (degrees) added while sprinting. */
    sprintFovBoost: 6,
    /** Head bob while walking (meters). Set to 0 to disable. */
    headBobAmount: 0.035,
    headBobFrequency: 1.9,
  },

  /** Defaults for the player-adjustable settings (saved in the browser). */
  defaultSettings: {
    mouseSensitivity: 1.0,
    fov: 80,
    masterVolume: 0.8,
  },

  /** Until the match menu exists (milestone 5), these set up the test match. */
  testMatch: {
    /** 'foundry' (the arena) or 'test-room'. */
    map: 'foundry',
    botCount: 4,
    difficulty: 'normal' as 'easy' | 'normal' | 'hard',
    /** true = everyone for themselves (bots fight each other too); false = all bots hunt only you. */
    freeForAll: true,
  },

  render: {
    /** Cap on screen resolution scaling (lower = faster on Retina screens). */
    maxPixelRatio: 2,
    shadows: true,
  },
};

export type GameConfig = typeof CONFIG;

/* ===========================================================================
 *  WEAPONS
 * ===========================================================================
 *  Spread and recoil are in degrees. "Spread" is how far (at most) a bullet
 *  can stray from the center of the crosshair.
 */
export interface WeaponStats {
  name: string;
  /** Number key that selects it. */
  slot: number;
  /** Damage per bullet (per pellet for the shotgun). */
  damage: number;
  /** Damage multiplier for headshots. */
  headshotMultiplier: number;
  /** Bullets per shot (shotgun pellets). */
  pellets: number;
  /** Shots per second. */
  fireRate: number;
  /** true = hold to keep firing; false = one shot per click. */
  automatic: boolean;
  magazineSize: number;
  /** Spare ammo you start with. */
  startingReserve: number;
  /** Most spare ammo you can carry. */
  maxReserve: number;
  /** Seconds for a full reload (or per shell for 'perShell'). */
  reloadTime: number;
  /** 'magazine' = swap the whole mag; 'perShell' = load one at a time (can interrupt by firing). */
  reloadStyle: 'magazine' | 'perShell';
  /** Max distance a bullet travels (meters). */
  range: number;
  /** Damage starts dropping after `falloffStart` meters, reaching `falloffMinMultiplier` at `falloffEnd`. */
  falloffStart: number;
  falloffEnd: number;
  falloffMinMultiplier: number;

  /** Spread when standing still, firing from the hip. */
  baseSpread: number;
  /** Extra spread added by each shot (recovers over time). */
  spreadPerShot: number;
  maxSpread: number;
  /** How fast the extra spread recovers (degrees per second). */
  spreadRecovery: number;
  /** Extra spread while moving at full speed / while in the air. */
  moveSpread: number;
  airSpread: number;
  /** Spread is multiplied by this while aiming down sights (right mouse). */
  aimSpreadMultiplier: number;

  /** How far the view kicks up per shot, and random sideways kick. */
  recoilPitch: number;
  recoilYaw: number;
  /** How fast the view returns after recoil (degrees per second). */
  recoilRecovery: number;

  /** Zoom while aiming (2 = twice as zoomed in). */
  aimZoom: number;
  /** Shows a sniper scope overlay when aiming. */
  scope: boolean;
  /** Seconds to switch to this weapon. */
  equipTime: number;
  /** How loud the shot is to bots (meters they can hear it from). */
  hearingRange: number;
}

export const WEAPONS = {
  pistol: {
    name: 'Pistol', slot: 1,
    damage: 26, headshotMultiplier: 2, pellets: 1,
    fireRate: 6.5, automatic: false,
    magazineSize: 12, startingReserve: 60, maxReserve: 96,
    reloadTime: 1.3, reloadStyle: 'magazine',
    range: 150, falloffStart: 25, falloffEnd: 60, falloffMinMultiplier: 0.6,
    baseSpread: 0.35, spreadPerShot: 0.9, maxSpread: 3.5, spreadRecovery: 6,
    moveSpread: 1.2, airSpread: 3, aimSpreadMultiplier: 0.5,
    recoilPitch: 1.6, recoilYaw: 0.5, recoilRecovery: 9,
    aimZoom: 1.25, scope: false, equipTime: 0.3, hearingRange: 40,
  },
  rifle: {
    name: 'Assault Rifle', slot: 2,
    damage: 21, headshotMultiplier: 2, pellets: 1,
    fireRate: 10, automatic: true,
    magazineSize: 30, startingReserve: 120, maxReserve: 210,
    reloadTime: 2.1, reloadStyle: 'magazine',
    range: 150, falloffStart: 35, falloffEnd: 80, falloffMinMultiplier: 0.7,
    baseSpread: 0.45, spreadPerShot: 0.32, maxSpread: 4, spreadRecovery: 5,
    moveSpread: 1.8, airSpread: 4, aimSpreadMultiplier: 0.45,
    recoilPitch: 0.95, recoilYaw: 0.45, recoilRecovery: 6,
    aimZoom: 1.4, scope: false, equipTime: 0.45, hearingRange: 50,
  },
  shotgun: {
    name: 'Shotgun', slot: 3,
    damage: 12, headshotMultiplier: 1.5, pellets: 9,
    fireRate: 1.15, automatic: false,
    magazineSize: 6, startingReserve: 30, maxReserve: 40,
    reloadTime: 0.55, reloadStyle: 'perShell',
    range: 60, falloffStart: 8, falloffEnd: 25, falloffMinMultiplier: 0.25,
    baseSpread: 5, spreadPerShot: 0, maxSpread: 5, spreadRecovery: 10,
    moveSpread: 0.5, airSpread: 1, aimSpreadMultiplier: 0.8,
    recoilPitch: 5, recoilYaw: 1.2, recoilRecovery: 12,
    aimZoom: 1.15, scope: false, equipTime: 0.5, hearingRange: 55,
  },
  sniper: {
    name: 'Sniper Rifle', slot: 4,
    damage: 90, headshotMultiplier: 2.5, pellets: 1,
    fireRate: 0.75, automatic: false,
    magazineSize: 5, startingReserve: 20, maxReserve: 30,
    reloadTime: 2.6, reloadStyle: 'magazine',
    range: 400, falloffStart: 400, falloffEnd: 400, falloffMinMultiplier: 1,
    baseSpread: 4, spreadPerShot: 0, maxSpread: 4, spreadRecovery: 10,
    moveSpread: 3, airSpread: 6, aimSpreadMultiplier: 0,
    recoilPitch: 6, recoilYaw: 1, recoilRecovery: 8,
    aimZoom: 4, scope: true, equipTime: 0.6, hearingRange: 70,
  },
} satisfies Record<string, WeaponStats>;

export type WeaponId = keyof typeof WEAPONS;

export const COMBAT = {
  /** Movement speed multiplier while aiming down sights. */
  aimMoveSpeedMultiplier: 0.6,
  /** How quickly you go in/out of aim-down-sights (per second). */
  aimSpeed: 8,
  /** Spread multiplier while crouching. */
  crouchSpreadMultiplier: 0.7,
  /** Can't sprint for this long after firing. */
  sprintBlockAfterShot: 0.35,
};

/* ===========================================================================
 *  BOTS
 * =========================================================================== */
export const BOTS = {
  height: 1.8,
  radius: 0.3,
  /** Height of the eyes (where they look and shoot from). */
  eyeHeight: 1.65,
  walkSpeed: 3.6,
  runSpeed: 5.2,
  acceleration: 30,
  maxHealth: 100,
  /** Seconds before a dead bot comes back. */
  respawnDelay: 4,
  /** The gun bots carry. One of: pistol, rifle, shotgun, sniper. */
  weapon: 'rifle' as WeaponId,

  /** How far bots can see (meters). */
  visionRange: 60,
  /** Width of their view cone (degrees). Outside this they can't see you... */
  fieldOfView: 120,
  /** ...unless you're this close (they "sense" you). */
  closeAwarenessRange: 2.5,
  /** Hearing range is each gun's `hearingRange` times this. */
  hearingMultiplier: 1,
  /** How long they remember where they last saw you (seconds). */
  memoryTime: 8,

  /** Distance they like to fight at (meters). */
  preferredRange: 14,
  /** Bots back off if you get closer than this. */
  minRange: 5,

  /** Names given to bots. */
  names: ['Viper', 'Ghost', 'Hammer', 'Rook', 'Blaze', 'Echo', 'Nova', 'Tank', 'Jinx', 'Raven', 'Moss', 'Flint'],
};

export type Difficulty = 'easy' | 'normal' | 'hard';

/**
 * Difficulty levels. Aim error is in degrees: the bigger it is, the more
 * they miss. It grows with distance and when you or the bot is moving.
 */
export const BOT_DIFFICULTY: Record<Difficulty, {
  /** Seconds between first seeing you and starting to shoot. */
  reactionTime: number;
  /** Base aim error (degrees). */
  aimError: number;
  /** How fast they can turn to face you (degrees per second). */
  turnSpeed: number;
  /** Extra aim error when you're moving at full speed (1 = doubles it). */
  movingTargetPenalty: number;
  /** Extra aim error while the bot itself is moving. */
  selfMovingPenalty: number;
  /** Shots per burst (min, max), and pause between bursts in seconds (min, max). */
  burstSize: [number, number];
  burstPause: [number, number];
  /** 0..1: how eager they are to push toward you rather than hang back. */
  aggression: number;
  /** Multiplies the damage of bot bullets. */
  damageMultiplier: number;
}> = {
  easy: {
    reactionTime: 0.8, aimError: 4.5, turnSpeed: 150,
    movingTargetPenalty: 1.2, selfMovingPenalty: 0.8,
    burstSize: [2, 4], burstPause: [0.7, 1.4],
    aggression: 0.3, damageMultiplier: 0.6,
  },
  normal: {
    reactionTime: 0.45, aimError: 2.6, turnSpeed: 240,
    movingTargetPenalty: 1.0, selfMovingPenalty: 0.6,
    burstSize: [3, 6], burstPause: [0.4, 0.9],
    aggression: 0.6, damageMultiplier: 0.85,
  },
  hard: {
    reactionTime: 0.25, aimError: 1.9, turnSpeed: 400,
    movingTargetPenalty: 1.1, selfMovingPenalty: 0.4,
    burstSize: [4, 8], burstPause: [0.25, 0.55],
    aggression: 0.9, damageMultiplier: 1,
  },
};
