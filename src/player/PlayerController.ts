import * as THREE from 'three';
import { CONFIG } from '../config';
import { CharacterBody } from '../core/CharacterBody';
import type { CollisionWorld } from '../core/CollisionWorld';
import type { Input } from '../core/Input';
import { settings } from '../core/Settings';
import type { SpawnPoint } from '../map/MapTypes';

const P = CONFIG.player;
const DEG = Math.PI / 180;
/** Mouse pixels → radians at sensitivity 1.0. */
const MOUSE_SCALE = 0.0022;

/**
 * First-person movement: WASD, mouse look, jump, sprint, crouch,
 * and collision with the map.
 */
export class PlayerController {
  readonly body: CharacterBody;
  /** Left/right look angle (radians). */
  yaw = 0;
  /** Up/down look angle (radians). */
  pitch = 0;

  crouching = false;
  sprinting = false;

  private bobPhase = 0;
  private bobAmount = 0;
  /** Smoothly settles the camera after stepping up a ledge. */
  private stepSmoothing = 0;
  private fovBoost = 0;

  /** View kick from weapon recoil (radians), recovers over time. */
  recoilPitch = 0;
  recoilYaw = 0;
  /** Recoil recovery speed (radians per second), set by the current weapon. */
  recoilRecovery = 0.1;
  /** Set by the weapon system: slows you while aiming. */
  speedMultiplier = 1;
  /** Set by the weapon system: no sprinting while aiming or just after firing. */
  sprintBlocked = false;
  /** Camera zoom while aiming (1 = none). */
  zoom = 1;
  /** Mouse movement from the last applyLook (used for gun sway). */
  lastLookDX = 0;
  lastLookDY = 0;

  constructor(
    world: CollisionWorld,
    private camera: THREE.PerspectiveCamera,
  ) {
    this.body = new CharacterBody(world, P.height, P.radius, P.stepHeight, P.gravity);
  }

  /** Position of the player's FEET. */
  get position(): THREE.Vector3 {
    return this.body.position;
  }
  get velocity(): THREE.Vector3 {
    return this.body.velocity;
  }
  get onGround(): boolean {
    return this.body.onGround;
  }
  set onGround(v: boolean) {
    this.body.onGround = v;
  }
  /** Current body height (blends between standing and crouching). */
  get height(): number {
    return this.body.height;
  }

  spawn(sp: SpawnPoint): void {
    this.position.set(sp.x, sp.y, sp.z);
    this.velocity.set(0, 0, 0);
    this.yaw = sp.yaw * DEG;
    this.pitch = 0;
    this.body.height = P.height;
    this.body.onGround = false;
    this.crouching = false;
    this.stepSmoothing = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.deathCam = 0;
    this.inputEnabled = true;
    this.shake = 0;
  }

  addRecoil(pitchDeg: number, yawDeg: number): void {
    this.recoilPitch += pitchDeg * DEG;
    this.recoilYaw += yawDeg * DEG;
  }

  /** Where the player is looking, including recoil (normalized). */
  getAimDirection(out: THREE.Vector3): THREE.Vector3 {
    const pitch = this.viewPitch, yaw = this.yaw + this.recoilYaw;
    return out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  }

  /** Eye position in the world. */
  getEyePosition(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.position.x, this.position.y + this.height - P.eyeFromTop, this.position.z);
  }

  private get viewPitch(): number {
    const lim = 89 * DEG;
    return Math.max(-lim, Math.min(lim, this.pitch + this.recoilPitch));
  }

  /** Mouse look is applied every rendered frame for responsiveness. */
  applyLook(input: Input): void {
    const { dx, dy } = input.consumeMouseDelta();
    this.lastLookDX = dx;
    this.lastLookDY = dy;
    // Lower sensitivity when zoomed so aiming feels the same.
    const sens = (settings.get().mouseSensitivity * MOUSE_SCALE) / this.zoom;
    this.yaw -= dx * sens;
    this.pitch -= dy * sens;
    const lim = 89 * DEG;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  /** Screen shake "trauma" (0..1); the shake is strongest right after a hit. */
  private shake = 0;
  private shakeTime = 0;

  /** Add screen shake (0..1 scale). */
  addShake(amount: number): void {
    if (!settings.get().screenShake) return;
    this.shake = Math.min(1, this.shake + amount);
  }

  /** Called on each footstep, and on landing (with the landing speed). */
  onStep: (() => void) | null = null;
  onLand: ((speed: number) => void) | null = null;
  private lastStep = 0;

  /** False while dead: movement keys are ignored. */
  inputEnabled = true;
  /** 0..1, set while dead: drops the camera to the floor. */
  deathCam = 0;

  private key(input: Input, code: string): boolean {
    return this.inputEnabled && input.isDown(code);
  }

  /** Physics step. Called at a fixed rate (see Game.ts). */
  step(dt: number, input: Input): void {
    // ---- Read movement keys -------------------------------------------------
    let fwd = 0, side = 0;
    if (this.key(input, 'KeyW') || this.key(input, 'ArrowUp')) fwd += 1;
    if (this.key(input, 'KeyS') || this.key(input, 'ArrowDown')) fwd -= 1;
    if (this.key(input, 'KeyD') || this.key(input, 'ArrowRight')) side += 1;
    if (this.key(input, 'KeyA') || this.key(input, 'ArrowLeft')) side -= 1;

    // ---- Crouch (hold C) ---------------------------------------------------
    const wantCrouch = this.key(input, 'KeyC');
    if (wantCrouch) {
      this.crouching = true;
    } else if (this.crouching && this.body.hasHeadroom(P.height)) {
      // Only stand up if there's room above our head.
      this.crouching = false;
    }
    const targetHeight = this.crouching ? P.crouchHeight : P.height;
    const hDiff = targetHeight - this.height;
    const hStep = P.crouchTransitionSpeed * dt;
    this.body.height += Math.abs(hDiff) <= hStep ? hDiff : Math.sign(hDiff) * hStep;

    // ---- Sprint (hold Shift, forward only, not crouched) --------------------
    const wantSprint = this.key(input, 'ShiftLeft') || this.key(input, 'ShiftRight');
    this.sprinting = wantSprint && fwd > 0 && !this.crouching && !this.sprintBlocked;
    const speed = (this.crouching ? P.crouchSpeed : this.sprinting ? P.sprintSpeed : P.walkSpeed) * this.speedMultiplier;

    // ---- Desired horizontal velocity ----------------------------------------
    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    // Forward is -Z when yaw = 0.
    let wx = -sinY * fwd + cosY * side;
    let wz = -cosY * fwd - sinY * side;
    const len = Math.hypot(wx, wz);
    if (len > 0) { wx /= len; wz /= len; }
    const targetVX = wx * speed, targetVZ = wz * speed;

    // In the air with no keys held we keep our momentum.
    const accel = this.onGround ? P.groundAcceleration : P.airAcceleration;
    this.body.accelerate(targetVX, targetVZ, accel, dt, !this.onGround && len === 0);

    // ---- Jump ---------------------------------------------------------------
    if (this.key(input, 'Space') && this.onGround && !this.crouching) this.body.jump(P.jumpSpeed);

    // ---- Move, collide, fall -------------------------------------------------
    const wasAirborne = !this.onGround;
    const fallSpeed = -this.velocity.y;
    const stepUp = this.body.step(dt);
    if (wasAirborne && this.onGround && fallSpeed > 4) this.onLand?.(fallSpeed);
    // Stepped up onto something: hide the snap by easing the camera.
    if (stepUp > 0.05) this.stepSmoothing -= stepUp;

    // Fell out of the world: put the player back (safety net).
    if (this.position.y < -50) this.position.set(0, 2, 0);

    // ---- Head bob bookkeeping ----------------------------------------------
    const hSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const moving = this.onGround && hSpeed > 0.5;
    this.bobAmount += ((moving ? Math.min(1, hSpeed / P.sprintSpeed) : 0) - this.bobAmount) * Math.min(1, dt * 10);
    if (moving) this.bobPhase += dt * hSpeed * CONFIG.camera.headBobFrequency;
    // A footstep each time the head bob reaches its low point.
    const step = Math.floor(this.bobPhase / Math.PI);
    if (step !== this.lastStep) {
      this.lastStep = step;
      if (moving && !this.crouching) this.onStep?.();
    }
    this.fovBoost += ((this.sprinting && hSpeed > 1 ? 1 : 0) - this.fovBoost) * Math.min(1, dt * 8);
    this.stepSmoothing *= Math.max(0, 1 - dt * 14);

    // ---- Screen shake fades -------------------------------------------------
    this.shake = Math.max(0, this.shake - dt * 1.8);
    this.shakeTime += dt;

    // ---- Recoil recovery ---------------------------------------------------
    const rec = this.recoilRecovery * dt;
    this.recoilPitch = Math.abs(this.recoilPitch) <= rec ? 0 : this.recoilPitch - Math.sign(this.recoilPitch) * rec;
    this.recoilYaw = Math.abs(this.recoilYaw) <= rec ? 0 : this.recoilYaw - Math.sign(this.recoilYaw) * rec;
  }

  /** Position the camera at the player's eyes. Called every rendered frame. */
  updateCamera(): void {
    const bob = Math.sin(this.bobPhase) * CONFIG.camera.headBobAmount * this.bobAmount;
    const standingEye = this.position.y + this.height - P.eyeFromTop + bob + this.stepSmoothing;
    // When dead, sink to the floor and tip over.
    const d = this.deathCam * this.deathCam * (3 - 2 * this.deathCam);
    const eye = standingEye + (this.position.y + 0.3 - standingEye) * d;
    this.camera.position.set(this.position.x, eye, this.position.z);
    // Screen shake: smooth wobble that fades quickly (squared so small hits stay subtle).
    const s = this.shake * this.shake * CONFIG.camera.maxShake * DEG;
    const t = this.shakeTime;
    const sp = s * (Math.sin(t * 37) * 0.6 + Math.sin(t * 61) * 0.4);
    const sy = s * (Math.sin(t * 43 + 1.3) * 0.6 + Math.sin(t * 71 + 0.4) * 0.4);
    const sr = s * Math.sin(t * 29 + 2.1) * 0.7;
    this.camera.rotation.set(this.viewPitch * (1 - d) + 0.3 * d + sp, this.yaw + this.recoilYaw + sy, 1.1 * d + sr, 'YXZ');

    // Zooming narrows the field of view (done on the tangent so it's a true zoom).
    const baseFov = settings.get().fov + this.fovBoost * CONFIG.camera.sprintFovBoost;
    const fov = (2 * Math.atan(Math.tan((baseFov * DEG) / 2) / this.zoom)) / DEG;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** 0..1 how fast we're moving horizontally compared to walking speed. */
  get moveFactor(): number {
    return Math.min(1, Math.hypot(this.velocity.x, this.velocity.z) / P.walkSpeed);
  }
}
