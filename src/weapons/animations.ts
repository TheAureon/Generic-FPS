import * as THREE from 'three';
import type { WeaponId } from '../config';

/**
 * ALL first-person gun animation settings in one place: where the gun sits,
 * where the hands hold it, and the timing of reloads, the shotgun pump, the
 * sniper bolt and the pistol slide. Change numbers here to rework an
 * animation; the code in Viewmodel.ts / ViewmodelArms.ts just plays them.
 *
 * Units: meters and seconds (reload keyframes are fractions 0..1 of the
 * weapon's reload time, so they stretch with it). Gun coordinates: the gun
 * points down -Z, +Y is up, +X is to the right.
 *
 * If a custom gun model (see src/assets/models/README.md) contains marker
 * objects ('sight', 'grip_right', 'grip_left', 'grip_reload', 'grip_slide',
 * 'eject'), those replace the matching numbers below for that gun.
 */

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ---- Where the gun sits -----------------------------------------------------------

/** Gun position when not aiming (camera coordinates). */
export const HIP_POSE = v(0.14, -0.12, -0.43);

/** Gun position when aiming down sights, so the sights line up with the screen center. */
export const AIM_POSE: Record<WeaponId, THREE.Vector3> = {
  pistol: v(0, -0.053, -0.27),
  rifle: v(0, -0.0775, -0.24),
  shotgun: v(0, -0.041, -0.38),
  sniper: v(0, -0.085, -0.12),
};

/** With a custom model's 'sight' marker: how far in front of your eye the sight sits when aiming. */
export const SIGHT_DISTANCE = 0.2;

/** Where spent shells pop out (gun coordinates). */
export const EJECT_PORT: Record<WeaponId, THREE.Vector3> = {
  pistol: v(0.02, 0.045, -0.03),
  rifle: v(0.03, 0.025, -0.03),
  shotgun: v(0.03, 0.02, 0.0),
  sniper: v(0.03, 0.025, 0.06),
};

// ---- Hands -------------------------------------------------------------------------

export interface HandPoints {
  /** Right hand on the grip, left hand on the front (gun coordinates). */
  right: THREE.Vector3;
  left: THREE.Vector3;
  /** Where the left hand grabs the magazine / pushes shells in. */
  reload: THREE.Vector3;
  /** Pistol: where the left hand grabs the back of the slide. */
  slide?: THREE.Vector3;
}

export const HANDS: Record<WeaponId, HandPoints> = {
  pistol: { right: v(0, -0.055, 0.05), left: v(-0.03, -0.07, 0.03), reload: v(0, -0.125, 0.06), slide: v(-0.03, 0.035, 0.075) },
  rifle: { right: v(0, -0.08, 0.1), left: v(0, -0.045, -0.25), reload: v(0, -0.15, -0.075) },
  shotgun: { right: v(0, -0.08, 0.1), left: v(0, -0.05, -0.3), reload: v(0, -0.05, -0.06) },
  sniper: { right: v(0, -0.085, 0.12), left: v(0, -0.03, -0.2), reload: v(0, -0.09, -0.03) },
};

/** Where each elbow is relative to its hand (camera coordinates): arms come from the lower corners. */
export const ELBOWS = {
  right: v(0.15, -0.13, 0.26),
  left: v(-0.17, -0.17, 0.22),
  /** Left arm while racking the pistol slide: out to the side, so it doesn't cover the gun. */
  leftRacking: v(-0.3, -0.1, 0.12),
};

// ---- Reloads -----------------------------------------------------------------------

/**
 * Named spots the left hand moves between during a reload:
 * - grip: its normal place on the gun
 * - reload: the magazine (or the shotgun's loading port)
 * - below / tap / away: offsets from 'reload' (see SPOT_OFFSETS)
 * - slide / slideBack / slideOff: the pistol slide grab, pulled back, let go
 */
export type Spot = 'grip' | 'reload' | 'below' | 'tap' | 'away' | 'slide' | 'slideBack' | 'slideOff';
/** [time 0..1, spot] pairs; the hand glides smoothly from one to the next. */
export type KeyTable = [number, Spot][];

/** Offsets from the 'reload' spot (camera coordinates, except slideOff). */
export const SPOT_OFFSETS = {
  /** Just under the magazine well, lining up the new magazine. */
  below: v(0, -0.06, 0.01),
  /** Slapping the magazine home. */
  tap: v(0, 0.015, 0),
  /** Down and out of view (to drop the old magazine / fetch a new one or a shell). */
  away: v(-0.06, -0.32, 0.08),
  /** Letting go of the pistol slide: the hand flicks up and back (gun coordinates). */
  slideOff: v(-0.05, 0.015, 0.07),
};

export interface ReloadAnim {
  keys: KeyTable;
  /** While the hand holds the magazine (it travels with the hand), as [from, to]. */
  holdMag?: [number, number];
  /** While the hand holds a shell (shotgun), as [from, to]. */
  holdShell?: [number, number];
  /** When the magazine seats (a little jolt of the gun). */
  seatAt?: number;
  /** How much the gun tilts to show the magazine well (1 = full). */
  tilt: number;
  /** Pistol slide rack. */
  slide?: {
    /** Grab → pulled all the way back → snaps forward over `snap`. */
    grab: number;
    release: number;
    snap: number;
    /** How far the slide moves back (m). */
    travel: number;
    /** The gun turns side-on from poseIn[0]..[1] and back over poseOut[0]..[1]. */
    poseIn: [number, number];
    poseOut: [number, number];
  };
}

const MAGAZINE: KeyTable = [
  [0, 'grip'],
  [0.16, 'reload'],
  [0.24, 'reload'], // grab the magazine
  [0.42, 'away'], // pull it out and drop it out of view
  [0.55, 'away'], // (grab a fresh one)
  [0.7, 'below'],
  [0.76, 'reload'], // push it in
  [0.82, 'tap'], // slap it home
  [0.86, 'reload'],
  [1, 'grip'],
];

export const RELOADS: Record<WeaponId, ReloadAnim> = {
  pistol: {
    // A quicker magazine swap, then rack the slide to chamber a round.
    keys: [
      [0, 'grip'],
      [0.12, 'reload'],
      [0.18, 'reload'], // grab the magazine
      [0.32, 'away'],
      [0.42, 'away'],
      [0.54, 'below'],
      [0.6, 'reload'], // push it in
      [0.65, 'tap'],
      [0.68, 'reload'],
      [0.78, 'slide'], // grab the back of the slide
      [0.86, 'slideBack'], // pull it back...
      [0.9, 'slideOff'], // ...and let go: it snaps forward
      [1, 'grip'],
    ],
    holdMag: [0.18, 0.6],
    seatAt: 0.65,
    tilt: 1,
    slide: { grab: 0.78, release: 0.86, snap: 0.025, travel: 0.04, poseIn: [0.68, 0.78], poseOut: [0.9, 1] },
  },
  rifle: { keys: MAGAZINE, holdMag: [0.24, 0.76], seatAt: 0.8, tilt: 1 },
  sniper: { keys: MAGAZINE, holdMag: [0.24, 0.76], seatAt: 0.8, tilt: 1 },
  shotgun: {
    // One shell per cycle (the cycle repeats for each shell).
    keys: [
      [0, 'grip'],
      [0.25, 'away'], // fetch a shell
      [0.5, 'below'],
      [0.68, 'reload'], // push it into the loading port
      [0.78, 'reload'],
      [1, 'grip'],
    ],
    holdShell: [0.22, 0.7],
    tilt: 0.6,
  },
};

// ---- After-shot actions --------------------------------------------------------------

/** Shotgun pump (seconds after the shot): start, pull back, push forward; travel in meters. */
export const PUMP = { start: 0.1, back: 0.16, forward: 0.2, travel: 0.1 };

/**
 * Sniper bolt (seconds after the shot): reach for the bolt, lift it, pull it
 * back (the case ejects here), push forward, turn it down, hand back to the grip.
 */
export const BOLT = { start: 0.22, reach: 0.14, lift: 0.1, back: 0.13, forward: 0.12, down: 0.09, ret: 0.16, travel: 0.075, liftAngle: 1.25 };
/** Where the right hand holds the bolt knob (bolt coordinates). */
export const BOLT_KNOB = v(0.065, -0.012, 0.005);

// ---- Small helpers used by the players of these animations -------------------------

export function smoothstep(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
}

/** 0 → 1 over [a0, a1], then 1 → 0 over [b0, b1]. */
export function window01(t: number, [a0, a1]: [number, number], [b0, b1]: [number, number]): number {
  return smoothstep((t - a0) / (a1 - a0)) * (1 - smoothstep((t - b0) / (b1 - b0)));
}
