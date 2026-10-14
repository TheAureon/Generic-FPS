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

  render: {
    /** Cap on screen resolution scaling (lower = faster on Retina screens). */
    maxPixelRatio: 2,
    shadows: true,
  },
};

export type GameConfig = typeof CONFIG;
