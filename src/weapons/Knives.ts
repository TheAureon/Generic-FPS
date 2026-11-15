import * as THREE from 'three';
import { TACTICAL, type DamageSource } from '../config';
import { audio } from '../audio/AudioEngine';
import type { CollisionWorld } from '../core/CollisionWorld';
import type { Damageable } from '../core/Hitbox';
import type { Effects } from '../effects/Effects';

/**
 * Throwing knives: they fly fast and nearly straight (a little drop), spin,
 * and kill whoever they hit in one go, silently. A knife that misses sticks
 * where it lands (in a wall or the floor); walk over it to pick it back up.
 */

/** What's flying: a throwing knife, a crossbow bolt, or a rocket. */
export type ProjectileKind = 'knife' | 'bolt' | 'rocket';

export interface ProjectileOpts {
  damage: number;
  headshotMultiplier: number;
  gravity: number;
  weapon: DamageSource;
}

export interface KnivesDeps {
  scene: THREE.Scene;
  world: CollisionWorld;
  effects: Effects;
  /** Who a knife thrown by `thrower` can hit. */
  targets: (thrower: string) => readonly Damageable[];
  /** A knife hit someone (who threw it, where, and if it killed). */
  onHit?: (thrower: string, point: THREE.Vector3, damage: number, killed: boolean) => void;
  /** A rocket hit something: blow it up. */
  onRocket?: (at: THREE.Vector3, thrower: string) => void;
}

interface Flying {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  thrower: string;
  age: number;
  kind: ProjectileKind;
  opts: ProjectileOpts;
  trail: number;
}

interface Stuck {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  owner: string;
  age: number;
}

const _d = new THREE.Vector3();
const _n = new THREE.Vector3();

export class Knives {
  private flying: Flying[] = [];
  private stuck: Stuck[] = [];
  private mats = {
    blade: new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 0.9, roughness: 0.25 }),
    grip: new THREE.MeshStandardMaterial({ color: 0x1e1e20, roughness: 0.8 }),
  };

  constructor(private d: KnivesDeps) {}

  /** A throwing knife: blade along -Z (the way it flies). */
  makeModel(): THREE.Group {
    const g = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.022, 0.13).translate(0, 0, -0.065), this.mats.blade);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.04, 4).rotateX(-Math.PI / 2).scale(0.35, 1, 1).translate(0, 0, -0.15), this.mats.blade);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.02, 0.09).translate(0, 0, 0.045), this.mats.grip);
    const spin = new THREE.Group();
    spin.add(blade, tip, grip);
    g.add(spin);
    return g;
  }

  throw(from: THREE.Vector3, velocity: THREE.Vector3, thrower: string, kind: ProjectileKind = 'knife', opts?: ProjectileOpts): void {
    const K = TACTICAL.knife;
    const mesh = kind === 'knife' ? this.makeModel() : kind === 'bolt' ? this.makeBolt() : this.makeRocket();
    mesh.position.copy(from);
    this.d.scene.add(mesh);
    opts ??= { damage: K.damage, headshotMultiplier: 1, gravity: K.gravity, weapon: 'knife' };
    this.flying.push({ mesh, pos: from.clone(), vel: velocity.clone(), thrower, age: 0, kind, opts, trail: 0 });
    if (kind === 'knife') audio.play('knife_throw', { position: from });
  }

  /** A crossbow bolt: shaft along -Z (no spinning part). */
  private makeBolt(): THREE.Group {
    const g = new THREE.Group();
    const spin = new THREE.Group();
    spin.add(
      new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.34, 6).rotateX(Math.PI / 2), this.mats.blade),
      new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.03, 4).rotateX(-Math.PI / 2).translate(0, 0, -0.18), this.mats.blade),
      new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.02, 0.04).translate(0, 0, 0.14), this.mats.grip),
    );
    g.add(spin);
    return g;
  }

  /** A rocket: olive body, nose cone, tail fins. */
  private makeRocket(): THREE.Group {
    const g = new THREE.Group();
    const olive = new THREE.MeshStandardMaterial({ color: 0x4b5a3a, roughness: 0.6 });
    const spin = new THREE.Group();
    spin.add(
      new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 10).rotateX(Math.PI / 2), olive),
      new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.14, 10).rotateX(-Math.PI / 2).translate(0, 0, -0.22), olive),
      new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.004, 0.06).translate(0, 0, 0.15), this.mats.grip),
      new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.16, 0.06).translate(0, 0, 0.15), this.mats.grip),
      new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6).translate(0, 0, 0.17), new THREE.MeshBasicMaterial({ color: 0xffb050 })),
    );
    g.add(spin);
    return g;
  }

  /** Knives lying around (or stuck in walls) that `name` can pick up from `pos`: returns how many were picked up. */
  collect(name: string, pos: THREE.Vector3, eyeHeight: number): number {
    let n = 0;
    const R = TACTICAL.knife.pickupRadius;
    for (let i = this.stuck.length - 1; i >= 0; i--) {
      const k = this.stuck[i];
      if (k.owner !== name) continue;
      // Within reach: near your feet, or up a wall within arm's reach.
      const dy = k.pos.y - pos.y;
      if (Math.hypot(k.pos.x - pos.x, k.pos.z - pos.z) > R || dy < -0.5 || dy > eyeHeight + 0.4) continue;
      k.mesh.removeFromParent();
      this.stuck.splice(i, 1);
      n++;
    }
    return n;
  }

  update(dt: number): void {
    const K = TACTICAL.knife;
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      f.age += dt;
      f.vel.y -= f.opts.gravity * dt;
      // Rockets leave a smoke trail.
      if (f.kind === 'rocket' && (f.trail -= dt) <= 0) {
        f.trail = 0.025;
        this.d.effects.trailPuff(f.pos);
      }
      const step = f.vel.length() * dt;
      _d.copy(f.vel).normalize();
      // Someone in the way?
      const wall = this.d.world.raycast(f.pos.x, f.pos.y, f.pos.z, _d.x, _d.y, _d.z, step);
      let hitDist = wall ? wall.distance : step;
      let victim: Damageable | null = null;
      let part: 'head' | 'body' = 'body';
      for (const t of this.d.targets(f.thrower)) {
        if (!t.isAlive() || t.name === f.thrower) continue;
        const h = t.hitbox.raycast(f.pos, _d, hitDist);
        if (h && h.distance < hitDist) {
          hitDist = h.distance;
          victim = t;
          part = h.part;
        }
      }
      f.pos.addScaledVector(_d, hitDist);
      // Point along the flight, spinning end over end.
      f.mesh.position.copy(f.pos);
      f.mesh.lookAt(_n.copy(f.pos).sub(_d));
      if (f.kind === 'knife') (f.mesh.children[0] as THREE.Object3D).rotation.x = -f.age * 28;
      else (f.mesh.children[0] as THREE.Object3D).rotation.z = f.age * 12;

      if (f.kind === 'rocket' && (victim || wall || f.age > 6)) {
        // Boom, right where it hit.
        this.d.onRocket?.(f.pos.clone().addScaledVector(_d, -0.15), f.thrower);
        f.mesh.removeFromParent();
        this.flying.splice(i, 1);
        continue;
      }
      if (victim) {
        const dmg = f.opts.damage * (part === 'head' ? f.opts.headshotMultiplier : 1);
        const killed = victim.takeDamage({ amount: dmg, part, attacker: f.thrower, weapon: f.opts.weapon, from: f.pos.clone() });
        audio.play('knife_hit', { position: f.pos });
        if (!victim.isProp) {
          this.d.effects.bloodPuff(f.pos, _d);
          this.d.onHit?.(f.thrower, f.pos.clone(), dmg, killed);
        }
        if (f.kind === 'bolt') {
          f.mesh.removeFromParent();
          this.flying.splice(i, 1);
          continue;
        }
        // Drops to the floor where they stood, to be picked up.
        const floor = this.d.world.groundHeight(f.pos.x, f.pos.z, 0.05, f.pos.y + 0.1);
        this.land(f, Number.isFinite(floor) ? new THREE.Vector3(f.pos.x, floor + 0.02, f.pos.z) : f.pos.clone(), true);
        this.flying.splice(i, 1);
        continue;
      }
      if (wall || f.age > 3) {
        // Sticks into the wall or floor, blade first.
        if (wall) {
          audio.play('knife_hit', { position: f.pos, volume: 0.6 });
          this.d.effects.impact(f.pos.clone(), _n.set(wall.nx, wall.ny, wall.nz));
        }
        this.land(f, f.pos.clone().addScaledVector(_d, 0.06), false);
        this.flying.splice(i, 1);
      }
    }
    // Knives left lying around too long disappear.
    for (let i = this.stuck.length - 1; i >= 0; i--) {
      const k = this.stuck[i];
      k.age += dt;
      if (k.age > K.lifetime) {
        k.mesh.removeFromParent();
        this.stuck.splice(i, 1);
      }
    }
  }

  private land(f: Flying, at: THREE.Vector3, flat: boolean): void {
    f.mesh.position.copy(at);
    const spin = f.mesh.children[0] as THREE.Object3D;
    if (flat) {
      f.mesh.rotation.set(0, Math.random() * 6, 0);
      spin.rotation.set(0, 0, Math.PI / 2);
    } else {
      // Keep the flight direction, blade in.
      spin.rotation.x = 0;
    }
    // Crossbow bolts stay in the wall a while but can't be picked up.
    this.stuck.push({ mesh: f.mesh, pos: at, owner: f.kind === 'knife' ? f.thrower : '', age: f.kind === 'knife' ? 0 : TACTICAL.knife.lifetime - 10 });
  }

  dispose(): void {
    for (const f of this.flying) f.mesh.removeFromParent();
    for (const k of this.stuck) k.mesh.removeFromParent();
    this.flying = [];
    this.stuck = [];
  }
}
