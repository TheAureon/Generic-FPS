import * as THREE from 'three';
import { BOTS } from '../config';
import type { CollisionWorld } from '../core/CollisionWorld';
import type { Trackable } from '../player/Player';
import type { Bot } from './Bot';

export interface BrainContext {
  world: CollisionWorld;
  /** Who the bot is hunting. */
  target: Trackable;
  /** A random walkable spot on the map (for wandering). */
  randomPoint: () => THREE.Vector3;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1));

/**
 * Decides what a bot does each frame. A small state machine:
 *   idle        → wander around
 *   investigate → heard a shot / got hit: go check it out
 *   chase       → lost sight of the target: go to where it was last seen
 *   attack      → can see the target: aim, shoot in bursts, keep distance, strafe
 */
export class BotBrain {
  private wanderTarget: THREE.Vector3 | null = null;
  private strafeSign = 1;
  private strafeTimer = 0;
  private burstLeft = 0;
  private burstPause = 0;
  private stuckTimer = 0;
  private lastPos = new THREE.Vector3();
  private sidestepTimer = 0;
  private sidestepDir = new THREE.Vector3();
  private _aimPoint = new THREE.Vector3();
  private _dir = new THREE.Vector3();

  constructor(
    readonly bot: Bot,
    private ctx: BrainContext,
  ) {}

  reset(): void {
    this.wanderTarget = null;
    this.burstLeft = 0;
    this.burstPause = 0;
    this.lastPos.copy(this.bot.position);
  }

  update(dt: number): void {
    const bot = this.bot;
    const target = this.ctx.target;
    const p = bot.perception;
    p.update(dt, bot.eyePosition(), bot.aim.yaw, target, this.ctx.world);
    if (!bot.isAlive()) return;

    bot.moveDir = null;

    if (p.canSee) {
      this.attack(dt);
    } else if (p.hasLastSeen) {
      bot.state = 'chase';
      this.goTo(dt, p.lastSeenPos, BOTS.runSpeed);
      if (this.arrived(p.lastSeenPos)) p.hasLastSeen = false;
    } else if (p.hasNoise) {
      bot.state = 'investigate';
      this.goTo(dt, p.noisePos, BOTS.walkSpeed * 1.2);
      if (this.arrived(p.noisePos)) p.clearNoise();
    } else {
      bot.state = 'idle';
      if (!this.wanderTarget || this.arrived(this.wanderTarget)) this.wanderTarget = this.ctx.randomPoint();
      this.goTo(dt, this.wanderTarget, BOTS.walkSpeed * 0.7);
    }

    this.handleStuck(dt);
  }

  private attack(dt: number): void {
    const bot = this.bot;
    const target = this.ctx.target;
    const skill = bot.skill;
    const p = bot.perception;
    bot.state = 'attack';

    // Aim at the chest.
    const tp = target.position;
    this._aimPoint.set(tp.x, tp.y + target.height * 0.65, tp.z);
    const want = bot.anglesTo(this._aimPoint);
    const dist = bot.eyePosition().distanceTo(this._aimPoint);

    // Reaction time: the bot starts turning a bit after spotting you,
    // and only shoots once fully reacted.
    const reacting = p.visibleTime < skill.reactionTime;
    const turnSpeed = p.visibleTime < skill.reactionTime * 0.4 ? skill.turnSpeed * 0.25 : skill.turnSpeed;
    bot.aim.turnToward(dt, want.yaw, want.pitch, turnSpeed);

    // How shaky the aim is right now.
    const targetSpeed = Math.hypot(target.velocity.x, target.velocity.z);
    const selfSpeed = Math.hypot(bot.velocity.x, bot.velocity.z);
    const settling = Math.max(0, 1 - p.visibleTime / 1.5); // aim improves the longer it tracks you
    const error =
      skill.aimError *
      (0.7 + dist / 25) *
      (1 + skill.movingTargetPenalty * Math.min(1, targetSpeed / 5.5)) *
      (1 + skill.selfMovingPenalty * Math.min(1, selfSpeed / BOTS.walkSpeed)) *
      (1 + settling * 0.8);
    bot.aim.updateWobble(dt, error);

    // Movement: close in if far, back off if too close, otherwise strafe.
    const farRange = BOTS.preferredRange * (1.3 - skill.aggression * 0.6);
    this._dir.set(tp.x - bot.position.x, 0, tp.z - bot.position.z);
    const flat = this._dir.length();
    this._dir.divideScalar(Math.max(flat, 1e-6));
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeTimer = rand(0.8, 2.2);
      this.strafeSign = Math.random() < 0.5 ? -1 : 1;
    }
    if (this.sidestepTimer > 0) {
      bot.moveDir = this.sidestepDir;
      bot.moveSpeed = BOTS.walkSpeed;
    } else if (flat > farRange) {
      bot.moveTarget = tp.clone();
      bot.moveSpeed = BOTS.walkSpeed;
    } else if (flat < BOTS.minRange) {
      bot.moveDir = this._dir.clone().negate();
      bot.moveSpeed = BOTS.walkSpeed;
    } else {
      // Strafe sideways (perpendicular to the target).
      bot.moveDir = new THREE.Vector3(-this._dir.z * this.strafeSign, 0, this._dir.x * this.strafeSign);
      bot.moveSpeed = BOTS.walkSpeed * 0.75;
    }

    // Shooting in bursts, once reacted and roughly on target.
    if (reacting) return;
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

  /** Walk toward a point and look where we're going. */
  private goTo(dt: number, point: THREE.Vector3, speed: number): void {
    const bot = this.bot;
    if (this.sidestepTimer > 0) {
      bot.moveDir = this.sidestepDir;
      bot.moveTarget = null;
    } else {
      bot.moveTarget = point;
    }
    bot.moveSpeed = speed;
    const look = this._aimPoint.set(point.x, bot.eyePosition().y, point.z);
    const want = bot.anglesTo(look);
    bot.aim.turnToward(dt, want.yaw, 0, bot.skill.turnSpeed * 0.6);
    bot.aim.updateWobble(dt, 0);
  }

  private arrived(point: THREE.Vector3): boolean {
    const pos = this.bot.position;
    return Math.hypot(point.x - pos.x, point.z - pos.z) < 1.0;
  }

  /** If we're trying to move but not getting anywhere, sidestep for a moment. */
  private handleStuck(dt: number): void {
    const bot = this.bot;
    this.sidestepTimer = Math.max(0, this.sidestepTimer - dt);
    const trying = bot.moveTarget !== null || bot.moveDir !== null;
    this.stuckTimer += dt;
    if (this.stuckTimer < 0.8) return;
    const moved = Math.hypot(bot.position.x - this.lastPos.x, bot.position.z - this.lastPos.z);
    this.stuckTimer = 0;
    this.lastPos.copy(bot.position);
    if (!trying || moved > 0.4 || this.sidestepTimer > 0) return;

    const a = Math.random() * Math.PI * 2;
    this.sidestepDir.set(Math.cos(a), 0, Math.sin(a));
    this.sidestepTimer = 0.7;
    this.strafeSign = -this.strafeSign;
    if (bot.state === 'idle') this.wanderTarget = null;
  }
}
