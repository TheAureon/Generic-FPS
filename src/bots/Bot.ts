import * as THREE from 'three';
import { BOT_DIFFICULTY, BOTS, type Difficulty } from '../config';
import { audio } from '../audio/AudioEngine';
import type { SoundId } from '../audio/sounds';
import { createCharacterModel, type CharacterModel } from '../assets/characterModel';
import { createWeaponModel } from '../assets/weaponModels';
import { CharacterBody } from '../core/CharacterBody';
import type { CollisionWorld } from '../core/CollisionWorld';
import { CharacterHitbox, type Damageable, type DamageInfo } from '../core/Hitbox';
import { events } from '../core/events';
import type { Effects } from '../effects/Effects';
import type { SpawnPoint } from '../map/MapTypes';
import type { Trackable } from '../player/Player';
import { shotDamage, traceShot } from '../weapons/hitscan';
import { Weapon } from '../weapons/Weapon';
import { anglesTo, BotAim } from './BotAim';
import { Perception } from './Perception';

const DEG = Math.PI / 180;

export interface BotContext {
  world: CollisionWorld;
  scene: THREE.Scene;
  effects: Effects;
  /** Things this bot's bullets can hit (its enemies). */
  getEnemies: () => readonly Damageable[];
  /** Who hears near-miss "whiz" sounds (the player). */
  listener: Trackable;
}

/**
 * A bot's body: health, movement, gun, model, and animation.
 * The decisions (where to go, when to shoot) are made by its brain.
 */
export class Bot implements Damageable, Trackable {
  readonly hitbox = new CharacterHitbox(BOTS.height, BOTS.radius, 0.16);
  readonly body: CharacterBody;
  readonly model: CharacterModel;
  readonly weapon: Weapon;
  readonly perception = new Perception();
  readonly aim = new BotAim();
  readonly skill;
  health: number = BOTS.maxHealth;
  /** Seconds until respawn while dead. */
  respawnTimer = 0;
  /** Current brain state, shown for debugging. */
  state = 'idle';

  /** Where the brain wants to walk (null = stand still), and how fast. */
  moveTarget: THREE.Vector3 | null = null;
  moveSpeed: number = BOTS.walkSpeed;
  /** If set, the bot moves in this direction instead (for strafing). */
  moveDir: THREE.Vector3 | null = null;

  private weaponModel: THREE.Group;
  private muzzle: THREE.Object3D;
  private walkPhase = 0;
  private flash = 0;
  private fall = 0;
  private _eye = new THREE.Vector3();
  private _dir = new THREE.Vector3();
  private _muzzle = new THREE.Vector3();

  constructor(
    readonly name: string,
    difficulty: Difficulty,
    private ctx: BotContext,
  ) {
    this.skill = BOT_DIFFICULTY[difficulty];
    this.body = new CharacterBody(ctx.world, BOTS.height, BOTS.radius, 0.45, 20);
    this.model = createCharacterModel(0xb8402f, 0x2c2f33);
    this.model.root.rotation.order = 'YXZ';
    this.weaponModel = createWeaponModel(BOTS.weapon);
    // Slightly oversized so it reads clearly at a distance.
    this.weaponModel.scale.setScalar(1.3);
    this.weaponModel.position.set(-0.04, 0, 0.12);
    this.weaponModel.traverse((o) => (o.castShadow = true));
    this.model.hand.add(this.weaponModel);
    this.muzzle = this.weaponModel.getObjectByName('muzzle')!;
    ctx.scene.add(this.model.root);

    this.weapon = new Weapon(BOTS.weapon);
  }

  get position(): THREE.Vector3 {
    return this.body.position;
  }
  get velocity(): THREE.Vector3 {
    return this.body.velocity;
  }
  get height(): number {
    return BOTS.height;
  }

  isAlive(): boolean {
    return this.health > 0;
  }

  eyePosition(out = this._eye): THREE.Vector3 {
    return out.set(this.position.x, this.position.y + BOTS.eyeHeight, this.position.z);
  }

  spawn(sp: SpawnPoint): void {
    this.health = BOTS.maxHealth;
    this.respawnTimer = 0;
    this.fall = 0;
    this.body.position.set(sp.x, sp.y, sp.z);
    this.body.velocity.set(0, 0, 0);
    this.aim.yaw = sp.yaw * DEG;
    this.aim.pitch = 0;
    this.weapon.ammo = this.weapon.stats.magazineSize;
    this.weapon.cancelReload();
    this.perception.reset();
    this.moveTarget = null;
    this.moveDir = null;
    this.state = 'idle';
    this.model.root.visible = true;
    this.syncModel();
  }

  takeDamage(info: DamageInfo): boolean {
    if (!this.isAlive()) return false;
    this.health -= info.amount;
    this.flash = 1;
    // Getting shot tells the bot roughly where the shooter is.
    this.perception.alertFrom(info.from);
    const killed = this.health <= 0;
    events.emit('damage', { attacker: info.attacker, victim: this.name, amount: info.amount, part: info.part, killed });
    if (killed) {
      this.health = 0;
      this.respawnTimer = BOTS.respawnDelay;
      this.moveTarget = null;
      this.moveDir = null;
      this.state = 'dead';
      audio.play('bot_death', { position: this.position });
      events.emit('kill', { killer: info.attacker, victim: this.name, weapon: info.weapon, headshot: info.part === 'head' });
    }
    return killed;
  }

  /** Aim direction toward a point, for the brain. */
  anglesTo(point: THREE.Vector3): { yaw: number; pitch: number } {
    return anglesTo(this.eyePosition(), point);
  }

  /**
   * Pull the trigger once (if the gun is ready). `errorDeg` is the extra aim
   * error on top of the gun's own spread.
   */
  tryFire(): boolean {
    const w = this.weapon;
    if (w.ammo <= 0 && !w.reloading) {
      w.reserve = 999; // bots never run out of spare ammo
      w.startReload();
      return false;
    }
    if (!w.canFire()) return false;
    w.fire();

    const { world, effects } = this.ctx;
    const origin = this.eyePosition();
    this.model.root.updateMatrixWorld(true);
    this.muzzle.getWorldPosition(this._muzzle);

    for (let p = 0; p < w.stats.pellets; p++) {
      this.aim.shotDirection(w.stats.baseSpread, this._dir);
      const r = traceShot(world, this.ctx.getEnemies(), origin, this._dir, w.stats.range, this);
      if (p < 3) effects.tracer(this._muzzle, r.point);
      if (r.target && r.part) {
        const dmg = shotDamage(w.stats, r.distance, r.part) * this.skill.damageMultiplier;
        r.target.takeDamage({ amount: dmg, part: r.part, attacker: this.name, weapon: w.id, from: origin.clone() });
        effects.bloodPuff(r.point, this._dir);
      } else {
        if (r.normal) effects.impact(r.point, r.normal);
        this.nearMissSound(origin, this._dir, r.distance);
      }
    }

    effects.worldFlash(this._muzzle);
    audio.play(`shot_${w.id}` as SoundId, { position: this._muzzle });
    events.emit('shot', { shooter: this.name, weapon: w.id, position: origin.clone(), hearingRange: w.stats.hearingRange });
    return true;
  }

  /** Bullets that fly close past the player's head make a "whiz". */
  private nearMissSound(origin: THREE.Vector3, dir: THREE.Vector3, dist: number): void {
    const l = this.ctx.listener;
    if (!l.isAlive()) return;
    const hx = l.position.x - origin.x, hy = l.position.y + l.height - 0.1 - origin.y, hz = l.position.z - origin.z;
    const t = hx * dir.x + hy * dir.y + hz * dir.z;
    if (t <= 0 || t > dist) return;
    const missBy = Math.hypot(hx - dir.x * t, hy - dir.y * t, hz - dir.z * t);
    if (missBy < 1.5) {
      const at = origin.clone().addScaledVector(dir, t);
      audio.play('whiz', { position: at, volume: 1.4 - missBy * 0.6 });
    }
  }

  /** Movement, at the fixed physics rate. */
  physicsStep(dt: number): void {
    if (!this.isAlive()) {
      // Dead bodies still fall to the floor.
      this.body.accelerate(0, 0, BOTS.acceleration, dt);
      this.body.step(dt);
      return;
    }
    let tvx = 0, tvz = 0;
    if (this.moveDir) {
      tvx = this.moveDir.x * this.moveSpeed;
      tvz = this.moveDir.z * this.moveSpeed;
    } else if (this.moveTarget) {
      const dx = this.moveTarget.x - this.position.x, dz = this.moveTarget.z - this.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.15) {
        // Slow down when arriving.
        const speed = Math.min(this.moveSpeed, d * 4);
        tvx = (dx / d) * speed;
        tvz = (dz / d) * speed;
      }
    }
    this.body.accelerate(tvx, tvz, BOTS.acceleration, dt);
    this.body.step(dt);
  }

  /** Timers, animation, and keeping the model and hitbox in place. */
  update(dt: number): void {
    const w = this.weapon;
    w.update(dt);

    if (!this.isAlive()) {
      this.respawnTimer -= dt;
      this.fall = Math.min(1, this.fall + dt * 2.5);
    }
    this.flash = Math.max(0, this.flash - dt * 8);
    for (const m of this.model.materials) m.emissive.setRGB(this.flash * 0.7, this.flash * 0.25, this.flash * 0.2);
    this.syncModel();

    // Walk animation: swing legs and arms based on speed.
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.isAlive()) {
      this.walkPhase += dt * speed * 2.2;
      const swing = Math.sin(this.walkPhase) * Math.min(1, speed / BOTS.walkSpeed) * 0.6;
      this.model.leftLeg.rotation.x = swing;
      this.model.rightLeg.rotation.x = -swing;
      // Lean the upper body to aim up/down.
      this.model.upper.rotation.x = this.aim.pitch * 0.8;
    }
  }

  private syncModel(): void {
    const root = this.model.root;
    root.position.copy(this.position);
    root.rotation.y = this.aim.yaw;
    // Death: fall backward.
    const f = this.fall * this.fall * (3 - 2 * this.fall);
    root.rotation.x = f * Math.PI * 0.5;
    this.hitbox.setPosition(this.position);
  }

  /** Hide the body (before respawning somewhere else). */
  hide(): void {
    this.model.root.visible = false;
  }
}
