import * as THREE from 'three';
import { BOTS } from '../config';
import type { CollisionWorld } from '../core/CollisionWorld';
import type { Trackable } from '../player/Player';
import type { BotObjective } from '../modes/GameMode';
import type { Bot } from './Bot';
import { angleDiff } from './BotAim';
import type { NavGraph } from './NavGraph';
import { Navigator } from './Navigator';

export interface BrainContext {
  world: CollisionWorld;
  nav: NavGraph;
  /** Everyone this bot may fight (may include itself; it's skipped). */
  getEnemies: () => readonly Trackable[];
  /** Optional: where to find health when hurt (used once pickups exist). */
  findHealth?: (from: THREE.Vector3) => THREE.Vector3 | null;
  /** Optional: where to find ammo (`includeTaken`: also spots where it will come back). */
  findAmmo?: (from: THREE.Vector3, maxDist?: number, includeTaken?: boolean) => THREE.Vector3 | null;
  /** Optional: what the game mode wants this bot to do (hold a hill, take a flag...). */
  objective?: () => BotObjective | null;
}

/**
 * The bot's states:
 *   patrol      → wander between spots on the map
 *   investigate → heard a gunshot or got hit by someone unseen: go look
 *   attack      → can see an enemy: aim, shoot in bursts, strafe, keep distance
 *   cover       → under fire: run to a spot the enemy can't see, reload, then peek
 *   retreat     → low health: run away to a hidden spot (or to health)
 *   resupply    → out of (or low on) ammo: go get an ammo pickup, wait there if it's been taken
 *   chase       → lost sight of the enemy: go to where it was last seen
 *   search      → reached the last known position: look around nearby spots
 */
export type BotState = 'patrol' | 'investigate' | 'attack' | 'cover' | 'retreat' | 'resupply' | 'chase' | 'search' | 'dead';

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1));

type Look = { kind: 'path' } | { kind: 'point'; p: THREE.Vector3 } | { kind: 'none' };

export class BotBrain {
  state: BotState = 'patrol';
  target: Trackable | null = null;
  readonly navigator: Navigator;

  private stateTime = 0;
  private prevState: BotState = 'patrol';
  private scanTimer = 0;
  private decideTimer = 0;
  private strafing = false;
  private strafeSign = 1;
  private strafeTimer = 0;
  private burstLeft = 0;
  private burstPause = 0;
  private holdTimer = -1;
  private pauseTimer = 0;
  private lookTimer = 0;
  private lookBaseYaw = 0;
  private coverCooldown = 0;
  private retreatCooldown = 0;
  private resupplyGiveUp = 0;
  private coverDecisionTimer = 0;
  private searchPoints: THREE.Vector3[] = [];
  private searchIndex = 0;
  private searchTimer = 0;
  /** What the game mode wants us to do right now (checked every frame). */
  private obj: BotObjective | null = null;

  /** How the bot moves this frame: along a path, straight to a point, or not at all. */
  private moveMode: 'nav' | 'direct' | 'stop' = 'stop';
  private directPoint = new THREE.Vector3();
  private speed: number = BOTS.walkSpeed;
  private look: Look = { kind: 'path' };

  private readonly dest = new THREE.Vector3();
  private readonly _v = new THREE.Vector3();
  private readonly _aim = new THREE.Vector3();
  private readonly _threat = new THREE.Vector3();

  constructor(
    readonly bot: Bot,
    private ctx: BrainContext,
  ) {
    this.navigator = new Navigator(ctx.nav, bot.position);
  }

  private get now(): number {
    return this.bot.time;
  }

  reset(): void {
    this.target = null;
    this.navigator.clear();
    this.burstLeft = 0;
    this.burstPause = 0;
    this.coverCooldown = 0;
    this.retreatCooldown = 0;
    this.enter('patrol');
  }

  private enter(state: BotState): void {
    this.prevState = this.state;
    this.state = state;
    this.stateTime = 0;
    this.decideTimer = 0;
    this.holdTimer = -1;
    this.pauseTimer = 0;
    this.lookTimer = 0;
    this.navigator.clear();
    this.bot.state = state;

    const p = this.bot.perception;
    switch (state) {
      case 'patrol':
        this.pickPatrolGoal();
        break;
      case 'investigate':
        this.lookTimer = 0.6; // first turn toward the sound
        break;
      case 'cover': {
        this.threatPoint(this._threat);
        const c = this.findCover(this._threat);
        if (!c) {
          this.coverCooldown = this.now + 4;
          this.state = 'attack';
          this.bot.state = 'attack';
        } else {
          this.dest.copy(c);
        }
        break;
      }
      case 'retreat': {
        this.retreatCooldown = this.now + 20;
        this.threatPoint(this._threat);
        const r = this.ctx.findHealth?.(this.bot.position) ?? this.findRetreat(this._threat);
        if (!r) {
          this.state = 'attack';
          this.bot.state = 'attack';
        } else {
          this.dest.copy(r);
        }
        break;
      }
      case 'resupply': {
        // Out of ammo: the nearest ammo, even if it's been taken (wait for it).
        // Just low: only if one is available and not too far.
        const out = this.bot.outOfAmmo;
        const a = this.ctx.findAmmo?.(this.bot.position, out ? Infinity : 35, out);
        if (!a) {
          this.state = 'patrol';
          this.bot.state = 'patrol';
          this.pickPatrolGoal();
        } else {
          this.dest.copy(a);
          this.resupplyGiveUp = this.now + 45;
        }
        break;
      }
      case 'chase':
        // Head to where the enemy was last seen, a little ahead in the direction it was moving.
        this.dest.copy(p.lastSeenPos).addScaledVector(p.lastSeenVelocity, 0.6);
        break;
      case 'search':
        this.planSearch(p.hasLastSeen ? p.lastSeenPos : p.hasNoise ? p.noisePos : this.bot.position);
        break;
    }
  }

  // ---------------------------------------------------------------------------

  update(dt: number): void {
    const bot = this.bot;
    if (!bot.isAlive()) {
      if (this.state !== 'dead') this.enter('dead');
      bot.moveTarget = null;
      bot.moveDir = null;
      return;
    }
    if (this.state === 'dead') this.reset();
    this.stateTime += dt;

    this.scanForTargets(dt);
    this.obj = this.ctx.objective?.() ?? null;
    const urgent = !!this.obj?.urgent;
    const p = bot.perception;
    p.update(dt, bot.eyePosition(), bot.aim.yaw, this.target, this.ctx.world);

    // ---- Transitions that can happen from (almost) any state -------------
    const hp = bot.health / BOTS.maxHealth;
    const underFire = this.now - bot.lastDamagedAt < 2;
    const dist = this.target ? this.flatDist(this.target.position) : Infinity;
    const retreatAt = 0.35 - bot.skill.aggression * 0.15;
    if (
      hp <= retreatAt && !urgent && this.state !== 'retreat' && this.now > this.retreatCooldown &&
      (p.canSee || underFire) && !(p.canSee && dist < 5)
    ) {
      this.enter('retreat');
    } else if (bot.outOfAmmo && this.state !== 'resupply' && this.state !== 'retreat' && this.ctx.findAmmo?.(bot.position, Infinity, true)) {
      // Nothing left to shoot: go get ammo (like the player has to).
      this.enter('resupply');
    } else if (p.canSee && !bot.outOfAmmo && (this.state === 'patrol' || this.state === 'investigate' || this.state === 'chase' || this.state === 'search')) {
      this.enter('attack');
    }

    // ---- Per-state behavior --------------------------------------------
    this.moveMode = 'stop';
    this.look = { kind: 'path' };
    switch (this.state) {
      case 'patrol': this.patrol(dt); break;
      case 'investigate': this.investigate(dt); break;
      case 'attack': this.attack(dt); break;
      case 'cover': this.cover(dt); break;
      case 'retreat': this.retreat(dt); break;
      case 'resupply': this.resupply(dt); break;
      case 'chase': this.chase(); break;
      case 'search': this.search(dt); break;
    }

    this.applyMovement(dt);
    bot.state = this.state;
  }

  // ---- States ----------------------------------------------------------

  private patrol(dt: number): void {
    const p = this.bot.perception;
    const obj = this.obj;
    if (p.hasNoise && !obj?.urgent) return this.enter('investigate');
    const nav = this.navigator;
    if (obj) {
      // On the way to the objective: go straight there.
      if (this.flatDist(obj.pos) > obj.radius) {
        this.dest.copy(obj.pos);
        this.moveAlongPath(this.dest, obj.run ? BOTS.runSpeed : BOTS.walkSpeed);
        return;
      }
      // There: keep moving between spots inside the area (re-pick if the area moved).
      if (Math.hypot(this.dest.x - obj.pos.x, this.dest.z - obj.pos.z) > obj.radius + 0.5) {
        this.pickPatrolGoal();
        nav.clear();
      }
    }
    // Low on spare ammo and there's some nearby? Go get it.
    if (this.bot.lowOnAmmo && this.stateTime < 0.1 && this.ctx.findAmmo?.(this.bot.position, 35)) return this.enter('resupply');
    // Hurt and there's health nearby? Go get it.
    if (this.bot.health < BOTS.maxHealth * 0.7 && this.stateTime < 0.1) {
      const h = this.ctx.findHealth?.(this.bot.position);
      if (h && this.flatDist(h) < 30) this.dest.copy(h);
    }
    if (nav.hasGoal && (nav.arrived || nav.failed)) {
      // Got there (or can't): pause and look around a moment, then pick another spot.
      if (this.pauseTimer <= 0) {
        this.pauseTimer = obj ? rand(0.3, 1.0) : rand(0.6, 1.8);
        this.lookBaseYaw = this.bot.aim.yaw;
      }
      this.pauseTimer -= dt;
      this.lookAround(dt);
      if (this.pauseTimer <= 0) {
        this.pickPatrolGoal();
        nav.clear();
      }
      return;
    }
    // (Also starts the walk to a newly picked spot.)
    this.moveAlongPath(this.dest, BOTS.walkSpeed * 0.75);
  }

  private investigate(dt: number): void {
    const p = this.bot.perception;
    if (this.obj?.urgent) return this.enter('patrol');
    if (!p.hasNoise) return this.enter('search');
    if (this.lookTimer > 0) {
      // Turn toward the sound before walking over.
      this.lookTimer -= dt;
      this.look = { kind: 'point', p: p.noisePos };
      return;
    }
    this.moveAlongPath(p.noisePos, BOTS.walkSpeed * 1.25);
    if (this.navigator.arrived || this.navigator.failed) {
      p.clearNoise();
      this.enter('search');
    }
  }

  private attack(dt: number): void {
    const bot = this.bot;
    const p = bot.perception;
    const target = this.target;
    if (!target || !target.isAlive()) return this.enter('patrol');

    // The objective can't wait: shoot while moving toward it.
    if (this.obj?.urgent) {
      if (p.canSee) this.engage(dt, true);
      else if (p.timeSinceSeen > 0.5) return this.enter('patrol');
      this.moveAlongPath(this.obj.pos, this.obj.run ? BOTS.runSpeed : BOTS.walkSpeed);
      if (p.canSee) this.look = { kind: 'none' };
      return;
    }

    if (!p.canSee) {
      // Lost sight: keep looking where it was for a moment, then go after it.
      this.look = { kind: 'point', p: this._v.copy(p.lastSeenPos).setY(p.lastSeenPos.y + 1.4) };
      if (p.timeSinceSeen > 0.5) return this.enter('chase');
    } else {
      this.engage(dt, true);
      this.look = { kind: 'none' };
    }

    // Under fire? Maybe duck into cover (cautious bots more often).
    this.coverDecisionTimer -= dt;
    const underFire = this.now - bot.lastDamagedAt < 1.5;
    if (underFire && this.coverDecisionTimer <= 0 && this.now > this.coverCooldown) {
      this.coverDecisionTimer = 1;
      const hp = bot.health / BOTS.maxHealth;
      let chance = 0.15 + (1 - bot.skill.aggression) * 0.4;
      if (hp < 0.6) chance += 0.25;
      if (bot.weapon.reloading) chance += 0.3;
      if (Math.random() < chance) return this.enter('cover');
    }

    // Movement: close in if far, back off if too close, otherwise strafe.
    this.decideTimer -= dt;
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeTimer = rand(0.8, 2.2);
      this.strafeSign = Math.random() < 0.5 ? -1 : 1;
    }
    const tp = target.position;
    const dist = this.flatDist(tp);
    const farRange = BOTS.preferredRange * (1.3 - bot.skill.aggression * 0.6);
    if (dist > farRange || !p.canSee) {
      this.moveAlongPath(p.canSee ? tp : p.lastSeenPos, BOTS.walkSpeed);
      if (p.canSee) this.look = { kind: 'none' };
      return;
    }
    if (this.decideTimer <= 0) {
      // Re-decide a few times a second: back off if too close, else strafe.
      this.decideTimer = rand(0.3, 0.6);
      const away = this._v.set(bot.position.x - tp.x, 0, bot.position.z - tp.z).normalize();
      const sx = -away.z * this.strafeSign, sz = away.x * this.strafeSign;
      this.strafing =
        (dist < BOTS.minRange && this.tryDirect(away.x * 2.5, away.z * 2.5)) ||
        this.tryDirect(sx * 2.5, sz * 2.5) ||
        ((this.strafeSign = -this.strafeSign), this.tryDirect(-sx * 2.5, -sz * 2.5));
    }
    this.moveMode = this.strafing ? 'direct' : 'stop';
    this.speed = BOTS.walkSpeed * 0.8;
  }

  private cover(dt: number): void {
    const bot = this.bot;
    const p = bot.perception;
    const nav = this.navigator;
    if (this.obj?.urgent) return this.enter(p.canSee ? 'attack' : 'patrol');
    if (this.holdTimer < 0) {
      // Running to cover; shoot back if the enemy is in view.
      this.moveAlongPath(this.dest, BOTS.runSpeed);
      if (p.canSee) {
        this.engage(dt, true);
        this.look = { kind: 'none' };
      }
      if (nav.failed) return this.enter('attack');
      if (nav.arrived) {
        this.holdTimer = rand(1.5, 3.2) * (1.4 - bot.skill.aggression);
        if (bot.weapon.ammo < bot.weapon.stats.magazineSize * 0.6) bot.weapon.startReload();
      }
      return;
    }
    // In cover: wait, facing where the enemy was.
    this.look = { kind: 'point', p: this.threatPoint(this._threat) };
    if (p.canSee && !bot.weapon.reloading) return this.enter('attack'); // they found us: fight
    this.holdTimer -= dt;
    if (this.holdTimer <= 0 && !bot.weapon.reloading) {
      this.coverCooldown = this.now + 5;
      this.enter(p.hasLastSeen ? 'chase' : 'search'); // peek out toward them
    }
  }

  private retreat(dt: number): void {
    const bot = this.bot;
    const p = bot.perception;
    const nav = this.navigator;
    if (this.obj?.urgent) return this.enter(p.canSee ? 'attack' : 'patrol');
    if (this.holdTimer < 0) {
      this.moveAlongPath(this.dest, BOTS.runSpeed);
      if (p.canSee) {
        this.engage(dt, true); // fire back while backing away
        this.look = { kind: 'none' };
        if (this.target && this.flatDist(this.target.position) < 5) return this.enter('attack'); // cornered
      }
      if (nav.failed) return this.enter('attack');
      if (nav.arrived) this.holdTimer = 5;
      return;
    }
    // Hiding: reload, watch, and fight if found.
    this.look = { kind: 'point', p: this.threatPoint(this._threat) };
    if (bot.weapon.ammo < bot.weapon.stats.magazineSize) bot.weapon.startReload();
    if (p.canSee) return this.enter('attack');
    this.holdTimer -= dt;
    if (this.holdTimer <= 0) this.enter('patrol');
  }

  private resupply(dt: number): void {
    const bot = this.bot;
    const p = bot.perception;
    const nav = this.navigator;
    // Got what we came for (picked up on arrival, or along the way).
    if (!bot.lowOnAmmo || this.now > this.resupplyGiveUp) {
      if (bot.weapon.ammo < bot.weapon.stats.magazineSize) bot.weapon.startReload();
      return this.enter(p.hasLastSeen ? 'search' : 'patrol');
    }
    if (this.holdTimer < 0) {
      this.moveAlongPath(this.dest, bot.outOfAmmo ? BOTS.runSpeed : BOTS.walkSpeed * 1.2);
      // Shoot back with whatever is left in the gun; with nothing left, just keep running.
      if (p.canSee && !bot.outOfAmmo) {
        this.engage(dt, true);
        this.look = { kind: 'none' };
      }
      if (nav.failed) return this.enter('patrol');
      if (nav.arrived) {
        this.holdTimer = 0;
        this.lookBaseYaw = bot.aim.yaw;
      }
      return;
    }
    // At the spot but the ammo has been taken: wait for it to come back, keeping watch.
    this.holdTimer += dt;
    this.lookAround(dt);
    if (!bot.outOfAmmo && p.canSee) return this.enter('attack');
    // If another ammo spot has its pickup ready, go there instead.
    if (this.holdTimer > 3) {
      const a = this.ctx.findAmmo?.(bot.position, Infinity, false);
      if (a && this.flatDist(a) > 1.5) {
        this.dest.copy(a);
        this.holdTimer = -1;
      } else this.holdTimer = 0.01;
    }
  }

  private chase(): void {
    const p = this.bot.perception;
    if (this.obj?.urgent) return this.enter('patrol');
    const aggressive = this.bot.skill.aggression >= 0.5;
    this.moveAlongPath(this.dest, aggressive ? BOTS.runSpeed : BOTS.walkSpeed * 1.2);
    if (this.flatDist(this.dest) < 7) this.look = { kind: 'point', p: this._v.copy(this.dest).setY(this.dest.y + 1.4) };
    if (this.navigator.arrived || this.navigator.failed || !p.hasLastSeen) this.enter('search');
  }

  private search(dt: number): void {
    const p = this.bot.perception;
    if (this.obj?.urgent) return this.enter('patrol');
    if (p.hasNoise && this.stateTime > 1) return this.enter('investigate');
    this.searchTimer -= dt;
    if (this.searchTimer <= 0 || this.searchIndex >= this.searchPoints.length) return this.enter('patrol');
    if (this.lookTimer > 0) {
      this.lookTimer -= dt;
      this.lookAround(dt);
      return;
    }
    this.moveAlongPath(this.searchPoints[this.searchIndex], BOTS.walkSpeed);
    if (this.navigator.arrived || this.navigator.failed) {
      this.searchIndex++;
      this.navigator.clear();
      this.lookTimer = 1.6;
      this.lookBaseYaw = this.bot.aim.yaw;
    }
  }

  // ---- Combat ----------------------------------------------------------

  /** Aim at the target and fire in bursts (once reacted and roughly on target). */
  private engage(dt: number, allowFire: boolean): void {
    const bot = this.bot;
    const target = this.target!;
    const skill = bot.skill;
    const p = bot.perception;

    const tp = target.position;
    this._aim.set(tp.x, tp.y + target.height * 0.65, tp.z);
    const want = bot.anglesTo(this._aim);
    const dist = bot.eyePosition().distanceTo(this._aim);

    // Already alert (searching, chasing, in cover)? React faster.
    const alert = this.prevState !== 'patrol' || this.state !== 'attack';
    const reaction = skill.reactionTime * (alert ? 0.6 : 1);
    const reacting = p.visibleTime < reaction;
    const turnSpeed = p.visibleTime < reaction * 0.4 ? skill.turnSpeed * 0.3 : skill.turnSpeed;
    bot.aim.turnToward(dt, want.yaw, want.pitch, turnSpeed);

    const targetSpeed = Math.hypot(target.velocity.x, target.velocity.z);
    const selfSpeed = Math.hypot(bot.velocity.x, bot.velocity.z);
    const settling = Math.max(0, 1 - p.visibleTime / 1.5);
    const error =
      skill.aimError *
      (0.7 + dist / 25) *
      (1 + skill.movingTargetPenalty * Math.min(1, targetSpeed / 5.5)) *
      (1 + skill.selfMovingPenalty * Math.min(1, selfSpeed / BOTS.walkSpeed)) *
      (1 + settling * 0.8);
    bot.aim.updateWobble(dt, error);

    if (!allowFire || reacting) return;
    if (bot.aim.offBy(want.yaw, want.pitch) > 5 + error) return;
    if (this.burstPause > 0) {
      this.burstPause -= dt;
      return;
    }
    if (this.burstLeft <= 0) this.burstLeft = randInt(skill.burstSize[0], skill.burstSize[1]);
    if (bot.tryFire()) {
      this.burstLeft--;
      if (this.burstLeft <= 0) this.burstPause = rand(skill.burstPause[0], skill.burstPause[1]);
    }
  }

  /**
   * Pick who to fight: prefer whoever just shot us, then whoever we're
   * already fighting, then the closest enemy in view.
   */
  private scanForTargets(dt: number): void {
    this.scanTimer -= dt;
    if (this.scanTimer > 0) return;
    this.scanTimer = 0.25;
    const bot = this.bot;
    const eye = bot.eyePosition();
    let best: Trackable | null = null;
    let bestScore = Infinity;
    const recentlyHit = this.now - bot.lastDamagedAt < 3;
    for (const e of this.ctx.getEnemies()) {
      if (e === (bot as Trackable) || !e.isAlive()) continue;
      if (!bot.perception.checkVision(eye, bot.aim.yaw, e, this.ctx.world)) continue;
      let score = this.flatDist(e.position);
      if (recentlyHit && e.name === bot.lastAttacker) score -= 20;
      if (e === this.target) score -= 6;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (best && best !== this.target) {
      this.target = best;
      bot.perception.retarget();
    } else if (!best && (!this.target || !this.target.isAlive())) {
      // Nobody in view: if someone just shot us, make them the one we look for.
      const attacker = recentlyHit ? this.ctx.getEnemies().find((e) => e.name === bot.lastAttacker && e.isAlive()) : undefined;
      if (attacker !== this.target) {
        this.target = attacker ?? null;
        bot.perception.retarget();
      }
    }
  }

  /** Where the danger is: the target's eyes, or where it was last seen/heard. */
  private threatPoint(out: THREE.Vector3): THREE.Vector3 {
    const p = this.bot.perception;
    if (this.target && p.canSee) out.copy(this.target.position);
    else if (p.hasLastSeen) out.copy(p.lastSeenPos);
    else if (p.hasNoise) out.copy(p.noisePos);
    else out.copy(this.bot.position);
    return out.setY(out.y + 1.6);
  }

  /** A nearby spot next to a wall that the threat can't see. */
  private findCover(threat: THREE.Vector3): THREE.Vector3 | null {
    const pos = this.bot.position;
    const candidates = this.ctx.nav
      .nodesWithin(pos, 14)
      .filter((n) => n.nearWall && Math.abs(n.y - pos.y) < 3 && Math.hypot(n.x - threat.x, n.z - threat.z) > 6);
    const score = (n: { x: number; z: number }) => {
      const toBot = Math.hypot(n.x - pos.x, n.z - pos.z);
      const toThreat = Math.hypot(n.x - threat.x, n.z - threat.z);
      return toBot + Math.max(0, 10 - toThreat) * 2;
    };
    candidates.sort((a, b) => score(a) - score(b));
    for (const n of candidates.slice(0, 24)) {
      if (!this.ctx.world.hasLineOfSight(threat.x, threat.y, threat.z, n.x, n.y + 1.5, n.z)) return new THREE.Vector3(n.x, n.y, n.z);
    }
    return null;
  }

  /** A hidden spot farther away from the threat. */
  private findRetreat(threat: THREE.Vector3): THREE.Vector3 | null {
    const pos = this.bot.position;
    const awayX = pos.x - threat.x, awayZ = pos.z - threat.z;
    const candidates = this.ctx.nav.nodesWithin(pos, 25).filter((n) => {
      const dx = n.x - pos.x, dz = n.z - pos.z;
      return Math.hypot(dx, dz) > 6 && dx * awayX + dz * awayZ > 0;
    });
    const score = (n: { x: number; z: number }) =>
      -Math.hypot(n.x - threat.x, n.z - threat.z) + 0.3 * Math.hypot(n.x - pos.x, n.z - pos.z);
    candidates.sort((a, b) => score(a) - score(b));
    for (const n of candidates.slice(0, 20)) {
      if (!this.ctx.world.hasLineOfSight(threat.x, threat.y, threat.z, n.x, n.y + 1.5, n.z)) return new THREE.Vector3(n.x, n.y, n.z);
    }
    return null;
  }

  // ---- Movement helpers ------------------------------------------------

  private pickPatrolGoal(): void {
    const pos = this.bot.position;
    const obj = this.obj;
    if (obj) {
      // Somewhere inside the objective's area.
      const spots = this.ctx.nav.nodesWithin(obj.pos, obj.radius);
      const n = spots.length ? spots[Math.floor(Math.random() * spots.length)] : null;
      if (n) this.dest.set(n.x, n.y, n.z);
      else this.dest.copy(obj.pos);
      return;
    }
    for (let i = 0; i < 12; i++) {
      const n = this.ctx.nav.randomNode();
      const d = Math.hypot(n.x - pos.x, n.z - pos.z);
      if (d > 10 && d < 35) {
        this.dest.set(n.x, n.y, n.z);
        return;
      }
    }
    const n = this.ctx.nav.randomNode();
    this.dest.set(n.x, n.y, n.z);
  }

  private planSearch(center: THREE.Vector3): void {
    const nodes = this.ctx.nav.nodesWithin(center, 10);
    this.searchPoints = [];
    for (let i = 0; i < 3 && nodes.length; i++) {
      const n = nodes[Math.floor(Math.random() * nodes.length)];
      this.searchPoints.push(new THREE.Vector3(n.x, n.y, n.z));
    }
    this.searchIndex = 0;
    this.searchTimer = rand(10, 14);
    this.lookTimer = 1.2;
    this.lookBaseYaw = this.bot.aim.yaw;
  }

  private moveAlongPath(goal: THREE.Vector3, speed: number): void {
    this.navigator.setGoal(goal);
    this.moveMode = 'nav';
    this.speed = speed;
  }

  /** Plan a straight move by (dx, dz) if that's walkable (no walls, no ledges). */
  private tryDirect(dx: number, dz: number): boolean {
    const pos = this.bot.position;
    const tx = pos.x + dx, tz = pos.z + dz;
    const ty = this.ctx.world.groundHeight(tx, tz, BOTS.radius, pos.y + 0.45);
    if (!Number.isFinite(ty) || !this.ctx.nav.canWalk(pos.x, pos.y, pos.z, tx, ty, tz)) return false;
    this.directPoint.set(tx, ty, tz);
    return true;
  }

  private lookAround(dt: number): void {
    const yaw = this.lookBaseYaw + Math.sin(this.stateTime * 2.2) * 1.3;
    this.bot.aim.turnToward(dt, yaw, 0, this.bot.skill.turnSpeed * 0.5);
    this.bot.aim.updateWobble(dt, 0);
    this.look = { kind: 'none' };
  }

  private applyMovement(dt: number): void {
    const bot = this.bot;
    bot.moveDir = null;
    bot.moveSpeed = this.speed;
    let waypoint: THREE.Vector3 | null = null;
    if (this.moveMode === 'nav') {
      waypoint = this.navigator.update(dt);
      bot.moveTarget = waypoint;
      bot.slowOnArrive = this.navigator.onFinalLeg;
    } else if (this.moveMode === 'direct') {
      bot.moveTarget = this.directPoint;
      bot.slowOnArrive = true;
    } else {
      bot.moveTarget = null;
    }

    // Where to look.
    const turn = bot.skill.turnSpeed * 0.6;
    if (this.look.kind === 'path' && waypoint) {
      const yaw = Math.atan2(-(waypoint.x - bot.position.x), -(waypoint.z - bot.position.z));
      if (Math.abs(angleDiff(yaw, bot.aim.yaw)) > 0.01) bot.aim.turnToward(dt, yaw, 0, turn);
      bot.aim.updateWobble(dt, 0);
    } else if (this.look.kind === 'point') {
      const want = bot.anglesTo(this.look.p);
      bot.aim.turnToward(dt, want.yaw, want.pitch, turn);
      bot.aim.updateWobble(dt, 0);
    }
  }

  private flatDist(p: THREE.Vector3): number {
    return Math.hypot(p.x - this.bot.position.x, p.z - this.bot.position.z);
  }
}
