import type * as THREE from 'three';
import type { WeaponId } from '../config';

export type HitPart = 'head' | 'body';

export interface DamageInfo {
  amount: number;
  part: HitPart;
  /** Who dealt the damage (an entity name like 'player' or 'Bot 3'). */
  attacker: string;
  weapon: WeaponId;
  /** Where the shot came from (world position), for damage indicators. */
  from: THREE.Vector3;
}

/** Anything bullets can hit: the player, bots, practice dummies. */
export interface Damageable {
  readonly name: string;
  readonly hitbox: CharacterHitbox;
  isAlive(): boolean;
  /** Returns true if this damage killed it. */
  takeDamage(info: DamageInfo): boolean;
}

/**
 * Hit shape of a standing character: a vertical cylinder for the body and
 * a sphere for the head. Works the same no matter which way it faces.
 */
export class CharacterHitbox {
  /** Feet position. */
  x = 0;
  y = 0;
  z = 0;

  constructor(
    public height: number,
    public radius: number,
    public headRadius: number,
  ) {}

  setPosition(p: THREE.Vector3): void {
    this.x = p.x;
    this.y = p.y;
    this.z = p.z;
  }

  get headY(): number {
    return this.y + this.height - this.headRadius;
  }

  /** Closest hit along the ray, or null. `dir` must be normalized. */
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxDist: number): { distance: number; part: HitPart } | null {
    let best: { distance: number; part: HitPart } | null = null;

    // Head: sphere.
    const hx = o.x - this.x, hy = o.y - this.headY, hz = o.z - this.z;
    const b = hx * d.x + hy * d.y + hz * d.z;
    const c = hx * hx + hy * hy + hz * hz - this.headRadius * this.headRadius;
    const disc = b * b - c;
    if (disc >= 0) {
      const t = -b - Math.sqrt(disc);
      if (t >= 0 && t <= maxDist) best = { distance: t, part: 'head' };
    }

    // Body: vertical cylinder from the feet up to the bottom of the head.
    const bodyTop = this.headY - this.headRadius * 0.6;
    const ox = o.x - this.x, oz = o.z - this.z;
    const a2 = d.x * d.x + d.z * d.z;
    if (a2 > 1e-9) {
      const b2 = ox * d.x + oz * d.z;
      const c2 = ox * ox + oz * oz - this.radius * this.radius;
      const disc2 = b2 * b2 - a2 * c2;
      if (disc2 >= 0) {
        const sq = Math.sqrt(disc2);
        // Entry and exit through the side of the cylinder.
        for (const t of [(-b2 - sq) / a2, (-b2 + sq) / a2]) {
          if (t < 0 || t > maxDist) continue;
          const y = o.y + d.y * t;
          if (y >= this.y && y <= bodyTop) {
            if (!best || t < best.distance) best = { distance: t, part: 'body' };
            break;
          }
        }
      }
    }
    // Shots from straight above/below hit the top/bottom caps.
    if (Math.abs(d.y) > 1e-6) {
      for (const capY of [bodyTop, this.y]) {
        const t = (capY - o.y) / d.y;
        if (t < 0 || t > maxDist || (best && t >= best.distance)) continue;
        const px = o.x + d.x * t - this.x, pz = o.z + d.z * t - this.z;
        if (px * px + pz * pz <= this.radius * this.radius) best = { distance: t, part: 'body' };
      }
    }
    return best;
  }
}
