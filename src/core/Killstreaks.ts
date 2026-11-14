import * as THREE from 'three';
import { KILLSTREAKS, type DamageSource } from '../config';
import { audio } from '../audio/AudioEngine';
import { CharacterBody } from './CharacterBody';
import type { CollisionWorld } from './CollisionWorld';
import type { Input } from './Input';
import { events } from './events';
import type { NavGraph } from '../bots/NavGraph';
import type { Combatant } from '../modes/GameMode';

/**
 * Killstreak rewards for kills in a row without dying:
 * - 3: UAV. Every enemy shows on your minimap for a while (automatic).
 * - 5: Airstrike. Press X: a jet bombs a line through where you're looking.
 * - 7: Attack dog. Press X: a dog hunts down enemies for a while.
 * Rewards you've earned but not used yet are kept when you die.
 */

export type StreakReward = 'uav' | 'airstrike' | 'dog';

export interface StreakView {
  streak: number;
  /** Seconds of UAV left (0 = off). */
  uav: number;
  /** Rewards ready to use with X, in order. */
  ready: StreakReward[];
  /** Seconds the dog has left (0 = none out). */
  dog: number;
}

export interface KillstreakDeps {
  scene: THREE.Scene;
  world: CollisionWorld;
  nav: () => NavGraph;
  input: Input;
  camera: THREE.Camera;
  player: Combatant;
  /** The player's enemies (alive or not). */
  enemies: () => readonly Combatant[];
  explode: (at: THREE.Vector3, radius: number, damage: number, attacker: string, weapon: DamageSource) => void;
  announce: (title: string, sub: string) => void;
}

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

export class Killstreaks {
  streak = 0;
  private uavLeft = 0;
  private ready: StreakReward[] = [];
  private strikes: { at: THREE.Vector3; dir: THREE.Vector3; t: number; dropped: number; jet: THREE.Group }[] = [];
  private dog: AttackDog | null = null;
  private off: () => void;

  constructor(private d: KillstreakDeps) {
    this.off = events.on('kill', (e) => {
      const me = d.player.name;
      if (e.victim === me) {
        this.streak = 0;
        return;
      }
      // Kills by the rewards themselves don't count toward the next one.
      if (e.killer !== me || e.weapon === 'airstrike' || e.weapon === 'dog') return;
      this.streak++;
      const K = KILLSTREAKS;
      if (this.streak === K.uav.kills) {
        this.uavLeft = K.uav.duration;
        d.announce('UAV online', 'Enemies show on your minimap');
        audio.play('streak_ready');
      } else if (this.streak === K.airstrike.kills) {
        this.ready.push('airstrike');
        d.announce('Airstrike ready', 'Press X to call it in where you look');
        audio.play('streak_ready');
      } else if (this.streak === K.dog.kills) {
        this.ready.push('dog');
        d.announce('Attack dog ready', 'Press X to send it hunting');
        audio.play('streak_ready');
      }
    });
  }

  get uavActive(): boolean {
    return this.uavLeft > 0;
  }

  view(): StreakView {
    return { streak: this.streak, uav: this.uavLeft, ready: this.ready, dog: this.dog?.life ?? 0 };
  }

  update(dt: number, canAct: boolean): void {
    this.uavLeft = Math.max(0, this.uavLeft - dt);
    if (canAct && this.ready.length && this.d.input.wasPressed('KeyX')) {
      const r = this.ready[0];
      if (r === 'airstrike' ? this.callAirstrike() : this.releaseDog()) this.ready.shift();
    }
    this.updateStrikes(dt);
    if (this.dog) {
      this.dog.update(dt);
      if (this.dog.life <= 0) {
        this.dog.dispose();
        this.dog = null;
      }
    }
  }

  // ---- Airstrike ---------------------------------------------------------

  private callAirstrike(): boolean {
    const { camera, world } = this.d;
    camera.getWorldPosition(_v);
    camera.getWorldDirection(_d);
    const hit = world.raycast(_v.x, _v.y, _v.z, _d.x, _d.y, _d.z, 200);
    const at = _v.clone().addScaledVector(_d, hit ? hit.distance : 60);
    if (!hit) at.y = world.groundHeight(at.x, at.z, 0.2, at.y + 50);
    if (!Number.isFinite(at.y)) return false;
    // The run goes along the way you're facing.
    const dir = new THREE.Vector3(_d.x, 0, _d.z);
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1);
    dir.normalize();
    const jet = makeJet();
    jet.visible = false;
    this.d.scene.add(jet);
    this.strikes.push({ at, dir, t: -KILLSTREAKS.airstrike.delay, dropped: 0, jet });
    this.d.announce('Airstrike inbound', '');
    audio.play('jet');
    return true;
  }

  private updateStrikes(dt: number): void {
    const A = KILLSTREAKS.airstrike;
    for (const s of this.strikes) {
      s.t += dt;
      // The jet streaks across the sky over the target.
      const along = s.t * A.jetSpeed;
      s.jet.visible = Math.abs(along) < 400;
      s.jet.position.copy(s.at).addScaledVector(s.dir, along).setY(s.at.y + A.jetHeight);
      s.jet.rotation.y = Math.atan2(-s.dir.x, -s.dir.z);
      // Bombs walk along the line, centered on the target.
      while (s.dropped < A.bombs && s.t >= s.dropped * A.bombGap) {
        const offset = (s.dropped - (A.bombs - 1) / 2) * A.bombSpacing;
        const p = s.at.clone().addScaledVector(s.dir, offset);
        const ground = this.d.world.groundHeight(p.x, p.z, 0.2, s.at.y + 3);
        if (Number.isFinite(ground)) p.y = ground + 0.3;
        this.d.explode(p, A.radius, A.damage, this.d.player.name, 'airstrike');
        s.dropped++;
      }
    }
    this.strikes = this.strikes.filter((s) => {
      if (s.t * A.jetSpeed < 400) return true;
      s.jet.removeFromParent();
      return false;
    });
  }

  // ---- Attack dog ---------------------------------------------------------

  private releaseDog(): boolean {
    if (this.dog) return false;
    this.dog = new AttackDog(this.d, this.d.player.position.clone());
    this.d.announce('Attack dog released', '');
    audio.play('bark', { position: this.d.player.position });
    return true;
  }

  dispose(): void {
    this.off();
    for (const s of this.strikes) s.jet.removeFromParent();
    this.dog?.dispose();
  }
}

/** A German-shepherd-ish dog that runs down the nearest enemy and bites. */
class AttackDog {
  life = KILLSTREAKS.dog.duration;
  private body: CharacterBody;
  private mesh: THREE.Group;
  private legs: THREE.Object3D[] = [];
  private target: Combatant | null = null;
  private path: THREE.Vector3[] = [];
  private repath = 0;
  private biteCooldown = 0;
  private gait = 0;
  private barkTimer = 2;

  constructor(private d: KillstreakDeps, at: THREE.Vector3) {
    this.body = new CharacterBody(d.world, 0.8, 0.3, 0.45, 20);
    this.body.position.copy(at);
    this.mesh = makeDog(this.legs);
    d.scene.add(this.mesh);
  }

  update(dt: number): void {
    const D = KILLSTREAKS.dog;
    this.life -= dt;
    this.biteCooldown -= dt;
    this.repath -= dt;
    const pos = this.body.position;

    // Pick the nearest living enemy, and a route to it.
    if (this.repath <= 0) {
      this.repath = 0.5;
      let best: Combatant | null = null, bestD = Infinity;
      for (const e of this.d.enemies()) {
        if (!e.isAlive()) continue;
        const dist = e.position.distanceTo(pos);
        if (dist < bestD) [best, bestD] = [e, dist];
      }
      this.target = best;
      this.path = best ? this.d.nav().findPath(pos, best.position) ?? [] : [];
    }

    // Run along the route (straight at them when close).
    let vx = 0, vz = 0;
    const t = this.target;
    if (t && t.isAlive()) {
      const close = t.position.distanceTo(pos) < 4;
      while (!close && this.path.length && Math.hypot(this.path[0].x - pos.x, this.path[0].z - pos.z) < 0.7) this.path.shift();
      const goal = close || !this.path.length ? t.position : this.path[0];
      _d.set(goal.x - pos.x, 0, goal.z - pos.z);
      const len = _d.length();
      if (len > 0.9) {
        _d.multiplyScalar(D.speed / len);
        vx = _d.x;
        vz = _d.z;
      }
      // Bite.
      if (t.position.distanceTo(pos) < D.reach && Math.abs(t.position.y - pos.y) < 1.2 && this.biteCooldown <= 0) {
        this.biteCooldown = D.biteEvery;
        audio.play('bark', { position: pos });
        t.takeDamage({ amount: D.damage, part: 'body', attacker: this.d.player.name, weapon: 'dog', from: pos.clone() });
      }
    }
    this.body.accelerate(vx, vz, 40, dt);
    this.body.step(dt);

    // Face where it's running; legs trot.
    const speed = Math.hypot(this.body.velocity.x, this.body.velocity.z);
    if (speed > 0.3) this.mesh.rotation.y = Math.atan2(-this.body.velocity.x, -this.body.velocity.z);
    this.gait += dt * speed * 2.4;
    this.legs.forEach((l, i) => (l.rotation.x = Math.sin(this.gait + (i % 2 ? Math.PI : 0) + (i > 1 ? 0.6 : 0)) * 0.7 * Math.min(1, speed / 3)));
    this.mesh.position.copy(pos);
    // Fades out at the end.
    this.mesh.visible = this.life > 0;
    this.barkTimer -= dt;
    if (this.barkTimer <= 0 && speed > 1) {
      this.barkTimer = 2 + Math.random() * 3;
      audio.play('bark', { position: pos, volume: 0.6 });
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
  }
}

function makeDog(legs: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: 0x7a5530, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.9 });
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, parent: THREE.Object3D = g) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  // Body (with a dark saddle), chest, neck, head, snout, ears, tail. Faces -Z.
  box(0.26, 0.26, 0.7, 0, 0.55, 0, fur);
  box(0.27, 0.1, 0.5, 0, 0.67, 0.04, dark);
  box(0.24, 0.28, 0.2, 0, 0.6, -0.33, fur);
  box(0.16, 0.2, 0.16, 0, 0.75, -0.42, fur);
  box(0.2, 0.18, 0.22, 0, 0.84, -0.5, fur);
  box(0.11, 0.1, 0.16, 0, 0.8, -0.67, dark);
  for (const s of [-1, 1]) box(0.05, 0.11, 0.04, s * 0.07, 0.97, -0.46, dark).rotation.z = s * 0.2;
  box(0.06, 0.06, 0.3, 0, 0.62, 0.45, dark).rotation.x = 0.6;
  // Legs (pivot at the hip, so they can swing).
  for (const [x, z] of [[-0.09, -0.27], [0.09, -0.27], [-0.09, 0.27], [0.09, 0.27]]) {
    const hip = new THREE.Group();
    hip.position.set(x, 0.46, z);
    box(0.07, 0.46, 0.07, 0, -0.23, 0, fur, hip);
    g.add(hip);
    legs.push(hip);
  }
  return g;
}

function makeJet(): THREE.Group {
  const g = new THREE.Group();
  const grey = new THREE.MeshStandardMaterial({ color: 0x5c6670, roughness: 0.5, metalness: 0.5 });
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, grey);
    m.position.set(x, y, z);
    g.add(m);
  };
  // Fuselage along -Z (nose forward), swept wings, tail fin. About 15 m long.
  add(new THREE.CylinderGeometry(0.9, 0.7, 15, 10).rotateX(Math.PI / 2), 0, 0, 0);
  add(new THREE.ConeGeometry(0.9, 3, 10).rotateX(-Math.PI / 2), 0, 0, -9);
  const wing = new THREE.Shape([new THREE.Vector2(0, -2), new THREE.Vector2(6, 2), new THREE.Vector2(6, 3.5), new THREE.Vector2(0, 3)]);
  for (const s of [-1, 1]) {
    const geo = new THREE.ExtrudeGeometry(wing, { depth: 0.2, bevelEnabled: false }).rotateX(Math.PI / 2);
    if (s < 0) geo.scale(-1, 1, 1);
    add(geo, 0, 0, 0);
  }
  add(new THREE.BoxGeometry(0.2, 3, 2.5), 0, 1.6, 6);
  return g;
}
