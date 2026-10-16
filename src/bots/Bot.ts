import * as THREE from 'three';
import { BOT_DIFFICULTY, BOTS, type Difficulty } from '../config';
import { audio } from '../audio/AudioEngine';
import type { SoundId } from '../audio/sounds';
import { createCharacterModel, type CharacterModel } from '../assets/characterModel';
import { mergeMeshes } from '../assets/mergeMeshes';
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
import { CharacterAnimator, RIFLE_GRIPS } from './CharacterAnimator';
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
  /** Colored light from nearby map lamps at a point (tints the body). */
  sampleLight?: (p: THREE.Vector3, out: THREE.Color) => THREE.Color;
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
  skill: (typeof BOT_DIFFICULTY)[Difficulty];
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
  /** Slow down when reaching moveTarget (true for the end of a path). */
  slowOnArrive = true;

  /** Who shot this bot last, and when (seconds of bot time). */
  lastAttacker: string | null = null;
  lastDamagedAt = -Infinity;
  /** Seconds since this bot was created (its own clock). */
  time = 0;

  private weaponModel: THREE.Group;
  private muzzle: THREE.Object3D;
  readonly anim: CharacterAnimator;
  private flash = 0;
  private lightTimer = Math.random() * 0.25;
  private lightTarget = new THREE.Color();
  private _lightPos = new THREE.Vector3();

  // Death.
  /** Seconds since death (-1 while alive). */
  private deathTime = -1;
  /** The gun's resting place in the hand (restored on respawn). */
  private gunHome = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  private gunVel = new THREE.Vector3();
  private gunSpin = new THREE.Vector3();
  private gunResting = true;
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
    this.model = createCharacterModel(0xb8402f, 0x3f444c);
    this.weaponModel = createWeaponModel(BOTS.weapon);
    // Slightly oversized so it reads clearly at a distance.
    this.weaponModel.scale.setScalar(1.1);
    // One mesh for the whole gun (cheaper to draw).
    mergeMeshes(this.weaponModel, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 }));
    this.model.hand.add(this.weaponModel);
    this.anim = new CharacterAnimator(this.model, this.weaponModel, RIFLE_GRIPS);
    this.anim.onStep = (speed) => {
      if (speed > 1.5) audio.play('step', { position: this.position, volume: 0.5 + speed * 0.08 });
    };
    this.gunHome.pos.copy(this.weaponModel.position);
    this.gunHome.quat.copy(this.weaponModel.quaternion);
    this.muzzle = this.weaponModel.getObjectByName('muzzle')!;
    ctx.scene.add(this.model.root);
    this.model.root.visible = false; // until spawned

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

  heal(amount: number): void {
    this.health = Math.min(BOTS.maxHealth, this.health + amount);
  }

  eyePosition(out = this._eye): THREE.Vector3 {
    return out.set(this.position.x, this.position.y + BOTS.eyeHeight, this.position.z);
  }

  spawn(sp: SpawnPoint): void {
    this.health = BOTS.maxHealth;
    this.respawnTimer = 0;
    this.resetPose();
    this.body.position.set(sp.x, sp.y, sp.z);
    this.body.velocity.set(0, 0, 0);
    this.aim.yaw = sp.yaw * DEG;
    this.aim.pitch = 0;
    this.weapon.ammo = this.weapon.stats.magazineSize;
    this.weapon.cancelReload();
    this.perception.reset();
    this.lastAttacker = null;
    this.lastDamagedAt = -Infinity;
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
    this.anim.hit();
    this.lastAttacker = info.attacker;
    this.lastDamagedAt = this.time;
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
      this.startDeath(info.from, info.part === 'head');
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
    this.anim.fire();

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
        const speed = this.slowOnArrive ? Math.min(this.moveSpeed, d * 4) : this.moveSpeed;
        tvx = (dx / d) * speed;
        tvz = (dz / d) * speed;
      }
    }
    this.body.accelerate(tvx, tvz, BOTS.acceleration, dt);
    this.body.step(dt);
  }

  /** Timers, animation, and keeping the model and hitbox in place. */
  update(dt: number): void {
    this.time += dt;
    const w = this.weapon;
    w.update(dt);

    this.flash = Math.max(0, this.flash - dt * 8);
    const mat = this.model.material;
    mat.emissive.setRGB(this.flash * 0.7, this.flash * 0.25, this.flash * 0.2);

    // Pick up the color of nearby lamps (checked a few times a second, blended smoothly).
    if (this.ctx.sampleLight) {
      this.lightTimer -= dt;
      if (this.lightTimer <= 0) {
        this.lightTimer = 0.25;
        this._lightPos.set(this.position.x, this.position.y + 1.2, this.position.z);
        this.ctx.sampleLight(this._lightPos, this.lightTarget);
      }
      mat.lampLight.lerp(this.lightTarget, 1 - Math.exp(-dt * 6));
    }

    if (!this.isAlive()) {
      this.respawnTimer -= dt;
      this.deathTime += dt;
      this.animateDeath(dt);
      return;
    }
    this.syncModel();
    this.anim.update(dt, {
      velocity: this.velocity,
      onGround: this.body.onGround,
      yaw: this.aim.yaw,
      pitch: this.aim.pitch,
      reload: w.reloading ? w.reloadProgress : -1,
      runSpeed: BOTS.runSpeed,
    });
  }

  private syncModel(): void {
    const root = this.model.root;
    root.position.copy(this.position);
    this.hitbox.setPosition(this.position);
  }

  /** Back to the standing pose, gun in hand. */
  private resetPose(): void {
    const m = this.model;
    this.deathTime = -1;
    if (this.weaponModel.parent !== m.hand) m.hand.add(this.weaponModel);
    this.weaponModel.position.copy(this.gunHome.pos);
    this.weaponModel.quaternion.copy(this.gunHome.quat);
    this.gunResting = true;
    this.anim.reset();
  }

  private startDeath(from: THREE.Vector3, headshot: boolean): void {
    this.deathTime = 0;
    this.anim.startDeath(headshot);
    // Face the shooter, so the body falls backward, away from the shot.
    this.aim.yaw = Math.atan2(-(from.x - this.position.x), -(from.z - this.position.z));
    this.aim.pitch = 0;
    // Drop the gun: it flies off with its own little bit of physics.
    this.model.root.updateMatrixWorld(true);
    this.ctx.scene.attach(this.weaponModel);
    const side = Math.random() < 0.5 ? -1 : 1;
    const yaw = this.aim.yaw;
    this.gunVel.set(Math.cos(yaw) * side * 1.2 + (Math.random() - 0.5), 2.2 + Math.random(), -Math.sin(yaw) * side * 1.2 + (Math.random() - 0.5));
    this.gunSpin.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
    this.gunResting = false;
  }

  /** Falling over, limbs going limp, the gun clattering, then sinking away. */
  private animateDeath(dt: number): void {
    const root = this.model.root;
    root.position.copy(this.position);
    this.hitbox.setPosition(this.position);

    this.anim.update(dt, { velocity: this.velocity, onGround: true, yaw: this.aim.yaw, pitch: 0, reload: -1, runSpeed: BOTS.runSpeed });

    // Before respawning, sink into the floor.
    const sink = this.respawnTimer < 1.2 ? (1.2 - Math.max(0, this.respawnTimer)) * 0.8 : 0;
    root.position.y -= sink;

    // The dropped gun: fall, bounce, come to rest on its side.
    const gun = this.weaponModel;
    if (!this.gunResting) {
      this.gunVel.y -= 14 * dt;
      gun.position.addScaledVector(this.gunVel, dt);
      gun.rotation.x += this.gunSpin.x * dt;
      gun.rotation.y += this.gunSpin.y * dt;
      gun.rotation.z += this.gunSpin.z * dt;
      const ground = this.ctx.world.groundHeight(gun.position.x, gun.position.z, 0.05, gun.position.y + 0.3) + 0.06;
      if (gun.position.y <= ground && this.gunVel.y < 0) {
        gun.position.y = ground;
        if (this.gunVel.y < -2.5) {
          this.gunVel.y *= -0.3;
          this.gunVel.x *= 0.5;
          this.gunVel.z *= 0.5;
          this.gunSpin.multiplyScalar(0.4);
          audio.play('impact', { position: gun.position, volume: 0.7 });
        } else {
          this.gunResting = true;
          gun.rotation.set(0, gun.rotation.y, Math.PI / 2);
        }
      }
    } else if (sink > 0) {
      gun.position.y -= sink * dt * 0.9;
    }
  }

  /** Hide the body (before respawning somewhere else). */
  hide(): void {
    this.model.root.visible = false;
    this.resetPose();
  }
}
