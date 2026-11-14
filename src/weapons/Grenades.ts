import * as THREE from 'three';
import { GRENADES } from '../config';
import { audio } from '../audio/AudioEngine';
import type { CollisionWorld } from '../core/CollisionWorld';
import { events } from '../core/events';
import type { Damageable } from '../core/Hitbox';
import type { Effects } from '../effects/Effects';

/**
 * Frag grenades: thrown (by you or bots), they bounce off walls and floors,
 * then explode after a short fuse. The blast hurts everyone in range who
 * isn't behind cover (less the further away), except teammates of the
 * thrower. You can hurt yourself with your own grenade.
 */

const RADIUS = 0.06;
/** How much speed is kept when bouncing: straight off the surface, and along it. */
const BOUNCE = 0.38;
const FRICTION = 0.7;

export interface GrenadeVictim extends Damageable {
  team?: number | null;
}

export interface GrenadesDeps {
  scene: THREE.Scene;
  world: CollisionWorld;
  effects: Effects;
  /** Everyone the blast could hurt. */
  victims: () => readonly GrenadeVictim[];
  /** After each blast (camera shake, etc.). */
  onExplode?: (at: THREE.Vector3) => void;
  /** Each target a grenade hurt: who threw it, where, how much, and if it killed. */
  onHit?: (thrower: string, point: THREE.Vector3, damage: number, killed: boolean) => void;
}

interface Live {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  fuse: number;
  age: number;
  thrower: string;
  team: number | null;
  resting: boolean;
  lastClink: number;
}

export class Grenades {
  private live: Live[] = [];
  private geo: { body: THREE.BufferGeometry; cap: THREE.BufferGeometry; lever: THREE.BufferGeometry };
  private mats: { body: THREE.Material; metal: THREE.Material; light: THREE.MeshBasicMaterial };
  private _d = new THREE.Vector3();
  private _c = new THREE.Vector3();

  constructor(private d: GrenadesDeps) {
    this.geo = {
      body: new THREE.SphereGeometry(0.055, 12, 10).scale(1, 1.15, 1),
      cap: new THREE.CylinderGeometry(0.022, 0.026, 0.035, 10),
      lever: new THREE.BoxGeometry(0.012, 0.07, 0.008),
    };
    this.mats = {
      body: new THREE.MeshStandardMaterial({ color: 0x4b5a3a, roughness: 0.6, metalness: 0.2 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.35, metalness: 0.8 }),
      // A small red light so a live grenade is easy to spot.
      light: new THREE.MeshBasicMaterial({ color: 0xff3020 }),
    };
  }

  /** A grenade model (also used in your hand when throwing). */
  makeModel(): THREE.Group {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(this.geo.body, this.mats.body));
    const cap = new THREE.Mesh(this.geo.cap, this.mats.metal);
    cap.position.y = 0.075;
    const lever = new THREE.Mesh(this.geo.lever, this.mats.metal);
    lever.position.set(0.03, 0.045, 0);
    lever.rotation.z = -0.3;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 5), this.mats.light);
    dot.position.set(0, 0.095, 0);
    g.add(cap, lever, dot);
    return g;
  }

  throw(from: THREE.Vector3, velocity: THREE.Vector3, thrower: string, team: number | null): void {
    const mesh = this.makeModel();
    mesh.position.copy(from);
    this.d.scene.add(mesh);
    this.live.push({ mesh, pos: from.clone(), vel: velocity.clone(), fuse: GRENADES.fuse, age: 0, thrower, team, resting: false, lastClink: 0 });
    audio.play('grenade_throw', { position: from });
  }

  /** Live grenades about to go off near `p` (for bots to run from and the HUD warning). */
  dangerNear(p: THREE.Vector3, extra = 1.5, minAge = 0): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null, bestD = GRENADES.radius + extra;
    for (const g of this.live) {
      if (g.age < minAge) continue;
      const dist = g.pos.distanceTo(p);
      if (dist < bestD) {
        bestD = dist;
        best = g.pos;
      }
    }
    return best;
  }

  /** Where all live grenades are. */
  positions(): THREE.Vector3[] {
    return this.live.map((g) => g.pos);
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const g = this.live[i];
      g.age += dt;
      g.fuse -= dt;
      if (!g.resting) {
        // Small steps so fast grenades don't pass through thin walls.
        const steps = Math.max(1, Math.ceil((g.vel.length() * dt) / 0.15));
        for (let s = 0; s < steps; s++) this.step(g, dt / steps);
        g.mesh.rotation.x += g.vel.z * dt * 6;
        g.mesh.rotation.z -= g.vel.x * dt * 6;
      }
      g.mesh.position.copy(g.pos);
      // (Your own grenade is shown in your hand for the first moment, not right in front of your face.)
      g.mesh.visible = g.age > 0.12;
      // The light blinks faster as the fuse runs down.
      const blink = Math.sin(g.age * (8 + (1 - g.fuse / GRENADES.fuse) * 30)) > 0;
      (g.mesh.children[3] as THREE.Mesh).visible = blink;
      if (g.fuse <= 0) {
        this.explode(g);
        g.mesh.removeFromParent();
        this.live.splice(i, 1);
      }
    }
  }

  private step(g: Live, dt: number): void {
    g.vel.y -= GRENADES.gravity * dt;
    const len = g.vel.length() * dt;
    if (len < 1e-6) return;
    const dir = this._d.copy(g.vel).normalize();
    const hit = this.d.world.raycast(g.pos.x, g.pos.y, g.pos.z, dir.x, dir.y, dir.z, len + RADIUS);
    if (!hit) {
      g.pos.addScaledVector(g.vel, dt);
      return;
    }
    // Bounce: back to the surface, then reflect (losing speed).
    g.pos.addScaledVector(dir, Math.max(0, hit.distance - RADIUS));
    const n = this._c.set(hit.nx, hit.ny, hit.nz);
    const vn = g.vel.dot(n);
    const speed = g.vel.length();
    g.vel.addScaledVector(n, -vn); // along the surface
    g.vel.multiplyScalar(FRICTION);
    g.vel.addScaledVector(n, -vn * BOUNCE); // bounce off
    if (speed > 2.5 && g.age - g.lastClink > 0.12) {
      g.lastClink = g.age;
      audio.play('grenade_bounce', { position: g.pos, volume: Math.min(1, speed / 12) });
    }
    // Settled on the floor.
    if (n.y > 0.7 && g.vel.length() < 0.8) {
      g.vel.set(0, 0, 0);
      g.resting = true;
      g.pos.y += 0.005;
    }
  }

  private explode(g: Live): void {
    const at = g.pos.clone().setY(g.pos.y + 0.15);
    this.d.effects.explosion(at);
    audio.play('explosion', { position: at });
    events.emit('noise', { source: g.thrower, position: at.clone(), hearingRange: GRENADES.hearingRange });
    for (const v of this.d.victims()) {
      if (!v.isAlive()) continue;
      // No friendly fire, except your own grenade can hurt you.
      if (v.name !== g.thrower && g.team !== null && v.team === g.team) continue;
      const hb = v.hitbox;
      const center = this._c.set(hb.x, hb.y + hb.height * 0.5, hb.z);
      const dist = center.distanceTo(at);
      if (dist >= GRENADES.radius) continue;
      // Cover protects: needs a clear line to the body or the head.
      const w = this.d.world;
      if (!w.hasLineOfSight(at.x, at.y, at.z, center.x, center.y, center.z) && !w.hasLineOfSight(at.x, at.y, at.z, hb.x, hb.headY, hb.z)) continue;
      const k = dist <= GRENADES.fullRadius ? 1 : 1 - (dist - GRENADES.fullRadius) / (GRENADES.radius - GRENADES.fullRadius);
      let amount = GRENADES.damage * k;
      if (v.name === g.thrower) amount *= GRENADES.selfDamage;
      if (amount < 1) continue;
      const point = center.clone();
      const killed = v.takeDamage({ amount, part: 'body', attacker: g.thrower, weapon: 'grenade', from: at.clone() });
      if (!v.isProp) this.d.onHit?.(g.thrower, point, amount, killed);
    }
    this.d.onExplode?.(at);
  }

  dispose(): void {
    for (const g of this.live) g.mesh.removeFromParent();
    this.live = [];
  }
}
