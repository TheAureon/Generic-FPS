import * as THREE from 'three';
import { CONFIG, GRENADES, PICKUPS, REWARDS, TEAMS, type DamageSource } from '../config';
import { audio } from '../audio/AudioEngine';
import { music } from '../audio/Music';
import { BotDebugView } from '../bots/BotDebugView';
import { BotManager } from '../bots/BotManager';
import { Effects } from '../effects/Effects';
import { TargetDummy } from '../entities/TargetDummy';
import { Breakables } from '../entities/Breakables';
import { currentQuality } from '../render/quality';
import { buildMap, type BuiltMap } from '../map/MapBuilder';
import { getMap } from '../map/maps';
import type { PickupType, SpawnPoint } from '../map/MapTypes';
import { BattleRoyale } from '../modes/BattleRoyale';
import { CaptureTheFlag } from '../modes/CaptureTheFlag';
import { Control } from '../modes/Control';
import { Deathmatch } from '../modes/Deathmatch';
import type { Combatant, GameMode, Marker, MatchConfig, ModeContext } from '../modes/GameMode';
import { KingOfTheHill } from '../modes/KingOfTheHill';
import { teamSides } from '../modes/objectives';
import { Survival } from '../modes/Survival';
import { TeamDeathmatch } from '../modes/TeamDeathmatch';
import { GunGame } from '../modes/GunGame';
import { KillConfirmed } from '../modes/KillConfirmed';
import { Infected } from '../modes/Infected';
import { OneInTheChamber } from '../modes/OneInTheChamber';
import { Headhunter } from '../modes/Headhunter';
import { Juggernaut } from '../modes/Juggernaut';
import { Hardpoint } from '../modes/Hardpoint';
import { SearchAndDestroy } from '../modes/SearchAndDestroy';
import { Escort } from '../modes/Escort';
import { PropHunt } from '../modes/PropHunt';
import { Zombies } from '../modes/Zombies';
import { ArenaLadder } from '../modes/ArenaLadder';
import { Pickups, type Collector } from '../pickups/Pickups';
import { Player } from '../player/Player';
import { PlayerController } from '../player/PlayerController';
import type { Hud } from '../ui/Hud';
import type { RadarBlip } from '../ui/Minimap';
import type { Viewmodel } from '../weapons/Viewmodel';
import { Grenades, type GrenadeVictim } from '../weapons/Grenades';
import { WeaponSystem } from '../weapons/WeaponSystem';
import { events } from './events';
import { resetRules } from './MatchRules';
import { ChallengeTracker, type ChallengeStatus, type MatchView } from './Challenges';
import { progress } from './Progress';
import { Rewards } from './Rewards';
import type { Damageable } from './Hitbox';
import type { Input } from './Input';

export interface MatchDeps {
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  input: Input;
  hud: Hud;
  viewmodel: Viewmodel;
}

/**
 * One match: its own scene, map, player, bots, pickups, and game mode.
 * Thrown away when the match ends, and a new one is made for the next.
 */
export class Match {
  readonly scene = new THREE.Scene();
  readonly map: BuiltMap;
  readonly controller: PlayerController;
  readonly player: Player;
  readonly effects: Effects;
  readonly weapons: WeaponSystem;
  readonly bots: BotManager;
  readonly botDebug: BotDebugView;
  readonly pickups: Pickups;
  readonly mode: GameMode;
  readonly dummies: TargetDummy[] = [];
  /** Your score, medals and streaks this match. */
  readonly rewards: Rewards;
  /** Live grenades (yours and the bots'). */
  readonly grenades: Grenades;
  /** Today's daily challenges, tracked live. */
  readonly challenges: ChallengeTracker;
  /** Your career when the match started (the end screen animates from here). */
  readonly careerAtStart = structuredClone(progress.get());
  private challengeTimer = 0;
  /** How intense the fighting around you is (for the music): level, and when it last flared. */
  private heat = 0;
  private heatAt = -99;

  readonly kills = new Map<string, number>();
  readonly deaths = new Map<string, number>();
  /** Seconds of play so far. */
  time = 0;
  /** Player shooting stats. */
  shotsFired = 0;
  shotsHit = 0;

  private unsubscribers: (() => void)[] = [];
  /** When each combatant last fired (for the radar). */
  private lastShotAt = new Map<string, number>();
  private radarTimer = 0;
  private radarVisible = new Set<string>();
  private _targets: Damageable[] = [];
  breakables!: Breakables;

  /**
   * A blast (a barrel, or a mode's explosion): fire and smoke, a bang, and
   * damage to everyone and every barrel within `radius` (less further out,
   * none through walls), and glass nearby shatters.
   */
  explode(at: THREE.Vector3, radius: number, damage: number, attacker: string, weapon: DamageSource): void {
    this.effects.explosion(at);
    audio.play('explosion', { position: at });
    const d = at.distanceTo(this.player.position);
    if (d < 50) this.controller.addShake(1.4 * (1 - d / 50) ** 2);
    music.duck(0.8, 2);
    this.flare(1);
    this.breakables?.blast(at, radius * 0.8);
    const w = this.map.world;
    for (const v of [...this.combatants(), ...(this.breakables?.barrels ?? [])] as Damageable[]) {
      if (!v.isAlive()) continue;
      const hb = v.hitbox;
      const cy = hb.y + hb.height * 0.5;
      const dist = Math.hypot(hb.x - at.x, cy - at.y, hb.z - at.z);
      if (dist >= radius) continue;
      if (!w.hasLineOfSight(at.x, at.y, at.z, hb.x, cy, hb.z) && !w.hasLineOfSight(at.x, at.y, at.z, hb.x, hb.headY, hb.z)) continue;
      const amount = damage * (1 - (dist / radius) ** 2);
      const killed = v.takeDamage({ amount, part: 'body', attacker, weapon, from: at.clone() });
      if (attacker === this.player.name && !v.isProp && v.name !== this.player.name) {
        this.d.hud.fx.damageNumber(new THREE.Vector3(hb.x, cy, hb.z), amount, false, killed);
        this.d.hud.showHitmarker(killed ? 'kill' : 'hit');
      }
    }
  }
  private collectors: Collector[] = [];
  /** Team modes: each team's spawn points. */
  private sides: [SpawnPoint[], SpawnPoint[]];

  constructor(
    readonly config: MatchConfig,
    private d: MatchDeps,
  ) {
    const { hud } = d;
    resetRules();
    this.map = buildMap(getMap(config.map), this.scene);
    this.controller = new PlayerController(this.map.world, d.camera);
    this.player = new Player(this.controller);
    this.effects = new Effects(this.scene);
    this.pickups = new Pickups(this.scene, this.map.def.pickups ?? []);
    (this.map.def.practiceTargets ?? []).forEach((t, i) => this.dummies.push(new TargetDummy(`Dummy ${i + 1}`, t, this.scene)));

    this.sides = teamSides(this.map.def);
    this.grenades = new Grenades({
      scene: this.scene,
      world: this.map.world,
      effects: this.effects,
      victims: () => [...this.combatants(), ...this.dummies, ...(this.breakables?.barrels ?? [])] as GrenadeVictim[],
      onExplode: (at) => {
        this.breakables?.blast(at, GRENADES.radius * 0.7);
        // The closer the blast, the harder the shake (and the music ducks under it).
        const d = at.distanceTo(this.player.position);
        if (d < 30) this.controller.addShake(1.1 * (1 - d / 30) ** 2);
        if (d < 40) {
          music.duck(0.7 * (1 - d / 40), 1.4);
          this.flare(1);
        }
      },
      onHit: (thrower, point, damage, killed) => {
        if (thrower !== this.player.name) return;
        hud.fx.damageNumber(point, damage, false, killed);
        hud.showHitmarker(killed ? 'kill' : 'hit');
        audio.play(killed ? 'kill' : 'hit');
      },
    });

    // The mode needs a view of the match; build it before the bots.
    const self = this;
    const ctx: ModeContext = {
      config,
      get bots() { return self.bots; },
      player: this.player,
      combatants: () => this.combatants(),
      kills: this.kills,
      deaths: this.deaths,
      get time() { return self.time; },
      scene: this.scene,
      world: this.map.world,
      get nav() { return self.bots.nav; },
      map: this.map.def,
      playBounds: this.map.playBounds,
      sides: this.sides,
      announce: (t, s, sec) => hud.announce(t, s, sec),
      get weapons() { return self.weapons; },
      award: (label, points) => self.rewards.objective(label, points),
      hud,
      input: d.input,
      loadout: (c, guns, opts = {}) => {
        if (c === (this.player as Combatant)) {
          this.weapons.setLoadout(guns, opts);
          return;
        }
        const bot = c as BotManager['bots'][number];
        bot.ammoOverride = opts.ammo !== undefined ? { ammo: opts.ammo, reserve: opts.reserve ?? 0 } : null;
        bot.grenadesPerLife = opts.grenades ?? 1;
        if (bot.isAlive()) bot.grenades = Math.min(bot.grenades, bot.grenadesPerLife);
        if (guns) bot.setGun(guns[0]);
        else bot.refillAmmo();
      },
      refreshTeams: () => this.bots.refreshTeams(),
      explode: (at, radius, damage, attacker) => this.explode(at, radius, damage, attacker, 'grenade'),
      respawn: (c) => {
        if (c === (this.player as Combatant)) {
          this.player.respawn(this.pickPlayerSpawn());
          this.weapons.resetAmmo();
          return;
        }
        const i = this.bots.bots.indexOf(c as BotManager['bots'][number]);
        if (i >= 0) this.bots.revive(i, this.bots.bots[i].skill);
      },
      cue: (kind) => audio.play(kind === 'good' ? 'objective_good' : kind === 'bad' ? 'objective_bad' : 'objective_info'),
    };
    this.mode = createMode(ctx);
    // Teams: you're on Blue. The bots are split as evenly as possible (Blue gets you plus half, rounded down).
    if (this.mode.teams) this.player.team = 0;
    const blueBots = Math.floor(this.mode.initialBots / 2);

    this.bots = new BotManager({
      grenades: this.grenades,
      scene: this.scene,
      map: this.map,
      effects: this.effects,
      player: this.player,
      freeForAll: this.mode.freeForAll,
      autoRespawn: this.mode.botsRespawn,
      teams: this.mode.teams,
      sides: this.sides,
      objective: this.mode.botObjective ? (bot) => this.mode.botObjective!(bot) : undefined,
      findHealth: (from) => this.pickups.nearest('health', from, 40),
      onBulletPath: (o, dir, dist) => this.breakables?.shot(o, dir, dist),
      findAmmo: (from, maxDist, includeTaken) => this.pickups.nearest('ammo', from, maxDist, includeTaken),
    });
    this.bots.spawnBots(this.mode.initialBots, config.difficulty, this.mode.teams ? (i) => this.mode.teamOf?.(i) ?? (i < blueBots ? 0 : 1) : undefined);
    this.botDebug = new BotDebugView(this.bots, this.scene);
    this.breakables = new Breakables({
      scene: this.scene,
      world: this.map.world,
      map: this.map.def,
      panes: this.map.panes,
      nav: this.bots.nav,
      quality: currentQuality().materials,
      explode: (at, radius, damage, attacker, weapon) => this.explode(at, radius, damage, attacker, weapon),
    });

    this.weapons = new WeaponSystem({
      world: this.map.world,
      player: this.controller,
      camera: d.camera,
      effects: this.effects,
      hud,
      getTargets: () => this.targets(),
      ownerName: this.player.name,
      viewmodel: d.viewmodel,
      onHit: (point, damage, head, killed) => hud.fx.damageNumber(point, damage, head, killed),
      throwGrenade: (from, vel) => this.grenades.throw(from, vel, this.player.name, this.player.team),
      onBulletPath: (o, dir, dist) => this.breakables.shot(o, dir, dist),
    });
    this.rewards = new Rewards({
      player: this.player,
      combatants: () => this.combatants(),
      teams: !!this.mode.teams,
      time: () => this.time,
      display: hud.fx,
    });
    // Daily challenges (nothing counts on practice difficulties).
    this.challenges = new ChallengeTracker(REWARDS.xpMultiplier[config.difficulty] === 0, (s) => {
      hud.challenges.complete(s);
      progress.challengeDone();
      music.duck(0.5, 2);
      audio.play('challenge');
    });

    this.player.respawn(this.pickPlayerSpawn());
    this.effects.precompile(d.renderer, d.camera);

    // ---- Scorekeeping and feedback --------------------------------------
    this.controller.onStep = () => audio.play('step', { volume: this.controller.sprinting ? 0.55 : 0.4 });
    this.controller.onSlide = () => audio.play('slide');
    this.controller.onMantle = () => audio.play('mantle');
    this.controller.onLand = (speed) => {
      audio.play('land', { volume: Math.min(1, speed / 10) });
      this.controller.addShake(Math.min(0.35, speed * 0.025));
    };
    this.player.onHurt = (info, armorHit) => {
      hud.showDamage(info.from.x, info.from.z, info.amount);
      this.controller.addShake(0.15 + info.amount * CONFIG.camera.shakePerDamage + (this.player.isAlive() ? 0 : 0.4));
      audio.play(armorHit ? 'armor_hit' : 'hurt', { volume: 0.9 });
    };
    this.unsubscribers.push(
      events.on('kill', (e) => {
        if (e.killer !== e.victim) this.kills.set(e.killer, (this.kills.get(e.killer) ?? 0) + 1);
        this.deaths.set(e.victim, (this.deaths.get(e.victim) ?? 0) + 1);
        hud.addKill(e.killer, e.victim, e.weapon, e.headshot, this.teamColor(e.killer), this.teamColor(e.victim));
        if (e.victim === this.player.name) audio.play('death');
      }),
      events.on('kill', () => this.updateChallenges()),
      events.on('shot', (e) => {
        if (e.shooter === this.player.name) this.shotsFired++;
        // Gunfire: yours, or close to you.
        if (e.shooter === this.player.name) this.flare(0.75);
        else if (e.position.distanceTo(this.player.position) < 35) this.flare(0.55);
        this.lastShotAt.set(e.shooter, this.time);
      }),
      events.on('damage', (e) => {
        if (e.attacker === this.player.name || e.victim === this.player.name) this.flare(1);
        if (e.attacker === this.player.name) this.shotsHit++;
      }),
      () => this.bots.dispose(),
      () => this.rewards.dispose(),
      () => this.grenades.dispose(),
      () => this.breakables.dispose(),
    );

    // Who can grab pickups.
    this.collectors.push({
      name: this.player.name,
      position: this.player.position,
      isAlive: () => this.player.isAlive(),
      tryCollect: (type) => this.playerCollect(type),
    });
    for (const bot of this.bots.bots) this.addBotCollector(bot);
    if (this.mode.removePickups) this.pickups.remove(this.mode.removePickups);

    this.mode.start();
  }

  private flare(level: number): void {
    // A fresh flare-up counts fully; otherwise keep whatever is higher right now.
    this.heat = Math.max(level, this.combatIntensity());
    this.heatAt = this.time;
  }

  /** 0 (calm) .. 1 (in a firefight): holds for a few seconds after the action, then fades. */
  combatIntensity(): number {
    const since = this.time - this.heatAt;
    return since < 5 ? this.heat : Math.max(0, this.heat * (1 - (since - 5) / 9));
  }

  /** How the match is going, for daily challenges. */
  view(finished = false, win = false): MatchView {
    return {
      summary: this.rewards.summary, finished, win,
      mode: this.config.mode, map: this.config.map, difficulty: this.config.difficulty,
      accuracy: this.shotsFired ? (100 * this.shotsHit) / this.shotsFired : 0,
    };
  }

  /** Update daily challenge progress (and the HUD's tracker). */
  updateChallenges(finished = false, win = false): ChallengeStatus[] {
    const s = this.challenges.update(this.view(finished, win));
    this.d.hud.challenges.set(s, this.challenges.practice);
    return s;
  }

  /** Player + bots. */
  combatants(): Combatant[] {
    return [this.player, ...this.bots.bots];
  }

  /** Team color (CSS) for a name in team modes, else undefined. */
  private teamColor(name: string): string | undefined {
    if (!this.mode.teams) return undefined;
    const c = this.combatants().find((x) => x.name === name);
    return c && c.team !== null ? TEAMS.css[c.team] : undefined;
  }

  private addBotCollector(bot: BotManager['bots'][number]): void {
    this.collectors.push({
      name: bot.name,
      position: bot.position,
      isAlive: () => bot.isAlive(),
      // Bots use health and ammo pickups (same amounts as the player). They don't wear armor.
      tryCollect: (type) => {
        if (type === 'ammo') return bot.addAmmo(PICKUPS.ammo.magazines);
        if (type !== 'health' || bot.health >= 100) return false;
        bot.heal(PICKUPS.health.amount);
        return true;
      },
    });
  }

  private playerCollect(type: PickupType): boolean {
    const pl = this.player;
    const hud = this.d.hud;
    switch (type) {
      case 'health':
        if (pl.health >= 100) return false;
        pl.heal(PICKUPS.health.amount);
        hud.pickupMessage(`+${PICKUPS.health.amount} Health`, 'health');
        return true;
      case 'armor':
        if (pl.armor >= 100) return false;
        pl.addArmor(PICKUPS.armor.amount);
        hud.pickupMessage(`+${PICKUPS.armor.amount} Armor`, 'armor');
        return true;
      case 'ammo':
        if (!this.weapons.addAmmo(PICKUPS.ammo.magazines)) return false;
        hud.pickupMessage('+Ammo', 'ammo');
        return true;
    }
  }

  /** Everything the player's bullets can hit. */
  private targets(): readonly Damageable[] {
    this._targets.length = 0;
    for (const d of this.dummies) this._targets.push(d);
    for (const b of this.breakables.barrels) if (b.isAlive()) this._targets.push(b);
    // No friendly fire: your shots pass through teammates.
    for (const b of this.bots.bots) if (b.team === null || b.team !== this.player.team) this._targets.push(b);
    return this._targets;
  }

  /** Fixed-rate physics for everyone. */
  physicsStep(dt: number): void {
    this.controller.step(dt, this.d.input);
    this.bots.physicsStep(dt);
  }

  /** Once per frame, after physics. */
  update(dt: number): void {
    this.time += dt;
    // Survival creates bots as waves start: let them grab pickups too.
    while (this.collectors.length < this.bots.bots.length + 1) this.addBotCollector(this.bots.bots[this.collectors.length - 1]);

    this.player.syncHitbox();
    this.bots.update(dt);
    for (const dm of this.dummies) dm.update(dt);
    this.pickups.update(dt, this.collectors);
    this.grenades.update(dt);
    this.breakables.update(dt);
    this.effects.update(dt);
    this.challengeTimer -= dt;
    if (this.challengeTimer <= 0) {
      this.challengeTimer = 0.5;
      this.updateChallenges();
    }
    this.updateDeath(dt);
    this.mode.update(dt);
    this.botDebug.update();
  }

  /** While dead: death camera, countdown, then respawn (if the mode allows). */
  private updateDeath(dt: number): void {
    const pl = this.player;
    const hud = this.d.hud;
    if (pl.isAlive()) {
      hud.setDeath(null);
      return;
    }
    this.controller.deathCam = Math.min(1, this.controller.deathCam + dt * 2);
    if (!this.mode.playerRespawns) {
      hud.setDeath({ killer: pl.killedBy, seconds: -1, note: this.mode.noRespawnNote });
      return;
    }
    pl.respawnTimer -= dt;
    hud.setDeath({ killer: pl.killedBy, seconds: pl.respawnTimer });
    if (pl.respawnTimer <= 0) {
      pl.respawn(this.pickPlayerSpawn());
      this.weapons.resetAmmo();
      hud.setDeath(null);
    }
  }

  /** The player spawn point farthest from any living enemy (team modes: on Blue's side). */
  private pickPlayerSpawn(): SpawnPoint {
    const team = this.player.team;
    const spawns = team !== null ? this.sides[team] : this.map.def.playerSpawns;
    let best = spawns[0];
    let bestScore = -Infinity;
    for (const s of spawns) {
      let nearest = 60;
      for (const b of this.bots.bots) {
        if (team !== null && b.team === team) continue;
        if (b.isAlive()) nearest = Math.min(nearest, Math.hypot(b.position.x - s.x, b.position.z - s.z));
      }
      const score = nearest + Math.random() * 3;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  /**
   * Things to show on the radar: pickups, and enemies you can see
   * (line of sight) or that fired in the last 2 seconds.
   */
  radarBlips(dt: number): RadarBlip[] {
    const blips: RadarBlip[] = [];
    for (const it of this.pickups.items) {
      if (it.active) blips.push({ x: it.def.x, y: it.def.y, z: it.def.z, kind: it.def.type });
    }
    const eye = this.player.position;
    this.radarTimer -= dt;
    if (this.radarTimer <= 0) {
      this.radarTimer = 0.1;
      this.radarVisible.clear();
      for (const b of this.bots.bots) {
        if (!b.isAlive()) continue;
        const p = b.position;
        if (this.map.world.hasLineOfSight(eye.x, eye.y + this.player.height - 0.1, eye.z, p.x, p.y + 1.2, p.z)) this.radarVisible.add(b.name);
      }
    }
    for (const b of this.bots.bots) {
      if (!b.isAlive()) continue;
      // Teammates always show (in blue).
      if (b.team !== null && b.team === this.player.team) {
        blips.push({ x: b.position.x, y: b.position.y, z: b.position.z, kind: 'ally' });
        continue;
      }
      const fired = this.time - (this.lastShotAt.get(b.name) ?? -99) < 2;
      if (fired || this.radarVisible.has(b.name)) blips.push({ x: b.position.x, y: b.position.y, z: b.position.z, kind: 'enemy' });
    }
    // Hills, zones, flags.
    for (const mk of this.mode.markers?.() ?? []) blips.push({ x: mk.x, y: mk.y, z: mk.z, kind: 'mark', color: mk.color, label: mk.label, radius: mk.radius });
    return blips;
  }

  /** Things to point out on screen: objectives, and teammates (team modes). */
  screenMarkers(): (Marker & { ally?: boolean })[] {
    const out: (Marker & { ally?: boolean })[] = (this.mode.markers?.() ?? []).filter((m) => m.label);
    // Warn about live grenades close by.
    for (const g of this.grenades.positions()) {
      if (g.distanceTo(this.player.position) < GRENADES.radius + 4) out.push({ x: g.x, y: g.y - 0.9, z: g.z, label: '!', color: '#ff5040' });
    }
    if (this.player.team !== null) {
      for (const b of this.bots.bots) {
        if (b.isAlive() && b.team === this.player.team) out.push({ x: b.position.x, y: b.position.y + 2.15, z: b.position.z, label: b.name, color: TEAMS.css[b.team], ally: true });
      }
    }
    return out;
  }

  /** Free GPU memory and stop listening to events. */
  dispose(): void {
    for (const u of this.unsubscribers) u();
    this.mode.dispose?.();
    this.weapons.setLoadout(null);
    resetRules();
    (this.scene.userData.skyEnv as THREE.Texture | undefined)?.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments || o instanceof THREE.Line || o instanceof THREE.Points) {
        if (!o.geometry.userData.cached) o.geometry.dispose();
      }
    });
  }
}

/** The game mode for a match config. */
function createMode(ctx: ModeContext): GameMode {
  switch (ctx.config.mode) {
    case 'survival': return new Survival(ctx);
    case 'tdm': return new TeamDeathmatch(ctx);
    case 'koh': return new KingOfTheHill(ctx, false);
    case 'coh': return new KingOfTheHill(ctx, true);
    case 'ctf': return new CaptureTheFlag(ctx);
    case 'control': return new Control(ctx);
    case 'br': return new BattleRoyale(ctx);
    case 'gungame': return new GunGame(ctx);
    case 'killconfirmed': return new KillConfirmed(ctx);
    case 'infected': return new Infected(ctx);
    case 'oitc': return new OneInTheChamber(ctx);
    case 'headhunter': return new Headhunter(ctx);
    case 'juggernaut': return new Juggernaut(ctx);
    case 'hardpoint': return new Hardpoint(ctx);
    case 'snd': return new SearchAndDestroy(ctx);
    case 'escort': return new Escort(ctx);
    case 'prophunt': return new PropHunt(ctx);
    case 'zombies': return new Zombies(ctx);
    case 'ladder': return new ArenaLadder(ctx);
    default: return new Deathmatch(ctx);
  }
}
