import * as THREE from 'three';
import { BOT_DIFFICULTY, BOTS, GRENADES, type Difficulty } from '../config';
import type { CollisionWorld } from '../core/CollisionWorld';
import type { CharacterBody } from '../core/CharacterBody';
import type { Damageable } from '../core/Hitbox';
import { events } from '../core/events';
import { rules } from '../core/MatchRules';
import type { Effects } from '../effects/Effects';
import type { BuiltMap } from '../map/MapBuilder';
import type { SpawnPoint } from '../map/MapTypes';
import type { BotObjective } from '../modes/GameMode';
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
  /** Optional: where ammo can be found (bots must pick up spare ammo like the player). */
  findAmmo?: (from: THREE.Vector3, maxDist?: number, includeTaken?: boolean) => THREE.Vector3 | null;
  /** Bring dead bots back automatically (deathmatch). Default true. */
  autoRespawn?: boolean;
  /** Team modes: bots fight the other team only, and spawn on their own side. */
  teams?: boolean;
  /** Team modes: each team's spawn points (Blue's, Red's). */
  sides?: [SpawnPoint[], SpawnPoint[]];
  /** Grenades: so bots can run from live ones and throw their own. */
  grenades?: {
    dangerNear(p: THREE.Vector3, extra?: number, minAge?: number): THREE.Vector3 | null;
    throw(from: THREE.Vector3, velocity: THREE.Vector3, thrower: string, team: number | null): void;
  };
  /** What the game mode wants each bot to do (hills, flags, zones). */
  objective?: (bot: Bot) => BotObjective | null;
  /** Each bullet's path (breaks glass along it). */
  onBulletPath?: (origin: THREE.Vector3, dir: THREE.Vector3, dist: number) => void;
}

type Fighter = Trackable & Damageable & { team: number | null };

/** Creates bots, runs their brains, and respawns them. */
export class BotManager {
  readonly bots: Bot[] = [];
  readonly brains: BotBrain[] = [];
  readonly nav: NavGraph;
  private world: CollisionWorld;
  /** Everyone in the fight (player + bots). */
  private combatants: Fighter[] = [];
  private onlyPlayer: Fighter[];
  private unsubscribe: () => void;

  constructor(private d: BotManagerDeps) {
    this.world = d.map.world;
    this.combatants.push(d.player);
    this.onlyPlayer = [d.player];

    // Build the navigation graph from the map (connected to the spawn points).
    const def = d.map.def;
    const seeds = [...def.playerSpawns, ...def.botSpawns].map((s) => new THREE.Vector3(s.x, s.y, s.z));
    this.nav = NavGraph.build(this.world, d.map.playBounds, seeds, { radius: BOTS.radius + 0.06, ...(def.navSpacing ? { spacing: def.navSpacing } : {}) });

    // Bots hear gunshots (and explosions) within each sound's hearing range.
    const hear = (source: string, position: THREE.Vector3, range: number) => {
      for (const bot of this.bots) {
        if (!bot.isAlive() || source === bot.name) continue;
        if (bot.position.distanceTo(position) <= range * BOTS.hearingMultiplier) bot.perception.hear(position);
      }
    };
    const offShot = events.on('shot', (e) => hear(e.shooter, e.position, e.hearingRange));
    const offNoise = events.on('noise', (e) => hear(e.source, e.position, e.hearingRange));
    this.unsubscribe = () => {
      offShot();
      offNoise();
    };
  }

  /**
   * Grenades: a bot that notices a live grenade nearby (after its reaction
   * time) sprints away from it; and now and then, a bot that can see its
   * target at a middle distance lobs its grenade (one per life).
   */
  private handleGrenades(bot: Bot, brain: BotBrain, dt: number): void {
    const g = this.d.grenades;
    if (!g) return;
    const danger = g.dangerNear(bot.position, 1.5, bot.skill.reactionTime * 0.6);
    if (danger) {
      const away = (bot.fleeDir ??= new THREE.Vector3());
      away.set(bot.position.x - danger.x, 0, bot.position.z - danger.z);
      if (away.lengthSq() < 1e-4) away.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      away.normalize();
    } else bot.fleeDir = null;

    bot.grenadeTimer -= dt;
    const t = brain.target;
    if (bot.grenades <= 0 || bot.grenadeTimer > 0 || !t || !bot.perception.canSee || !rules.grenades(bot.name)) return;
    bot.grenadeTimer = 2 + Math.random() * 3;
    const dist = bot.position.distanceTo(t.position);
    // Only at a middle distance, and only sometimes (more often for aggressive bots).
    if (dist < 9 || dist > 26 || Math.random() > 0.08 + 0.3 * bot.skill.aggression) return;
    // Aim at their feet, a little off (worse on easy levels), and work out the lob.
    const err = dist * Math.tan((bot.skill.aimError * Math.PI) / 180) * 0.6;
    const to = t.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2 * err, 0, (Math.random() - 0.5) * 2 * err));
    const from = bot.eyePosition().clone();
    from.y -= 0.2;
    const T = THREE.MathUtils.clamp(dist / 13, 0.75, 1.5);
    const vel = new THREE.Vector3((to.x - from.x) / T, (to.y + 0.1 - from.y + 0.5 * GRENADES.gravity * T * T) / T, (to.z - from.z) / T);
    g.throw(from, vel, bot.name, bot.team);
    bot.grenades--;
    bot.grenadeTimer = 10 + Math.random() * 10;
  }

  /** Who a bot may shoot at. */
  private enemiesOf(bot: Bot): readonly Fighter[] {
    const ok = (c: Fighter) => rules.canTarget(bot.name, c.name);
    if (this.d.teams) return this.combatants.filter((c) => c !== bot && c.team !== bot.team && ok(c));
    return (this.d.freeForAll ? this.combatants.filter((c) => c !== bot) : this.onlyPlayer).filter(ok);
  }

  /** Someone changed team (Infected): everyone's list of enemies again. */
  refreshTeams(): void {
    this.bots.forEach((b, j) => (this.enemyLists[j] = this.enemiesOf(b)));
  }

  /** Stop listening to game events (call when the match ends). */
  dispose(): void {
    this.unsubscribe();
  }

  /** Bring bot `i` (back) into the fight with a given skill (used by survival waves). */
  revive(i: number, skill: (typeof BOT_DIFFICULTY)[Difficulty]): void {
    const bot = this.bots[i];
    bot.skill = skill;
    bot.spawn(this.pickSpawn(bot));
    this.brains[i].reset();
  }

  get aliveCount(): number {
    return this.bots.filter((b) => b.isAlive()).length;
  }

  /** @param teamOf team modes: which team bot number i (counting from 0) is on */
  spawnBots(count: number, difficulty: Difficulty, teamOf?: (i: number) => number | null): void {
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
        sampleLight: this.d.map.sampleLampLight,
        onBulletPath: this.d.onBulletPath,
      }, teamOf?.(idx) ?? null, BOTS.weapons[(idx + this.loadoutOffset) % BOTS.weapons.length]);
      const objective = this.d.objective ? () => this.d.objective!(bot) : undefined;
      const brain = new BotBrain(bot, { world: this.world, nav: this.nav, getEnemies, findHealth: this.d.findHealth, findAmmo: this.d.findAmmo, objective });
      this.bots.push(bot);
      this.brains.push(brain);
      this.combatants.push(bot);
    }
    // Everyone's list of enemies, now that the roster is known.
    this.bots.forEach((b, j) => (this.enemyLists[j] = this.enemiesOf(b)));
    // Spawn one at a time so they spread out.
    this.bots.forEach((b, j) => {
      if (b.model.root.visible) return;
      b.spawn(this.pickSpawn(b));
      this.brains[j].reset();
    });
  }

  private enemyLists: (readonly (Trackable & Damageable)[])[] = [];
  /** Bots take turns through the bot gun list, starting at a random place each match. */
  private loadoutOffset = Math.floor(Math.random() * BOTS.weapons.length);

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
      if (bot.isAlive()) this.handleGrenades(bot, this.brains[i], dt);
      bot.update(dt);
      if (!bot.isAlive() && bot.respawnTimer <= 0 && bot.model.root.visible) {
        bot.hide();
        if (this.d.autoRespawn !== false) {
          bot.spawn(this.pickSpawn(bot));
          this.brains[i].reset();
        }
      }
      // Fell out of the map somehow: put it back.
      if (bot.isAlive() && bot.position.y < -20) {
        bot.spawn(this.pickSpawn(bot));
        this.brains[i].reset();
      }
    }
  }

  /**
   * A spawn point far from everyone else and out of their sight. In team
   * modes: on the bot's own side, away from enemies (teammates don't count).
   */
  pickSpawn(bot?: Bot): SpawnPoint {
    const def = this.d.map.def;
    const team = this.d.teams && bot ? bot.team : null;
    let spawns = team !== null && this.d.sides ? this.d.sides[team] : this.d.freeForAll ? [...def.botSpawns, ...def.playerSpawns] : def.botSpawns;
    if (team !== null) {
      // Every spot on our side has an enemy right there: use any spot instead.
      const safe = spawns.filter((s) => !this.combatants.some((c) => c.isAlive() && c.team !== team && Math.hypot(c.position.x - s.x, c.position.z - s.z) < 8));
      if (!safe.length) spawns = [...def.botSpawns, ...def.playerSpawns];
    }
    let best = spawns[0];
    let bestScore = -Infinity;
    for (const s of spawns) {
      let nearest = Infinity;
      let seen = false;
      for (const c of this.combatants) {
        if (!c.isAlive() || (c instanceof Bot && !c.model.root.visible)) continue;
        if (team !== null && c.team === team) continue;
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
