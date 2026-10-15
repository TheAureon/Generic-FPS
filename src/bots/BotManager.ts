import * as THREE from 'three';
import { BOTS, type Difficulty } from '../config';
import type { CollisionWorld } from '../core/CollisionWorld';
import type { CharacterBody } from '../core/CharacterBody';
import type { Damageable } from '../core/Hitbox';
import { events } from '../core/events';
import type { Effects } from '../effects/Effects';
import type { BuiltMap } from '../map/MapBuilder';
import type { SpawnPoint } from '../map/MapTypes';
import type { Player } from '../player/Player';
import { Bot } from './Bot';
import { BotBrain } from './BotBrain';

export interface BotManagerDeps {
  scene: THREE.Scene;
  map: BuiltMap;
  effects: Effects;
  player: Player;
}

/** Creates bots, runs their brains, and respawns them. */
export class BotManager {
  readonly bots: Bot[] = [];
  private brains: BotBrain[] = [];
  private world: CollisionWorld;

  constructor(private d: BotManagerDeps) {
    this.world = d.map.world;

    // Bots hear gunshots within each gun's hearing range.
    events.on('shot', (e) => {
      for (const bot of this.bots) {
        if (!bot.isAlive() || e.shooter === bot.name) continue;
        if (bot.position.distanceTo(e.position) <= e.hearingRange * BOTS.hearingMultiplier) bot.perception.hear(e.position);
      }
    });
  }

  spawnBots(count: number, difficulty: Difficulty): void {
    const enemies: Damageable[] = [this.d.player];
    for (let i = 0; i < count; i++) {
      const name = BOTS.names[i % BOTS.names.length];
      const bot = new Bot(name, difficulty, {
        world: this.world,
        scene: this.d.scene,
        effects: this.d.effects,
        getEnemies: () => enemies,
        listener: this.d.player,
      });
      const brain = new BotBrain(bot, {
        world: this.world,
        target: this.d.player,
        randomPoint: () => this.randomPoint(),
      });
      this.bots.push(bot);
      this.brains.push(brain);
      bot.spawn(this.pickSpawn());
      brain.reset();
    }
  }

  /** Fixed-rate movement + keeping characters from overlapping. */
  physicsStep(dt: number): void {
    for (const b of this.bots) b.physicsStep(dt);

    const bodies: CharacterBody[] = this.bots.filter((b) => b.isAlive()).map((b) => b.body);
    if (this.d.player.isAlive()) bodies.push(this.d.player.controller.body);
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) separate(bodies[i], bodies[j]);
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.bots.length; i++) {
      const bot = this.bots[i];
      this.brains[i].update(dt);
      bot.update(dt);
      if (!bot.isAlive() && bot.respawnTimer <= 0) {
        bot.hide();
        bot.spawn(this.pickSpawn());
        this.brains[i].reset();
      }
    }
  }

  /** Bot spawn point that's far from the player and preferably out of sight. */
  pickSpawn(): SpawnPoint {
    const spawns = this.d.map.def.botSpawns;
    const pp = this.d.player.position;
    const eyeY = pp.y + 1.6;
    let best = spawns[0];
    let bestScore = -Infinity;
    for (const s of spawns) {
      let score = Math.hypot(s.x - pp.x, s.z - pp.z);
      if (this.world.hasLineOfSight(pp.x, eyeY, pp.z, s.x, s.y + 1.6, s.z)) score -= 30;
      // Don't stack bots on the same spot.
      for (const b of this.bots) if (b.isAlive() && Math.hypot(b.position.x - s.x, b.position.z - s.z) < 2) score -= 50;
      score += Math.random() * 5;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  /** A random spot a bot could stand on. */
  randomPoint(): THREE.Vector3 {
    const b = this.d.map.bounds;
    for (let tries = 0; tries < 30; tries++) {
      const x = THREE.MathUtils.lerp(b.min.x + 1, b.max.x - 1, Math.random());
      const z = THREE.MathUtils.lerp(b.min.z + 1, b.max.z - 1, Math.random());
      const y = this.world.groundHeight(x, z, BOTS.radius, b.max.y);
      if (!Number.isFinite(y)) continue;
      const blocked = this.world.findBlocker({ x, z, feet: y, height: BOTS.height, radius: BOTS.radius }, 0.45);
      if (!blocked) return new THREE.Vector3(x, y, z);
    }
    return this.bots[0]?.position.clone() ?? new THREE.Vector3();
  }
}

/** Push two overlapping characters apart (sideways only). */
function separate(a: CharacterBody, b: CharacterBody): void {
  const dx = b.position.x - a.position.x, dz = b.position.z - a.position.z;
  const minDist = a.radius + b.radius;
  const d2 = dx * dx + dz * dz;
  if (d2 >= minDist * minDist) return;
  // Only if they overlap vertically too.
  if (a.position.y > b.position.y + b.height || b.position.y > a.position.y + a.height) return;
  const d = Math.sqrt(d2) || 0.001;
  const push = (minDist - d) / 2;
  const nx = d2 > 0 ? dx / d : 1, nz = d2 > 0 ? dz / d : 0;
  a.nudge(-nx * push, -nz * push);
  b.nudge(nx * push, nz * push);
}
