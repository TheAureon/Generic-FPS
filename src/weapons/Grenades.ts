import * as THREE from 'three';
import { GRENADES, TACTICAL } from '../config';
import { getSmokeTexture } from '../assets/textures';
import { vision } from '../core/vision';
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
 *
 * Also flashbangs (a blinding bang, no damage) and smoke grenades (a cloud
 * that blocks eyesight): same throw and bounce, different ending.
 */

export type GrenadeKind = 'frag' | 'flash' | 'smoke';

interface Cloud {
  center: THREE.Vector3;
  age: number;
  sprites: { s: THREE.Sprite; off: THREE.Vector3; size: number; spin: number }[];
  zone: { x: number; y: number; z: number; r: number };
}

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
  /** A flashbang went off at `at` (blind whoever can see it). */
  onFlash?: (at: THREE.Vector3, thrower: string) => void;
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
  kind: GrenadeKind;
}

export class Grenades {
  private live: Live[] = [];
  private geo: { body: THREE.BufferGeometry; cap: THREE.BufferGeometry; lever: THREE.BufferGeometry };
  private mats: { body: THREE.Material; metal: THREE.Material; light: THREE.MeshBasicMaterial };
  private _d = new THREE.Vector3();
  private _c = new THREE.Vector3();
  private clouds: Cloud[] = [];
  private smokeMat: THREE.SpriteMaterial | null = null;

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

  /** A flashbang (grey can with a white band) or smoke grenade (green can). */
  private makeCan(kind: 'flash' | 'smoke'): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: kind === 'flash' ? 0x6e7378 : 0x4a6a3c, roughness: 0.5, metalness: 0.4 });
    const band = new THREE.MeshStandardMaterial({ color: kind === 'flash' ? 0xe8e8e0 : 0xd8d0a0, roughness: 0.6 });
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 12), body));
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.02, 12), band);
    b.position.y = 0.02;
    const cap = new THREE.Mesh(this.geo.cap, this.mats.metal);
    cap.position.y = 0.075;
    g.add(b, cap);
    return g;
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

  throw(from: THREE.Vector3, velocity: THREE.Vector3, thrower: string, team: number | null, kind: GrenadeKind = 'frag'): void {
    const mesh = kind === 'frag' ? this.makeModel() : this.makeCan(kind);
    mesh.position.copy(from);
    this.d.scene.add(mesh);
    const fuse = kind === 'frag' ? GRENADES.fuse : TACTICAL[kind].fuse;
    this.live.push({ mesh, pos: from.clone(), vel: velocity.clone(), fuse, age: 0, thrower, team, resting: false, lastClink: 0, kind });
    audio.play('grenade_throw', { position: from });
  }

  /** Live grenades about to go off near `p` (for bots to run from and the HUD warning). */
  dangerNear(p: THREE.Vector3, extra = 1.5, minAge = 0): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null, bestD = GRENADES.radius + extra;
    for (const g of this.live) {
      if (g.age < minAge || g.kind !== 'frag') continue;
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
    return this.live.filter((g) => g.kind === 'frag').map((g) => g.pos);
  }

  update(dt: number): void {
    this.updateClouds(dt);
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
      if (g.kind === 'frag') {
        const blink = Math.sin(g.age * (8 + (1 - g.fuse / GRENADES.fuse) * 30)) > 0;
        (g.mesh.children[3] as THREE.Mesh).visible = blink;
      }
      if (g.fuse <= 0) {
        if (g.kind === 'frag') this.explode(g);
        else if (g.kind === 'flash') this.flash(g);
        else this.smoke(g);
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

  private flash(g: Live): void {
    const at = g.pos.clone().setY(g.pos.y + 0.1);
    this.d.effects.flashBang(at);
    audio.play('flashbang', { position: at });
    events.emit('noise', { source: g.thrower, position: at.clone(), hearingRange: GRENADES.hearingRange });
    this.d.onFlash?.(at, g.thrower);
  }

  /** A smoke grenade: a cloud of big grey puffs that swells, hangs, then thins out. */
  private smoke(g: Live): void {
    const T = TACTICAL.smoke;
    audio.play('smoke_pop', { position: g.pos });
    this.smokeMat ??= new THREE.SpriteMaterial({ map: getSmokeTexture(), color: 0xc4c4c0, depthWrite: false, transparent: true, opacity: 0 });
    const center = g.pos.clone().setY(g.pos.y + 1);
    const sprites: Cloud['sprites'] = [];
    for (let i = 0; i < 22; i++) {
      const s = new THREE.Sprite(this.smokeMat.clone());
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * T.radius * 0.75;
      const off = new THREE.Vector3(Math.cos(a) * r, (Math.random() - 0.3) * T.radius * 0.5, Math.sin(a) * r);
      s.position.copy(center).add(off);
      this.d.scene.add(s);
      sprites.push({ s, off, size: T.radius * (0.9 + Math.random() * 0.7), spin: (Math.random() - 0.5) * 0.3 });
    }
    const zone = vision.add({ x: center.x, y: center.y, z: center.z, r: 0 });
    this.clouds.push({ center, age: 0, sprites, zone });
  }

  private updateClouds(dt: number): void {
    const T = TACTICAL.smoke;
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      c.age += dt;
      // Swells over 1.5 s, holds, then thins out over the last 3 s.
      const grow = Math.min(1, c.age / 1.5);
      const fade = Math.min(1, Math.max(0, (T.duration - c.age) / 3));
      c.zone.r = T.radius * grow * (fade > 0.35 ? 1 : fade / 0.35);
      for (const sp of c.sprites) {
        const k = 0.4 + 0.6 * grow;
        sp.s.position.copy(c.center).addScaledVector(sp.off, k);
        sp.s.position.y += c.age * 0.04;
        sp.s.scale.setScalar(sp.size * k);
        const m = sp.s.material as THREE.SpriteMaterial;
        m.opacity = 0.92 * grow * fade;
        m.rotation += sp.spin * dt;
      }
      if (c.age >= T.duration) {
        for (const sp of c.sprites) {
          sp.s.removeFromParent();
          (sp.s.material as THREE.Material).dispose();
        }
        vision.remove(c.zone);
        this.clouds.splice(i, 1);
      }
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
    for (const c of this.clouds) for (const sp of c.sprites) sp.s.removeFromParent();
    this.clouds = [];
    vision.clear();
  }
}
