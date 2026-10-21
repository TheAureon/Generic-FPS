import * as THREE from 'three';
import { SKELETON, type CharacterModel } from '../assets/characterModel';
import { markerPosition } from '../assets/weaponModels';

/**
 * Brings the character's skeleton to life, all in code (no animation files):
 * - legs walk/run in the direction of movement (also strafing and backing up),
 *   with knees bending, hips bobbing and swaying
 * - the upper body turns to face where the character aims, so it can run one
 *   way and shoot another
 * - both hands stay on the gun ("arm IK": the elbows bend to reach it)
 * - recoil when firing, a flinch when hit, a reload motion, breathing at rest,
 *   small steps when turning on the spot, tucked legs in the air
 * - falling over when killed
 */

export interface AnimInput {
  /** World velocity (m/s). */
  velocity: THREE.Vector3;
  onGround: boolean;
  /** Where the character faces/aims (radians); `root` is already turned to `yaw`. */
  yaw: number;
  pitch: number;
  /** 0..1 while reloading, or -1. */
  reload: number;
  /** Speed at which the walk turns into a run. */
  runSpeed: number;
}

/** The gun's two grip points, in the gun's own coordinates. */
export interface GunGrips {
  right: THREE.Vector3;
  left: THREE.Vector3;
  /** Where the left hand reaches during a reload (the magazine). */
  mag: THREE.Vector3;
}

const BLADE = 0.42; // shooting stance: upper body turned a bit to the right
const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _t = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _ay = new THREE.Vector3();
const _az = new THREE.Vector3();

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function approach(cur: number, target: number, rate: number, dt: number): number {
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}
function smooth01(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

export class CharacterAnimator {
  /** Called on each footfall (for step sounds). */
  onStep: ((speed: number) => void) | null = null;

  private phase = Math.random() * 6;
  private gaitAmp = 0;
  private runBlend = 0;
  private hipYaw = 0;
  private legYaw = 0; // world yaw the legs face while standing
  private turning = false;
  private backward = 0;
  private air = 0;
  private landDip = 0;
  private recoil = 0;
  private recoilVel = 0;
  private flinch = 0;
  private flinchSide = 0;
  private reloadBlend = 0;
  private time = Math.random() * 10;
  private wasOnGround = true;
  private deathT = -1;
  private headshot = false;
  private deathTwist = 0;
  private headLook = 0;

  constructor(
    private model: CharacterModel,
    private gun: THREE.Object3D | null,
    private grips: GunGrips,
  ) {
    model.bones.spine.rotation.order = 'YXZ';
    this.reset();
  }

  /** Standing pose, alive. */
  reset(): void {
    const b = this.model.bones;
    this.deathT = -1;
    this.recoil = this.recoilVel = this.flinch = this.air = this.landDip = 0;
    this.gaitAmp = this.runBlend = this.hipYaw = this.reloadBlend = 0;
    this.turning = false;
    for (const bone of Object.values(b)) bone.quaternion.identity();
    b.hips.position.set(0, SKELETON.hipsHeight, 0);
    this.model.root.rotation.set(0, this.model.root.rotation.y, 0);
    this.legYaw = this.model.root.rotation.y;
  }

  fire(): void {
    this.recoilVel += 9;
  }

  hit(): void {
    this.flinch = 1;
    this.flinchSide = Math.random() < 0.5 ? -1 : 1;
  }

  startDeath(headshot: boolean): void {
    this.deathT = 0;
    this.headshot = headshot;
    this.deathTwist = (Math.random() - 0.5) * 0.7;
  }

  get dead(): boolean {
    return this.deathT >= 0;
  }

  update(dt: number, inp: AnimInput): void {
    this.time += dt;
    if (this.deathT >= 0) {
      this.deathT += dt;
      this.updateDeath(dt, inp.yaw);
      return;
    }
    const b = this.model.bones;
    const root = this.model.root;
    root.rotation.set(0, inp.yaw, 0);

    // ---- Movement relative to facing ----------------------------------------
    const vx = inp.velocity.x, vz = inp.velocity.z;
    const speed = Math.hypot(vx, vz);
    const cy = Math.cos(inp.yaw), sy = Math.sin(inp.yaw);
    // Velocity in the character's frame (forward = -Z).
    const lx = vx * cy - vz * sy;
    const lz = vx * sy + vz * cy;
    const moving = speed > 0.4 && inp.onGround;
    let moveAngle = Math.atan2(-lx, -lz); // 0 = forward, + = to the left

    // Backing up: legs face the other way and the cycle runs in reverse.
    const back = Math.abs(moveAngle) > Math.PI * 0.62;
    this.backward = approach(this.backward, moving && back ? 1 : 0, 10, dt);
    if (back) moveAngle = wrap(moveAngle - Math.PI);

    // Legs (hips) turn toward the movement direction, the torso keeps aiming.
    let hipTarget: number;
    if (moving) {
      hipTarget = THREE.MathUtils.clamp(moveAngle, -0.85, 0.85);
      this.legYaw = inp.yaw + hipTarget;
      this.turning = false;
    } else {
      // Standing still: the feet stay planted until the body has turned too far,
      // then take a few small steps to catch up.
      let diff = wrap(this.legYaw - inp.yaw);
      if (Math.abs(diff) > 0.75) this.turning = true;
      if (this.turning) {
        this.legYaw = inp.yaw + approach(diff, 0, 7, dt);
        diff = wrap(this.legYaw - inp.yaw);
        if (Math.abs(diff) < 0.06) this.turning = false;
      }
      hipTarget = diff;
    }
    this.hipYaw = approach(this.hipYaw, hipTarget, moving ? 9 : 30, dt);
    const sideResidual = moving ? moveAngle - this.hipYaw : 0;

    // ---- Gait -------------------------------------------------------------------
    const run = smooth01((speed - inp.runSpeed * 0.65) / (inp.runSpeed * 0.35));
    this.runBlend = approach(this.runBlend, run, 6, dt);
    const r = this.runBlend;
    const targetAmp = moving ? Math.min(1, speed / 2.2) : this.turning ? 0.45 : 0;
    this.gaitAmp = approach(this.gaitAmp, targetAmp, 8, dt);
    const amp = this.gaitAmp;
    const stride = THREE.MathUtils.lerp(1.5, 2.3, r); // meters per full cycle (two steps)
    const cycleSpeed = moving ? speed / stride : this.turning ? 1.7 : 0;
    const dir = this.backward > 0.5 ? -1 : 1;
    const prevStep = Math.floor(this.phase / Math.PI);
    this.phase += dt * cycleSpeed * Math.PI * 2 * dir;
    const step = Math.floor(this.phase / Math.PI);
    if (step !== prevStep && inp.onGround && (moving || this.turning)) this.onStep?.(speed);

    const thighA = THREE.MathUtils.lerp(0.42, 0.68, r) * amp;
    const kneeA = THREE.MathUtils.lerp(0.75, 1.35, r) * amp;
    const kneeBase = 0.06 + 0.12 * r * amp;
    const swingCos = Math.cos(sideResidual), swingSin = Math.sin(sideResidual);
    const idleShift = Math.sin(this.time * 0.45);
    for (const [thigh, knee, off] of [
      [b.lThigh, b.lKnee, 0],
      [b.rThigh, b.rKnee, Math.PI],
    ] as const) {
      const ph = this.phase + off;
      const s = Math.sin(ph);
      // Forward swing (cos > 0) lifts the foot: the knee bends most mid-swing.
      const lift = Math.max(0, Math.cos(ph) * dir);
      const swing = thighA * s + 0.08 * r * amp; // runners keep thighs a little forward
      let tx = swing * swingCos;
      let tz = -swing * swingSin;
      let k = -(kneeBase + kneeA * lift * lift);
      // Standing: knees soft, weight shifting from leg to leg.
      const rest = 1 - amp;
      k -= rest * (0.07 + 0.04 * (off === 0 ? idleShift : -idleShift));
      tx += rest * 0.035;
      // In the air: legs tuck up.
      tx += this.air * (off === 0 ? 0.55 : 0.25);
      k -= this.air * (off === 0 ? 0.95 : 0.6);
      // Landing: knees take the impact.
      tx += this.landDip * 0.35;
      k -= this.landDip * 0.7;
      thigh.rotation.set(tx, 0, tz + (off === 0 ? 0.02 : -0.02) * rest);
      knee.rotation.set(k, 0, 0);
    }

    // ---- Hips ---------------------------------------------------------------------
    if (inp.onGround && !this.wasOnGround) this.landDip = 1;
    this.wasOnGround = inp.onGround;
    this.air = approach(this.air, inp.onGround ? 0 : 1, inp.onGround ? 14 : 5, dt);
    this.landDip = Math.max(0, this.landDip - dt * 4);
    const legLen = 0.88;
    const bobDepth = legLen * (1 - Math.cos(thighA)) * 0.8 + 0.02 * r * amp;
    const bob = bobDepth * (1 - Math.abs(Math.cos(this.phase))) - 0.012 * r * amp * Math.abs(Math.cos(this.phase));
    const rest = 1 - amp;
    b.hips.position.set(
      0.018 * idleShift * rest + Math.sin(this.phase) * 0.02 * amp * (1 - r),
      SKELETON.hipsHeight - bob - rest * 0.02 - this.landDip * 0.12 - this.air * 0.05,
      0,
    );
    const pelvisTwist = -Math.sin(this.phase) * 0.12 * amp * dir;
    b.hips.rotation.set(0, this.hipYaw + pelvisTwist, Math.sin(this.phase) * 0.05 * amp + 0.025 * idleShift * rest);

    // ---- Upper body: twist back to aim, lean, breathe, recoil, flinch ------------
    this.recoilVel += (-this.recoil * 160 - this.recoilVel * 18) * dt;
    this.recoil += this.recoilVel * dt;
    this.flinch = Math.max(0, this.flinch - dt * 3.5);
    const fl = this.flinch * this.flinch;
    this.reloadBlend = approach(this.reloadBlend, inp.reload >= 0 ? 1 : 0, 9, dt);

    const breathe = Math.sin(this.time * 1.6) * 0.018 * (1 - amp * 0.6);
    const lean = -(0.06 + 0.16 * r) * amp * (dir > 0 ? 1 : -0.4);
    const spinePitch = inp.pitch * 0.5 + lean + breathe + this.recoil * 0.05 + fl * 0.25 - this.reloadBlend * 0.08;
    b.spine.rotation.set(spinePitch, -BLADE - this.hipYaw - pelvisTwist * 0.8, fl * 0.15 * this.flinchSide - Math.sin(this.phase) * 0.04 * amp);

    // Head looks where the gun aims (slightly tilted onto the stock), with a
    // glance down at the gun during reloads.
    this.headLook = approach(this.headLook, inp.reload >= 0 ? 1 : 0, 6, dt);
    this.aimRelative(b.neck, inp.pitch - this.headLook * 0.45 + fl * 0.3, -0.05 + this.headLook * 0.25, -0.14);

    // ---- Gun: held where the aim is, regardless of torso motion -------------------
    if (this.gun) this.poseGun(inp.pitch, inp.reload);
    this.solveArms(inp.reload);
  }

  /**
   * Set a spine child's rotation so it ends up at the given pitch/yaw/roll in
   * the character's own frame (undoing the hips and spine rotation).
   */
  private aimRelative(bone: THREE.Bone, pitch: number, yaw: number, roll: number): void {
    const b = this.model.bones;
    _q.copy(b.hips.quaternion).multiply(b.spine.quaternion).invert();
    _e.set(pitch, yaw, roll, 'YXZ');
    _q2.setFromEuler(_e);
    bone.quaternion.copy(_q).multiply(_q2);
  }

  private poseGun(pitch: number, reload: number): void {
    const mount = this.model.bones.gunMount;
    const rl = this.reloadBlend;
    // Reload motion: tilt the gun, dip it, pull it in; a small jolt when the
    // new magazine goes in (around 60% of the way through).
    const seat = reload >= 0 ? Math.exp(-Math.pow((reload - 0.62) * 14, 2)) : 0;
    const roll = rl * 0.55;
    const dip = rl * 0.5 + seat * 0.08;
    // Gun position in the (un-bladed) torso frame: centered-right, at chin height.
    _v.set(0.1 - rl * 0.04, 0.4 - rl * 0.1, -0.34 + this.recoil * 0.05 + rl * 0.08);
    _v.applyAxisAngle(UP, BLADE);
    mount.position.copy(_v);
    this.aimRelative(mount, pitch - dip + this.recoil * 0.1, rl * 0.15, roll);
  }

  /** Bend both arms so the hands land on the gun's grips. */
  private solveArms(reload: number): void {
    const b = this.model.bones;
    if (!this.gun) {
      // Nothing to hold: arms hang relaxed.
      b.lShoulder.rotation.set(0.05, 0, -0.12);
      b.rShoulder.rotation.set(0.05, 0, 0.12);
      b.lElbow.rotation.set(0.25, 0, 0);
      b.rElbow.rotation.set(0.25, 0, 0);
      return;
    }
    const mount = b.gunMount;
    mount.updateMatrix();
    this.gun.updateMatrix();
    _m.multiplyMatrices(mount.matrix, this.gun.matrix);

    _t.copy(this.grips.right).applyMatrix4(_m);
    this.ik(b.rShoulder, b.rElbow, _t, 1);

    // Left hand: on the handguard, or fetching a new magazine while reloading.
    _t.copy(this.grips.left).applyMatrix4(_m);
    if (reload >= 0) {
      _p.copy(this.grips.mag).applyMatrix4(_m);
      // 0-0.25 to the mag, 0.25-0.45 down to the belt, 0.45-0.65 back up, then return.
      const toMag = smooth01(reload / 0.2) * (1 - smooth01((reload - 0.7) / 0.2));
      const toBelt = smooth01((reload - 0.25) / 0.12) * (1 - smooth01((reload - 0.42) / 0.14));
      _t.lerp(_p, toMag);
      _d.set(-0.12, 0.05, -0.12); // belt pouch, spine space (roughly)
      _t.lerp(_d, toBelt);
    }
    this.ik(b.lShoulder, b.lElbow, _t, -1);
  }

  /**
   * Two-bone IK in spine space. `side` is +1 for the right arm, -1 for the left;
   * elbows point down, out, and a little back.
   */
  private ik(shoulder: THREE.Bone, elbow: THREE.Bone, target: THREE.Vector3, side: number): void {
    const a = SKELETON.upperArm;
    const c = SKELETON.forearm - 0.01;
    const s = shoulder.position;
    _d.subVectors(target, s);
    let dist = _d.length();
    dist = THREE.MathUtils.clamp(dist, Math.abs(a - c) + 0.01, a + c - 0.001);
    _d.normalize();
    // Elbow position: law of cosines + pole direction.
    const along = (a * a - c * c + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, a * a - along * along));
    _p.set(side * 0.7, -1, 0.35);
    _p.addScaledVector(_d, -_p.dot(_d)).normalize();
    _elbow.copy(s).addScaledVector(_d, along).addScaledVector(_p, h);
    // Hand position actually reached (target clamped to arm length).
    _t.copy(s).addScaledVector(_d, dist);

    // Shoulder frame: local -Y along the upper arm, local -Z toward the forearm.
    _ay.subVectors(s, _elbow).normalize(); // -upper arm direction
    _v.subVectors(_t, _elbow).normalize(); // forearm direction
    const bend = Math.acos(THREE.MathUtils.clamp(-_ay.dot(_v), -1, 1));
    _az.copy(_v).addScaledVector(_ay, -_v.dot(_ay));
    if (_az.lengthSq() < 1e-6) _az.copy(Z).addScaledVector(_ay, -Z.dot(_ay));
    _az.normalize().negate();
    _ax.crossVectors(_ay, _az).normalize();
    if (!Number.isFinite(_ax.x)) _ax.copy(X);
    _m2.makeBasis(_ax, _ay, _az);
    shoulder.quaternion.setFromRotationMatrix(_m2);
    elbow.rotation.set(bend, 0, 0);
  }

  /** Falling over: knees buckle, arms fling out, the head snaps back on a headshot. */
  private updateDeath(dt: number, yaw: number): void {
    const b = this.model.bones;
    const t = this.deathT;
    const FALL = 0.6;
    const k = Math.min(1, t / FALL);
    let angle = (Math.PI / 2) * k * k;
    if (t > FALL) angle += 0.09 * Math.sin((t - FALL) * 20) * Math.exp(-(t - FALL) * 9);
    this.model.root.rotation.set(angle, yaw, this.deathTwist * k, 'YXZ');

    const f = 1 - Math.exp(-dt * 9);
    const to = (bone: THREE.Bone, x: number, y: number, z: number) => {
      _e.set(x, y, z, 'YXZ');
      _q.setFromEuler(_e);
      bone.quaternion.slerp(_q, f);
    };
    // Buckle: hips drop as the knees fold, then lie flat.
    b.hips.position.y = approach(b.hips.position.y, SKELETON.hipsHeight - 0.1 * Math.sin(Math.min(1, k) * Math.PI), 12, dt);
    to(b.hips, 0, 0, 0);
    to(b.lThigh, 0.6, 0, -0.05);
    to(b.rThigh, 0.25, 0, 0.12);
    to(b.lKnee, -1.1, 0, 0);
    to(b.rKnee, -0.45, 0, 0);
    to(b.spine, 0.3, this.deathTwist * 0.5, 0);
    to(b.lShoulder, -0.6, 0, -1.3);
    to(b.rShoulder, -0.9, 0, 1.1);
    to(b.lElbow, 0.5, 0, 0);
    to(b.rElbow, 0.8, 0, 0);
    to(b.neck, this.headshot ? 0.8 : 0.35, this.deathTwist, 0);
    if (this.headshot && t < 0.12) b.neck.quaternion.slerp(_q, 0.5);
  }
}

/** Grip points for the built-in rifle model (gun-local coordinates). */
export const RIFLE_GRIPS: GunGrips = {
  right: new THREE.Vector3(0, -0.075, 0.1),
  left: new THREE.Vector3(0, -0.035, -0.19),
  mag: new THREE.Vector3(0, -0.15, -0.07),
};

/** A gun's grip points: from a custom model's markers if it has them, else the rifle's. */
export function gunGrips(gun: THREE.Object3D): GunGrips {
  return {
    right: markerPosition(gun, 'grip_right') ?? RIFLE_GRIPS.right.clone(),
    left: markerPosition(gun, 'grip_left') ?? RIFLE_GRIPS.left.clone(),
    mag: markerPosition(gun, 'grip_reload') ?? RIFLE_GRIPS.mag.clone(),
  };
}
