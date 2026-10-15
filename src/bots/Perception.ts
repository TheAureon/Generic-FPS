import * as THREE from 'three';
import { BOTS } from '../config';
import type { CollisionWorld } from '../core/CollisionWorld';
import type { Trackable } from '../player/Player';

const DEG = Math.PI / 180;
/** How often a bot re-checks whether it can see its target (seconds). */
const VISION_INTERVAL = 0.1;

/**
 * What a bot knows: can it see its target right now, where did it last see
 * it, and has it heard anything worth checking out.
 */
export class Perception {
  /** Can the bot see its target right now? */
  canSee = false;
  /** Seconds the target has been continuously visible. */
  visibleTime = 0;

  /** Last place the target was seen (only valid if hasLastSeen). */
  readonly lastSeenPos = new THREE.Vector3();
  readonly lastSeenVelocity = new THREE.Vector3();
  hasLastSeen = false;
  private lastSeenAt = -Infinity;

  /** A noise (gunshot) or hit to investigate. */
  readonly noisePos = new THREE.Vector3();
  hasNoise = false;
  private noiseAt = -Infinity;

  private now = 0;
  private checkTimer = Math.random() * VISION_INTERVAL;

  get timeSinceSeen(): number {
    return this.now - this.lastSeenAt;
  }
  get timeSinceNoise(): number {
    return this.now - this.noiseAt;
  }

  /**
   * @param eye the bot's eye position
   * @param yaw the direction the bot is facing (radians)
   */
  update(dt: number, eye: THREE.Vector3, yaw: number, target: Trackable | null, world: CollisionWorld): void {
    this.now += dt;

    if (!target || !target.isAlive()) {
      this.canSee = false;
      this.visibleTime = 0;
      if (target && !target.isAlive()) this.hasLastSeen = false;
      return;
    }

    this.checkTimer -= dt;
    if (this.checkTimer <= 0) {
      this.checkTimer += VISION_INTERVAL;
      this.canSee = this.checkVision(eye, yaw, target, world);
    }

    if (this.canSee) {
      this.visibleTime += dt;
      this.lastSeenPos.copy(target.position);
      this.lastSeenVelocity.copy(target.velocity);
      this.lastSeenAt = this.now;
      this.hasLastSeen = true;
    } else {
      this.visibleTime = 0;
      if (this.timeSinceSeen > BOTS.memoryTime) this.hasLastSeen = false;
    }
    if (this.hasNoise && this.timeSinceNoise > BOTS.memoryTime) this.hasNoise = false;
  }

  /** Field of view + range + line of sight (walls block vision). */
  private checkVision(eye: THREE.Vector3, yaw: number, target: Trackable, world: CollisionWorld): boolean {
    const p = target.position;
    const dx = p.x - eye.x, dz = p.z - eye.z;
    const flatDist = Math.hypot(dx, dz);
    if (flatDist > BOTS.visionRange) return false;

    if (flatDist > BOTS.closeAwarenessRange) {
      // Angle between where the bot faces and the direction to the target.
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      const cos = (fx * dx + fz * dz) / Math.max(flatDist, 1e-6);
      if (cos < Math.cos((BOTS.fieldOfView / 2) * DEG)) return false;
    }

    // Visible if the head or the chest can be seen.
    const headY = p.y + target.height - 0.15;
    const chestY = p.y + target.height * 0.6;
    return (
      world.hasLineOfSight(eye.x, eye.y, eye.z, p.x, headY, p.z) ||
      world.hasLineOfSight(eye.x, eye.y, eye.z, p.x, chestY, p.z)
    );
  }

  /** A gunshot was heard at `pos`. */
  hear(pos: THREE.Vector3): void {
    // Hearing is not exact: a little guesswork about where it came from.
    this.noisePos.set(pos.x + (Math.random() - 0.5) * 3, pos.y, pos.z + (Math.random() - 0.5) * 3);
    this.noiseAt = this.now;
    this.hasNoise = true;
  }

  /** Got shot by someone at `from`: know roughly where they are. */
  alertFrom(from: THREE.Vector3): void {
    this.noisePos.copy(from);
    this.noiseAt = this.now;
    this.hasNoise = true;
  }

  clearNoise(): void {
    this.hasNoise = false;
  }

  reset(): void {
    this.canSee = false;
    this.visibleTime = 0;
    this.hasLastSeen = false;
    this.hasNoise = false;
  }
}
