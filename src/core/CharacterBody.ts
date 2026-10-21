import * as THREE from 'three';
import { CollisionWorld, type Body } from './CollisionWorld';

/**
 * Walking physics shared by the player and bots: gravity, landing on floors
 * and ramps, stepping up small ledges, sliding along walls, bumping ceilings.
 */
export class CharacterBody {
  /** Position of the FEET. */
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  onGround = false;

  constructor(
    private world: CollisionWorld,
    public height: number,
    public radius: number,
    public stepHeight: number,
    public gravity: number,
  ) {}

  /**
   * Steer horizontal velocity toward (targetVX, targetVZ), changing by at most
   * `accel * dt`. If `coast` is true and there's no input, momentum is kept.
   */
  accelerate(targetVX: number, targetVZ: number, accel: number, dt: number, coast = false): void {
    const dvx = targetVX - this.velocity.x, dvz = targetVZ - this.velocity.z;
    const dvLen = Math.hypot(dvx, dvz);
    const maxDv = accel * dt;
    if (dvLen <= maxDv) {
      this.velocity.x = targetVX;
      this.velocity.z = targetVZ;
    } else if (!coast) {
      this.velocity.x += (dvx / dvLen) * maxDv;
      this.velocity.z += (dvz / dvLen) * maxDv;
    }
  }

  jump(speed: number): void {
    this.velocity.y = speed;
    this.onGround = false;
  }

  /**
   * Moves by the current velocity for `dt` seconds.
   * Returns how far we stepped UP onto a ledge this step (for camera smoothing).
   */
  step(dt: number): number {
    // Horizontal: one axis at a time so we slide along walls.
    this.moveAxis('x', this.velocity.x * dt);
    this.moveAxis('z', this.velocity.z * dt);

    // Vertical: gravity, landing, ceilings.
    const wasOnGround = this.onGround;
    const prevY = this.position.y;
    this.velocity.y -= this.gravity * dt;
    this.position.y += this.velocity.y * dt;

    const { x, z } = this.position;
    let stepUp = 0;
    const ground = this.world.groundHeight(x, z, this.radius, Math.max(prevY, this.position.y) + this.stepHeight);
    if (this.position.y <= ground || (wasOnGround && this.velocity.y <= 0 && this.position.y - ground <= this.stepHeight)) {
      // Landed, or walking down a ramp/step (stick to the ground).
      if (wasOnGround) stepUp = Math.max(0, ground - prevY);
      this.position.y = ground;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    const ceiling = this.world.ceilingHeight(x, z, this.radius, prevY + this.stepHeight);
    if (this.position.y + this.height > ceiling && this.velocity.y > 0) {
      this.position.y = ceiling - this.height;
      this.velocity.y = 0;
    }
    return stepUp;
  }

  /** Is there room to stand at height `h` here? */
  hasHeadroom(h: number): boolean {
    const ceiling = this.world.ceilingHeight(this.position.x, this.position.z, this.radius, this.position.y + this.stepHeight);
    return ceiling - this.position.y >= h;
  }

  /** Push sideways (e.g. two characters bumping), still respecting walls. */
  nudge(dx: number, dz: number): void {
    this.moveAxis('x', dx, false);
    this.moveAxis('z', dz, false);
  }

  private bodyShape(): Body {
    return { x: this.position.x, z: this.position.z, feet: this.position.y, height: this.height, radius: this.radius };
  }

  /** Returns true if something blocked the move. */
  moveAxis(axis: 'x' | 'z', delta: number, stopVelocity = true): boolean {
    if (delta === 0) return false;
    this.position[axis] += delta;
    const blocker = this.world.findBlocker(this.bodyShape(), this.stepHeight);
    if (!blocker) return false;
    if (blocker === CollisionWorld.STEEP) {
      // Too steep to walk up: just don't move this way.
      this.position[axis] -= delta;
      if (stopVelocity) this.velocity[axis] = 0;
      return true;
    }
    // Push back out to the face of whatever we hit.
    const eps = 0.001;
    if (axis === 'x') {
      this.position.x = delta > 0 ? blocker.minX - this.radius - eps : blocker.maxX + this.radius + eps;
    } else {
      this.position.z = delta > 0 ? blocker.minZ - this.radius - eps : blocker.maxZ + this.radius + eps;
    }
    if (stopVelocity) this.velocity[axis] = 0;
    return true;
  }
}
