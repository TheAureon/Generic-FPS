import * as THREE from 'three';
import { BOTS, type Difficulty } from '../config';
import type { CollisionWorld } from '../core/CollisionWorld';
import type { CharacterBody } from '../core/CharacterBody';
import type { Damageable } from '../core/Hitbox';
import { events } from '../core/events';
import type { Effects } from '../effects/Effects';
import type { BuiltMap } from '../map/MapBuilder';
import type { SpawnPoint } from '../map/MapTypes';
import type { Player, Trackable } from '../player/Player';
import { Bot } from './Bot';
import { BotBrain } from './BotBrain';
import { NavGraph } from './NavGraph';

export interface BotManagerDeps {
  scene: THREE.Scene;
  map: BuiltMap;
  effects: Effects;
  player: Player;
  /** true = bots also fight each other; false = they all hunt only the player. */
  freeForAll: boolean;
  /** Optional: where health can be found (for retreating bots). */
  findHealth?: (from: THREE.Vector3) => THREE.Vector3 | null;
}

/** Creates bots, runs their brains, and respawns them. */
export class BotManager {
  readonly bots: Bot[] = [];
  readonly brains: BotBrain[] = [];
  readonly nav: NavGraph;
  private world: CollisionWorld;
  /** Everyone in the fight (player + bots). */
  private combatants: (Trackable & Damageable)[] = [];
  private onlyPlayer: (Trackable & Damageable)[];

  constructor(private d: BotManagerDeps) {
    this.world = d.map.world;
    this.combatants.push(d.player);
    this.onlyPlayer = [d.player];

    // Build the navigation graph from the map (connected to the spawn points).
    const def = d.map.def;
    const seeds = [...def.playerSpawns, ...def.botSpawns].map((s) => new THREE.Vector3(s.x, s.y, s.z));
    this.nav = NavGraph.build(this.world, d.map.bounds, seeds, { radius: BOTS.radius + 0.06 });

    // Bots hear gunshots within each gun's hearing range.
    events.on('shot', (e) => {
      for (const bot of this.bots) {
        if (!bot.isAlive() || e.shooter === bot.name) continue;
        if (bot.position.distanceTo(e.position) <= e.hearingRange * BOTS.hearingMultiplier) bot.perception.hear(e.position);
      }
    });
  }

  /** Who a bot may shoot at. */
  private enemiesOf(bot: Bot): readonly (Trackable & Damageable)[] {
    return this.d.freeForAll ? this.combatants.filter((c) => c !== bot) : this.onlyPlayer;
  }

  spawnBots(count: number, difficulty: Difficulty): void {
    for (let i = 0; i < count; i++) {
      const idx = this.bots.length;
      const name = BOTS.names[idx % BOTS.names.length];
      this.enemyLists[idx] = [];
      const getEnemies = () => this.enemyLists[idx];
      const bot = new Bot(name, difficulty, {
        world: this.world,
        scene: this.d.scene,
        effects: this.d.effects,
        getEnemies,
        listener: this.d.player,
      });
      const brain = new BotBrain(bot, { world: this.world, nav: this.nav, getEnemies, findHealth: this.d.findHealth });
      this.bots.push(bot);
      this.brains.push(brain);
      this.combatants.push(bot);
    }
    // Everyone's list of enemies, now that the roster is known.
    this.bots.forEach((b, j) => (this.enemyLists[j] = this.enemiesOf(b)));
    // Spawn one at a time so they spread out.
    this.bots.forEach((b, j) => {
      if (b.model.root.visible) return;
      b.spawn(this.pickSpawn());
      this.brains[j].reset();
    });
  }

  private enemyLists: (readonly (Trackable & Damageable)[])[] = [];

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
      // Fell out of the map somehow: put it back.
      if (bot.isAlive() && bot.position.y < -20) {
        bot.spawn(this.pickSpawn());
        this.brains[i].reset();
      }
    }
  }

  /** A spawn point far from everyone else and out of their sight. */
  pickSpawn(): SpawnPoint {
    const def = this.d.map.def;
    const spawns = this.d.freeForAll ? [...def.botSpawns, ...def.playerSpawns] : def.botSpawns;
    let best = spawns[0];
    let bestScore = -Infinity;
    for (const s of spawns) {
      let nearest = Infinity;
      let seen = false;
      for (const c of this.combatants) {
        if (!c.isAlive() || (c instanceof Bot && !c.model.root.visible)) continue;
        const p = c.position;
        nearest = Math.min(nearest, Math.hypot(p.x - s.x, p.z - s.z));
        if (c === this.d.player && this.world.hasLineOfSight(p.x, p.y + 1.6, p.z, s.x, s.y + 1.6, s.z)) seen = true;
      }
      let score = Math.min(nearest, 40) + Math.random() * 6;
      if (seen) score -= 30;
      if (nearest < 3) score -= 100;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
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
