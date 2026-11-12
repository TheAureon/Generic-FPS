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

    /** Slide: press C while sprinting. Starting speed, how long it lasts (seconds), and the wait before the next one. */
    slideSpeed: 12,
    slideTime: 0.8,
    slideCooldown: 0.4,
    /**
     * Mantle: press Space (or keep holding forward in the air) against a ledge
     * up to this high (meters above your feet) to climb onto it. Takes `mantleTime` seconds.
     */
    mantleHeight: 1.7,
    mantleTime: 0.38,

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
    /** Strongest screen shake (degrees). Set to 0 to turn shake off entirely. */
    maxShake: 2.2,
    /** Shake from your own shots (times the gun's recoil). */
    shakePerShot: 0.05,
    /** Shake from getting hit (per point of damage). */
    shakePerDamage: 0.012,
  },

  /** Defaults for the player-adjustable settings (saved in the browser). */
  defaultSettings: {
    mouseSensitivity: 1.0,
    fov: 80,
    masterVolume: 0.8,
    /** Music volume (0 = off). */
    musicVolume: 0.4,
    /** Music style: 'synth' or 'cinematic'. */
    musicStyle: 'synth' as 'synth' | 'cinematic',
    /** Music during matches (off: just the game's sounds while you play). */
    matchMusic: false,
    screenShake: true,
    /** Aim / scope with both the right mouse button and Q ('both'), or only one ('mouse' / 'q'). */
    aimKey: 'both' as 'both' | 'mouse' | 'q',
    /** HUD size: 1 = full size, down to 0.6. The crosshair always stays the same. */
    hudScale: 1,
    quality: 'high' as 'low' | 'medium' | 'high',
  },

  /**
   * Graphics quality presets (picked in Settings). Lower = smoother on
   * slower computers. pixelRatio caps the resolution on Retina screens.
   */
  quality: {
    // pixelRatio: resolution cap (Retina screens); shadowMapSize: shadow sharpness;
    // softShadows: blurred shadow edges; materials: 'lambert' is cheaper, 'standard'
    // looks better (reflections); envMap: subtle reflections of the sky;
    // bloom: glow around bright things (visors, lamps, muzzle flashes);
    // mapDetail: real 3D bricks and concrete panels on walls (Low uses flat textures);
    // grade: color grading and vignette; ao: ambient occlusion (soft shading where things meet);
    // foliage: leafy trees and grass tufts (only together with mapDetail).
    low: { pixelRatio: 1, mapDetail: false, shadows: false, shadowMapSize: 1024, softShadows: false, materials: 'lambert', envMap: false, bloom: false, grade: false, ao: false, foliage: false },
    medium: { pixelRatio: 1.5, mapDetail: true, shadows: true, shadowMapSize: 2048, softShadows: false, materials: 'standard', envMap: true, bloom: false, grade: true, ao: false, foliage: true },
    high: { pixelRatio: 2, mapDetail: true, shadows: true, shadowMapSize: 4096, softShadows: true, materials: 'standard', envMap: true, bloom: true, grade: true, ao: true, foliage: true },
  } as Record<'low' | 'medium' | 'high', {
    pixelRatio: number; mapDetail: boolean; shadows: boolean; shadowMapSize: number; softShadows: boolean;
    materials: 'lambert' | 'standard'; envMap: boolean; bloom: boolean; grade: boolean; ao: boolean; foliage: boolean;
  }>,

  render: {
    /** Shadows are switched on per quality preset; this is the master switch. */
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
  /** Walking speed while holding it (1 = normal; heavy guns slow you down). */
  moveSpeed?: number;
}

export const WEAPONS = {
  pistol: {
    name: 'Pistol', slot: 1,
    damage: 26, headshotMultiplier: 2, pellets: 1,
    fireRate: 6.5, automatic: false,
    magazineSize: 12, startingReserve: 60, maxReserve: 96,
    reloadTime: 1.04, reloadStyle: 'magazine',
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
    reloadTime: 1.68, reloadStyle: 'magazine',
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
    reloadTime: 0.44, reloadStyle: 'perShell',
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
    reloadTime: 2.08, reloadStyle: 'magazine',
    range: 400, falloffStart: 400, falloffEnd: 400, falloffMinMultiplier: 1,
    baseSpread: 4, spreadPerShot: 0, maxSpread: 4, spreadRecovery: 10,
    moveSpread: 3, airSpread: 6, aimSpreadMultiplier: 0,
    recoilPitch: 6, recoilYaw: 1, recoilRecovery: 8,
    aimZoom: 4, scope: true, equipTime: 0.6, hearingRange: 70,
  },
  smg: {
    // Fast and light: shreds up close, loses punch at range, accurate on the move.
    name: 'SMG', slot: 5,
    damage: 15, headshotMultiplier: 1.8, pellets: 1,
    fireRate: 14, automatic: true,
    magazineSize: 32, startingReserve: 160, maxReserve: 256,
    reloadTime: 1.45, reloadStyle: 'magazine',
    range: 100, falloffStart: 14, falloffEnd: 40, falloffMinMultiplier: 0.55,
    baseSpread: 0.6, spreadPerShot: 0.22, maxSpread: 4.5, spreadRecovery: 7,
    moveSpread: 0.7, airSpread: 2.5, aimSpreadMultiplier: 0.55,
    recoilPitch: 0.55, recoilYaw: 0.55, recoilRecovery: 8,
    aimZoom: 1.3, scope: false, equipTime: 0.3, hearingRange: 40, moveSpeed: 1.05,
  },
  lmg: {
    // A huge box magazine for holding a lane. Heavy: slow to raise, reload and walk with.
    name: 'LMG', slot: 6,
    damage: 23, headshotMultiplier: 2, pellets: 1,
    fireRate: 11, automatic: true,
    magazineSize: 100, startingReserve: 200, maxReserve: 300,
    reloadTime: 3.6, reloadStyle: 'magazine',
    range: 150, falloffStart: 35, falloffEnd: 85, falloffMinMultiplier: 0.7,
    baseSpread: 0.8, spreadPerShot: 0.2, maxSpread: 5, spreadRecovery: 4,
    moveSpread: 2.6, airSpread: 5, aimSpreadMultiplier: 0.4,
    recoilPitch: 1.05, recoilYaw: 0.6, recoilRecovery: 5,
    aimZoom: 1.35, scope: false, equipTime: 0.8, hearingRange: 60, moveSpeed: 0.85,
  },
} satisfies Record<string, WeaponStats>;

export type WeaponId = keyof typeof WEAPONS;
/** What dealt damage: a gun, a grenade, or the Battle Royale zone. */
export type DamageSource = WeaponId | 'grenade' | 'zone' | 'claws' | 'katana';

/** The katana (V to slash): a quick melee attack, any time, without switching away from your gun. */
export const MELEE = {
  /** Damage of one slash (100 = a full-health bot; Juggernauts and zombies take more). */
  damage: 150,
  /** How far it reaches (meters, from your eyes to the edge of their body). */
  range: 2.6,
  /** It still connects if they're this far off your crosshair (degrees): you don't have to aim exactly. */
  assistAngle: 35,
  /** Seconds from pressing V until the blade hits. */
  hitAt: 0.13,
  /** Seconds the whole slash takes (you can't shoot until it's over). */
  swingTime: 0.5,
  /** Rest between slashes (seconds, counted after a slash ends). */
  cooldown: 0.12,
};

/** Frag grenades (G to throw). */
export const GRENADES = {
  /** How many you start (and respawn) with, and the most you can carry. */
  start: 2,
  max: 4,
  /** Grenades an ammo pickup gives. */
  fromAmmoPickup: 1,
  /** Seconds from the throw to the bang. */
  fuse: 2.2,
  /** Pull of gravity on a grenade in flight (m/s²; higher = shorter lobs). */
  gravity: 16,
  /** Throw speed (m/s) and extra upward lift. */
  throwSpeed: 15,
  throwLift: 3.5,
  /** Damage at the center, out to `fullRadius` meters, falling to 0 at `radius`. */
  damage: 130,
  fullRadius: 1.5,
  radius: 7,
  /** Your own grenades hurt you this much (0..1). */
  selfDamage: 0.5,
  /** Seconds between throws. */
  cooldown: 0.9,
  /** How far away bots hear the bang (meters). */
  hearingRange: 90,
};

/**
 * Fitting custom 3D gun models (files in src/assets/models/weapons/, see the
 * README there). Only used for guns that have a model file. Adjust these if
 * a model comes out too big, too small, or turned the wrong way.
 * - scale: size multiplier (1 = as exported, in meters)
 * - position: shift in meters [x right, y up, z back]
 * - rotation: turn in degrees [x, y, z] (the gun should point down -Z, i.e. away from you)
 */
export const WEAPON_MODELS: Record<WeaponId, { scale: number; position: [number, number, number]; rotation: [number, number, number] }> = {
  pistol: { scale: 1, position: [0, 0, 0], rotation: [0, 0, 0] },
  rifle: { scale: 1, position: [0, 0, 0], rotation: [0, 0, 0] },
  shotgun: { scale: 1, position: [0, 0, 0], rotation: [0, 0, 0] },
  sniper: { scale: 1, position: [0, 0, 0], rotation: [0, 0, 0] },
  smg: { scale: 1, position: [0, 0, 0], rotation: [0, 0, 0] },
  lmg: { scale: 1, position: [0, 0, 0], rotation: [0, 0, 0] },
};

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
  /**
   * The guns bots carry: each bot gets one of these (repeat one to make it
   * more common). Any of: pistol, rifle, shotgun, sniper, smg, lmg.
   */
  weapons: ['rifle', 'rifle', 'smg', 'lmg'] as WeaponId[],

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

export type Difficulty = 'novice' | 'beginner' | 'easy' | 'medium' | 'advanced' | 'hard' | 'master' | 'insane';

/** The difficulty levels in order (easiest first), with their names and a short description for the menu. */
export const DIFFICULTIES: { id: Difficulty; name: string; info: string }[] = [
  { id: 'novice', name: 'Novice', info: 'Bots are very slow to react, miss a lot, rarely push, and hit softly.' },
  { id: 'beginner', name: 'Beginner', info: 'Bots react slowly, miss often, and hold back.' },
  { id: 'easy', name: 'Easy', info: 'Bots are a little slow and inaccurate, and fairly cautious.' },
  { id: 'medium', name: 'Medium', info: 'A fair fight: decent aim and reactions, and they will push you.' },
  { id: 'advanced', name: 'Advanced', info: 'Quick reactions and good aim; bots play aggressively.' },
  { id: 'hard', name: 'Hard', info: 'Fast, accurate and aggressive. Keep moving and use cover.' },
  { id: 'master', name: 'Master', info: 'Near-instant reactions, tight aim, relentless. Same damage as you.' },
  { id: 'insane', name: 'Insane', info: 'Not meant to be fair: instant reactions, aim for your head, see almost all around them, never forget you, and hit 40% harder than you.' },
];

/**
 * Difficulty levels. Aim error is in degrees: the bigger it is, the more
 * they miss. It grows with distance and when you or the bot is moving.
 * Bots never get more health, speed or ammo than you on any level; only
 * their reactions, aim, firing rhythm, aggression and damage change. Damage
 * tops out at the same as yours, except on Insane, which is meant to be
 * unfair (it also uses the optional extras at the bottom of the list).
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
  /** Optional extras (used by Insane): */
  /** 0..1: how far up from the chest toward the head they aim (1 = right at the head). */
  headAim?: number;
  /** Extra aim error in the first moments of a fight, before they settle (normally 0.8 = +80%). */
  settle?: number;
  /** Width of their view cone (degrees; normally BOTS.fieldOfView). */
  fieldOfView?: number;
  /** How long they remember where you were (seconds; normally BOTS.memoryTime). */
  memory?: number;
}> = {
  novice: {
    reactionTime: 1.4, aimError: 8, turnSpeed: 90,
    movingTargetPenalty: 1.5, selfMovingPenalty: 1.0,
    burstSize: [1, 3], burstPause: [1.2, 2.2],
    aggression: 0.1, damageMultiplier: 0.35,
  },
  beginner: {
    reactionTime: 1.1, aimError: 6, turnSpeed: 115,
    movingTargetPenalty: 1.35, selfMovingPenalty: 0.9,
    burstSize: [2, 3], burstPause: [1.0, 1.8],
    aggression: 0.2, damageMultiplier: 0.45,
  },
  easy: {
    reactionTime: 0.8, aimError: 4.5, turnSpeed: 150,
    movingTargetPenalty: 1.2, selfMovingPenalty: 0.8,
    burstSize: [2, 4], burstPause: [0.7, 1.4],
    aggression: 0.3, damageMultiplier: 0.6,
  },
  medium: {
    reactionTime: 0.45, aimError: 2.6, turnSpeed: 240,
    movingTargetPenalty: 1.0, selfMovingPenalty: 0.6,
    burstSize: [3, 6], burstPause: [0.4, 0.9],
    aggression: 0.6, damageMultiplier: 0.85,
  },
  advanced: {
    reactionTime: 0.33, aimError: 2.2, turnSpeed: 320,
    movingTargetPenalty: 1.05, selfMovingPenalty: 0.5,
    burstSize: [3, 7], burstPause: [0.3, 0.7],
    aggression: 0.75, damageMultiplier: 0.95,
  },
  hard: {
    reactionTime: 0.25, aimError: 1.9, turnSpeed: 400,
    movingTargetPenalty: 1.1, selfMovingPenalty: 0.4,
    burstSize: [4, 8], burstPause: [0.25, 0.55],
    aggression: 0.9, damageMultiplier: 1,
  },
  master: {
    reactionTime: 0.15, aimError: 1.3, turnSpeed: 560,
    movingTargetPenalty: 0.9, selfMovingPenalty: 0.3,
    burstSize: [5, 10], burstPause: [0.15, 0.4],
    aggression: 1, damageMultiplier: 1,
  },
  insane: {
    reactionTime: 0.05, aimError: 0.5, turnSpeed: 1100,
    movingTargetPenalty: 0.3, selfMovingPenalty: 0.1,
    burstSize: [12, 25], burstPause: [0.05, 0.15],
    aggression: 1, damageMultiplier: 1.4,
    headAim: 0.75, settle: 0.1, fieldOfView: 300, memory: 30,
  },
};

/* ===========================================================================
 *  MATCHES
 * =========================================================================== */
export const MATCH = {
  /** What the match menu starts with (your last choices are remembered after that). */
  defaultMode: 'deathmatch' as import('./modes/GameMode').ModeId,
  defaultMap: 'foundry',
  defaultDifficulty: 'medium' as Difficulty,
  defaultBotCount: 4,
  /** Bot count choices in the menu. */
  minBots: 1,
  maxBots: 10,

  /** Free for All: kills needed to win (menu choices). Every mode ends at the time limit. */
  killLimits: [10, 20, 30],
  defaultKillLimit: 20,
  timeLimitMinutes: 10,
};

/** Team modes: you're always on Blue. */
export const TEAMS = {
  names: ['Blue', 'Red'],
  /** Uniform accent colors (3D) and text colors (HUD). */
  colors: [0x2f78d6, 0xc8402f],
  css: ['#5aa6ff', '#ff6152'],
};

/**
 * Settings for each game mode. `limits` are the choices in the match menu
 * (what it takes to win), `defaultLimit` the starting choice. Every mode
 * also ends at MATCH.timeLimitMinutes (most points wins).
 */
export const MODES = {
  /** Team Deathmatch: team kills to win. */
  tdm: { limits: [25, 50, 75], defaultLimit: 50 },
  /** King of the Hill: seconds in the hill (alone) to win. The hill moves every `moveEvery` seconds. */
  koh: { limits: [30, 60, 90], defaultLimit: 60, hillRadius: 5, moveEvery: 60 },
  /** Court of the Hill (teams): team seconds in the hill to win. */
  coh: { limits: [60, 100, 150], defaultLimit: 100, hillRadius: 5, moveEvery: 60 },
  /** Capture the Flag: captures to win; a dropped flag goes home after `returnTime` seconds. */
  ctf: { limits: [1, 3, 5], defaultLimit: 3, returnTime: 20, touchRadius: 1.5 },
  /** Control: points to win (each zone your team holds scores 1 point a second); seconds for one player to capture. */
  control: { limits: [150, 250, 400], defaultLimit: 250, zoneRadius: 5, captureTime: 8 },
  /**
   * Battle Royale: one life each, last one standing wins. A safe zone shrinks
   * in stages (wait, then shrink); outside it you lose health every second.
   */
  br: {
    stages: [
      { wait: 40, shrink: 30, size: 0.6, damage: 3 },
      { wait: 30, shrink: 25, size: 0.35, damage: 5 },
      { wait: 25, shrink: 20, size: 0.15, damage: 8 },
      { wait: 20, shrink: 20, size: 0.03, damage: 12 },
    ],
  },
};

/* Party modes. */
export const PARTY_MODES = {
  /**
   * Gun Game: every kill (`limit` kills per gun) moves you to the next gun on
   * the ladder; a kill with the last one wins. Killed by a grenade (or your
   * own): back one gun.
   */
  gungame: { limits: [1, 2, 3], defaultLimit: 2, ladder: ['smg', 'rifle', 'shotgun', 'lmg', 'sniper', 'pistol'] as WeaponId[] },
  /** Kill Confirmed: a kill only scores when someone picks up the dog tag it drops. Tags vanish after `tagLife` seconds. */
  killconfirmed: { limits: [20, 35, 50], defaultLimit: 35, tagLife: 30, touchRadius: 1.6 },
  /** Infected: minutes the survivors must last. The infected move faster and carry a shotgun. */
  infected: { limits: [2, 3, 5], defaultLimit: 3, infectedSpeed: 1.15 },
  /** One in the Chamber: lives each. A pistol with one bullet; every hit kills; a kill gives the bullet back. */
  oitc: { limits: [3, 5, 7], defaultLimit: 3 },
  /** Headhunter: headshot kills to win (only headshots score). */
  headhunter: { limits: [10, 15, 25], defaultLimit: 15 },
  /** Juggernaut: seconds as the Juggernaut to win. It takes `armor` of normal damage and moves at `speed`. */
  juggernaut: { limits: [60, 90, 150], defaultLimit: 90, armor: 0.3, speed: 0.85 },
  /**
   * Hardpoint (teams): one zone at a time, moving every `moveEvery` seconds
   * (the next spot shows `warn` seconds early). Capture it (`captureTime`
   * seconds); your team scores a point a second while no enemy is in it.
   */
  hardpoint: { limits: [100, 150, 250], defaultLimit: 150, zoneRadius: 4.5, captureTime: 5, moveEvery: 60, warn: 10 },
  /**
   * Search & Destroy (teams, rounds, one life each): attackers plant the bomb
   * at A or B (stand in the site `plantTime` s); it goes off after `bombTime`
   * s unless defused (`defuseTime` s). Sides swap every round.
   */
  snd: { limits: [3, 4, 6], defaultLimit: 4, roundTime: 100, plantTime: 4, bombTime: 30, defuseTime: 6, siteRadius: 3, intermission: 5, blastRadius: 14 },
  /**
   * Escort (teams): your team pushes a cart from your side to theirs before
   * time (minutes) runs out. It moves while your team is near it and theirs
   * isn't; checkpoints add time.
   */
  escort: { limits: [2, 3, 4], defaultLimit: 3, pushRadius: 4.5, speed: [0, 0.55, 0.75, 0.9], rollback: 0.25, rollbackAfter: 8, checkpointBonus: 45 },
  /**
   * Prop Hunt: two rounds. First you hide as a prop while the bots seek; then
   * the bots hide as props and you seek. `hideTime` s to hide, `roundTime` s per round.
   */
  prophunt: { hideTime: 20, roundTime: 120, decoys: 28 },
  /**
   * Zombies (co-op): endless waves of zombies against you and two bot allies.
   * Kills and hits earn points to buy guns and perks at stations (press F).
   */
  zombies: {
    allies: 2,
    extraPerWave: 2,
    /** Most zombies on the map at once (more come as these die). */
    maxAlive: 14,
    intermission: 8,
    points: { kill: 60, headshot: 40, hit: 10 },
    /** Gun stations: price to buy (buying a gun you have refills its ammo for half). */
    guns: { smg: 500, shotgun: 750, rifle: 1000, sniper: 1250, lmg: 1500 } as Partial<Record<WeaponId, number>>,
    /** Perk stations: price and what it does. */
    perks: {
      tough: { name: 'Tough Skin', price: 2000, info: 'take 35% less damage', color: 0xd83a3a },
      quick: { name: 'Quick Feet', price: 1500, info: 'move 12% faster', color: 0x3ad86a },
      doubletap: { name: 'Double Tap', price: 2500, info: 'deal 40% more damage', color: 0xe0a030 },
    },
  },
  /** Arena Ladder: 1v1 duels against ever tougher bots. `limit` kills win a duel. */
  ladder: { limits: [3, 5, 7], defaultLimit: 3 },
};

export const SURVIVAL = {
  /** Wave 1 has the bot count chosen in the menu; each wave adds this many more. */
  extraBotsPerWave: 1,
  maxBots: 12,
  /** Seconds of calm between waves. */
  intermission: 6,
  /** Health you get back when you clear a wave. */
  healOnWaveClear: 30,
  /** Bots get tougher each wave, reaching full strength at this wave. */
  wavesToFullStrength: 6,
};

/* ===========================================================================
 *  PICKUPS
 * =========================================================================== */
export const PICKUPS = {
  health: { amount: 35, respawnTime: 20 },
  armor: { amount: 50, respawnTime: 30 },
  /** Ammo gives this many spare magazines to every weapon. */
  ammo: { magazines: 2, respawnTime: 20 },
  /** How close you need to be to grab one (meters). */
  radius: 1.1,
};

/* ===========================================================================
 *  REWARDS — score, medals, streaks, XP and levels
 * =========================================================================== */
export const REWARDS = {
  /** Points (and XP) for each kill, and the bonuses on top. */
  points: {
    kill: 100,
    headshot: 50,
    longshot: 50,
    pointBlank: 25,
    closeCall: 50,
    revenge: 50,
    firstBlood: 75,
    comeback: 75,
    buzzkill: 100,
    collateral: 100,
    avenger: 50,
    grenadeKill: 50,
    /** Bonus for a katana kill. */
    katanaKill: 50,
    /** Survival: clearing wave 5, 10, 15 and 20. */
    survivalWave: { 5: 250, 10: 500, 15: 1000, 20: 2000 } as Record<number, number>,
    /** Multikills: double, triple, quad, and 5 or more. */
    multikill: [0, 0, 100, 200, 350, 500],
    /** Kill streaks (without dying) and their bonuses. */
    streak: { 3: 100, 5: 200, 8: 350, 12: 500, 16: 750 } as Record<number, number>,
    /** For winning, and for playing a match to the end. */
    win: 500,
    finish: 200,
  },
  /** Kills this close together (seconds) count as a multikill. */
  multikillWindow: 4.5,
  /** Distances (meters) for a longshot and a point-blank kill. */
  longshotDistance: 35,
  pointBlankDistance: 3.5,
  /** Health at or below this when you get a kill = close call. */
  closeCallHealth: 25,
  /**
   * XP is multiplied by this for the difficulty you played on: none on
   * Novice and Beginner, more the harder the bots. A difficulty set to 0
   * is practice: its matches don't count toward career stats either.
   */
  xpMultiplier: { novice: 0, beginner: 0, easy: 1, medium: 1.25, advanced: 1.5, hard: 2, master: 3, insane: 5 } as Record<Difficulty, number>,
  /** Level where you can prestige (start over at level 1 for a prestige star), and the most prestiges. */
  prestigeLevel: 50,
  maxPrestige: 10,
  /** XP needed for the first level-up; each level after needs `perLevel` more. */
  levelBaseXp: 1000,
  perLevel: 250,
};

/* ===========================================================================
 *  DAILY CHALLENGES
 * =========================================================================== */
export const CHALLENGES = {
  /** Bonus XP for completing an easy, medium and hard challenge. */
  xp: [400, 800, 1500] as [number, number, number],
  /** Bonus XP for completing an easy, medium and hard weekly challenge. */
  weeklyXp: [2500, 4000, 6000] as [number, number, number],
};
