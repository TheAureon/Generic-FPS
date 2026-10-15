import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Body, CollisionWorld } from '../core/CollisionWorld';
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
  /** Position of the player's FEET. */
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  /** Left/right look angle (radians). */
  yaw = 0;
  /** Up/down look angle (radians). */
  pitch = 0;

  onGround = false;
  crouching = false;
  sprinting = false;
  /** Current body height (blends between standing and crouching). */
  height = P.height;

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
    private world: CollisionWorld,
    private camera: THREE.PerspectiveCamera,
  ) {}

  spawn(sp: SpawnPoint): void {
    this.position.set(sp.x, sp.y, sp.z);
    this.velocity.set(0, 0, 0);
    this.yaw = sp.yaw * DEG;
    this.pitch = 0;
    this.height = P.height;
    this.crouching = false;
    this.stepSmoothing = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
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

  /** Physics step. Called at a fixed rate (see Game.ts). */
  step(dt: number, input: Input): void {
    // ---- Read movement keys -------------------------------------------------
    let fwd = 0, side = 0;
    if (input.isDown('KeyW') || input.isDown('ArrowUp')) fwd += 1;
    if (input.isDown('KeyS') || input.isDown('ArrowDown')) fwd -= 1;
    if (input.isDown('KeyD') || input.isDown('ArrowRight')) side += 1;
    if (input.isDown('KeyA') || input.isDown('ArrowLeft')) side -= 1;

    // ---- Crouch (hold C) ---------------------------------------------------
    const wantCrouch = input.isDown('KeyC');
    if (wantCrouch) {
      this.crouching = true;
    } else if (this.crouching) {
      // Only stand up if there's room above our head.
      const ceiling = this.world.ceilingHeight(
        this.position.x, this.position.z, P.radius, this.position.y + P.stepHeight,
      );
      if (ceiling - this.position.y >= P.height) this.crouching = false;
    }
    const targetHeight = this.crouching ? P.crouchHeight : P.height;
    const hDiff = targetHeight - this.height;
    const hStep = P.crouchTransitionSpeed * dt;
    this.height += Math.abs(hDiff) <= hStep ? hDiff : Math.sign(hDiff) * hStep;

    // ---- Sprint (hold Shift, forward only, not crouched) --------------------
    const wantSprint = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
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

    const accel = this.onGround ? P.groundAcceleration : P.airAcceleration;
    const dvx = targetVX - this.velocity.x, dvz = targetVZ - this.velocity.z;
    const dvLen = Math.hypot(dvx, dvz);
    const maxDv = accel * dt;
    if (dvLen <= maxDv) {
      this.velocity.x = targetVX;
      this.velocity.z = targetVZ;
    } else if (this.onGround || len > 0) {
      // In the air with no keys held we keep our momentum.
      this.velocity.x += (dvx / dvLen) * maxDv;
      this.velocity.z += (dvz / dvLen) * maxDv;
    }

    // ---- Jump ---------------------------------------------------------------
    if (input.isDown('Space') && this.onGround && !this.crouching) {
      this.velocity.y = P.jumpSpeed;
      this.onGround = false;
    }

    // ---- Move horizontally, one axis at a time, sliding along walls ---------
    this.moveAxis('x', this.velocity.x * dt);
    this.moveAxis('z', this.velocity.z * dt);

    // ---- Gravity, landing, ceilings -----------------------------------------
    const wasOnGround = this.onGround;
    const prevY = this.position.y;
    this.velocity.y -= P.gravity * dt;
    this.position.y += this.velocity.y * dt;

    const { x, z } = this.position;
    const ground = this.world.groundHeight(x, z, P.radius, Math.max(prevY, this.position.y) + P.stepHeight);
    if (this.position.y <= ground) {
      this.landAt(ground, prevY);
    } else if (wasOnGround && this.velocity.y <= 0 && this.position.y - ground <= P.stepHeight) {
      // Stick to the ground when walking down ramps and steps.
      this.landAt(ground, prevY);
    } else {
      this.onGround = false;
    }

    const ceiling = this.world.ceilingHeight(x, z, P.radius, prevY + P.stepHeight);
    if (this.position.y + this.height > ceiling && this.velocity.y > 0) {
      this.position.y = ceiling - this.height;
      this.velocity.y = 0;
    }

    // Fell out of the world: put the player back (safety net).
    if (this.position.y < -50) this.position.set(0, 2, 0);

    // ---- Head bob bookkeeping ----------------------------------------------
    const hSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const moving = this.onGround && hSpeed > 0.5;
    this.bobAmount += ((moving ? Math.min(1, hSpeed / P.sprintSpeed) : 0) - this.bobAmount) * Math.min(1, dt * 10);
    if (moving) this.bobPhase += dt * hSpeed * CONFIG.camera.headBobFrequency;
    this.fovBoost += ((this.sprinting && hSpeed > 1 ? 1 : 0) - this.fovBoost) * Math.min(1, dt * 8);
    this.stepSmoothing *= Math.max(0, 1 - dt * 14);

    // ---- Recoil recovery ---------------------------------------------------
    const rec = this.recoilRecovery * dt;
    this.recoilPitch = Math.abs(this.recoilPitch) <= rec ? 0 : this.recoilPitch - Math.sign(this.recoilPitch) * rec;
    this.recoilYaw = Math.abs(this.recoilYaw) <= rec ? 0 : this.recoilYaw - Math.sign(this.recoilYaw) * rec;
  }

  private landAt(ground: number, prevY: number): void {
    const stepUp = ground - prevY;
    // Stepped up onto something: hide the snap by easing the camera.
    if (this.onGround && stepUp > 0.05) this.stepSmoothing -= stepUp;
    this.position.y = ground;
    if (this.velocity.y < 0) this.velocity.y = 0;
    this.onGround = true;
  }

  private body(): Body {
    return { x: this.position.x, z: this.position.z, feet: this.position.y, height: this.height, radius: P.radius };
  }

  private moveAxis(axis: 'x' | 'z', delta: number): void {
    if (delta === 0) return;
    this.position[axis] += delta;
    const blocker = this.world.findBlocker(this.body(), P.stepHeight);
    if (!blocker) return;
    // Push back out to the face of whatever we hit, and stop moving that way.
    const eps = 0.001;
    if (axis === 'x') {
      this.position.x = delta > 0 ? blocker.minX - P.radius - eps : blocker.maxX + P.radius + eps;
    } else {
      this.position.z = delta > 0 ? blocker.minZ - P.radius - eps : blocker.maxZ + P.radius + eps;
    }
    this.velocity[axis] = 0;
  }

  /** Position the camera at the player's eyes. Called every rendered frame. */
  updateCamera(): void {
    const bob = Math.sin(this.bobPhase) * CONFIG.camera.headBobAmount * this.bobAmount;
    const eye = this.position.y + this.height - P.eyeFromTop + bob + this.stepSmoothing;
    this.camera.position.set(this.position.x, eye, this.position.z);
    this.camera.rotation.set(this.viewPitch, this.yaw + this.recoilYaw, 0, 'YXZ');

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
