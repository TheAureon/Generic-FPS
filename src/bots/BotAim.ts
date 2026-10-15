import * as THREE from 'three';

const DEG = Math.PI / 180;

/** Shortest signed difference between two angles (radians). */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Yaw/pitch that point from `from` toward `to` (same convention as the player camera). */
export function anglesTo(from: THREE.Vector3, to: THREE.Vector3): { yaw: number; pitch: number } {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

/**
 * A bot's aim. It turns toward where it wants to look at a limited speed
 * (so fast-moving targets are hard to track), and has a wandering "wobble"
 * so shots aren't perfect. The wobble size is set from difficulty, distance,
 * and movement each frame.
 */
export class BotAim {
  yaw = 0;
  pitch = 0;

  private wobbleYaw = 0;
  private wobblePitch = 0;
  private wobbleTargetYaw = 0;
  private wobbleTargetPitch = 0;
  private wobbleTimer = 0;

  /** Rotate toward the desired angles at up to `turnSpeedDeg` per second. */
  turnToward(dt: number, yaw: number, pitch: number, turnSpeedDeg: number): void {
    const maxStep = turnSpeedDeg * DEG * dt;
    this.yaw += THREE.MathUtils.clamp(angleDiff(yaw, this.yaw), -maxStep, maxStep);
    this.pitch += THREE.MathUtils.clamp(pitch - this.pitch, -maxStep, maxStep);
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.4, 1.4);
  }

  /** How far (degrees) the aim is from the given direction. */
  offBy(yaw: number, pitch: number): number {
    return Math.hypot(angleDiff(yaw, this.yaw), pitch - this.pitch) / DEG;
  }

  /** Update the wobble; `errorDeg` is the typical size of the aim error. */
  updateWobble(dt: number, errorDeg: number): void {
    this.wobbleTimer -= dt;
    if (this.wobbleTimer <= 0) {
      this.wobbleTimer = 0.2 + Math.random() * 0.35;
      // New random offset inside a circle of radius errorDeg.
      const r = Math.sqrt(Math.random()) * errorDeg * DEG;
      const a = Math.random() * Math.PI * 2;
      this.wobbleTargetYaw = Math.cos(a) * r;
      this.wobbleTargetPitch = Math.sin(a) * r * 0.7; // less vertical error
    }
    const k = Math.min(1, dt * 6);
    this.wobbleYaw += (this.wobbleTargetYaw - this.wobbleYaw) * k;
    this.wobblePitch += (this.wobbleTargetPitch - this.wobblePitch) * k;
  }

  /** Direction a shot goes right now: aim + wobble + random spread. */
  shotDirection(spreadDeg: number, out: THREE.Vector3): THREE.Vector3 {
    const r = Math.sqrt(Math.random()) * spreadDeg * DEG;
    const a = Math.random() * Math.PI * 2;
    const yaw = this.yaw + this.wobbleYaw + Math.cos(a) * r;
    const pitch = this.pitch + this.wobblePitch + Math.sin(a) * r;
    return out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  }
}
