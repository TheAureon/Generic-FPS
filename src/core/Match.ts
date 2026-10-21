import * as THREE from 'three';
import { CONFIG, PICKUPS } from '../config';
import { audio } from '../audio/AudioEngine';
import { BotDebugView } from '../bots/BotDebugView';
import { BotManager } from '../bots/BotManager';
import { Effects } from '../effects/Effects';
import { TargetDummy } from '../entities/TargetDummy';
import { buildMap, type BuiltMap } from '../map/MapBuilder';
import { getMap } from '../map/maps';
import type { PickupType, SpawnPoint } from '../map/MapTypes';
import { Deathmatch } from '../modes/Deathmatch';
import type { GameMode, MatchConfig, ModeContext } from '../modes/GameMode';
import { Survival } from '../modes/Survival';
import { Pickups, type Collector } from '../pickups/Pickups';
import { Player } from '../player/Player';
import { PlayerController } from '../player/PlayerController';
import type { Hud } from '../ui/Hud';
import type { RadarBlip } from '../ui/Minimap';
import type { Viewmodel } from '../weapons/Viewmodel';
import { WeaponSystem } from '../weapons/WeaponSystem';
import { events } from './events';
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
  private collectors: Collector[] = [];

  constructor(
    readonly config: MatchConfig,
    private d: MatchDeps,
  ) {
    const { hud } = d;
    this.map = buildMap(getMap(config.map), this.scene);
    this.controller = new PlayerController(this.map.world, d.camera);
    this.player = new Player(this.controller);
    this.effects = new Effects(this.scene);
    this.pickups = new Pickups(this.scene, this.map.def.pickups ?? []);
    (this.map.def.practiceTargets ?? []).forEach((t, i) => this.dummies.push(new TargetDummy(`Dummy ${i + 1}`, t, this.scene)));

    // The mode needs a view of the match; build it before the bots.
    const self = this;
    const ctx: ModeContext = {
      config,
      get bots() { return self.bots; },
      player: this.player,
      kills: this.kills,
      deaths: this.deaths,
      get time() { return self.time; },
      announce: (t, s, sec) => hud.announce(t, s, sec),
    };
    this.mode = config.mode === 'survival' ? new Survival(ctx) : new Deathmatch(ctx);

    this.bots = new BotManager({
      scene: this.scene,
      map: this.map,
      effects: this.effects,
      player: this.player,
      freeForAll: this.mode.freeForAll,
      autoRespawn: this.mode.botsRespawn,
      findHealth: (from) => this.pickups.nearest('health', from, 40),
      findAmmo: (from, maxDist, includeTaken) => this.pickups.nearest('ammo', from, maxDist, includeTaken),
    });
    this.bots.spawnBots(this.mode.initialBots, config.difficulty);
    this.botDebug = new BotDebugView(this.bots, this.scene);

    this.weapons = new WeaponSystem({
      world: this.map.world,
      player: this.controller,
      camera: d.camera,
      effects: this.effects,
      hud,
      getTargets: () => this.targets(),
      ownerName: this.player.name,
      viewmodel: d.viewmodel,
    });

    this.player.respawn(this.pickPlayerSpawn());
    this.effects.precompile(d.renderer, d.camera);

    // ---- Scorekeeping and feedback --------------------------------------
    this.controller.onStep = () => audio.play('step', { volume: this.controller.sprinting ? 0.55 : 0.4 });
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
        hud.addKill(e.killer, e.victim, e.weapon, e.headshot);
        if (e.victim === this.player.name) audio.play('death');
      }),
      events.on('shot', (e) => {
        if (e.shooter === this.player.name) this.shotsFired++;
        this.lastShotAt.set(e.shooter, this.time);
      }),
      events.on('damage', (e) => {
        if (e.attacker === this.player.name) this.shotsHit++;
      }),
      () => this.bots.dispose(),
    );

    // Who can grab pickups.
    this.collectors.push({
      name: this.player.name,
      position: this.player.position,
      isAlive: () => this.player.isAlive(),
      tryCollect: (type) => this.playerCollect(type),
    });
    for (const bot of this.bots.bots) this.addBotCollector(bot);

    this.mode.start();
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
    for (const b of this.bots.bots) this._targets.push(b);
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
    this.effects.update(dt);
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
      hud.setDeath({ killer: pl.killedBy, seconds: -1 });
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

  /** The player spawn point farthest from any living bot. */
  private pickPlayerSpawn(): SpawnPoint {
    let best = this.map.def.playerSpawns[0];
    let bestScore = -Infinity;
    for (const s of this.map.def.playerSpawns) {
      let nearest = 60;
      for (const b of this.bots.bots) {
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
      const fired = this.time - (this.lastShotAt.get(b.name) ?? -99) < 2;
      if (fired || this.radarVisible.has(b.name)) blips.push({ x: b.position.x, y: b.position.y, z: b.position.z, kind: 'enemy' });
    }
    return blips;
  }

  /** Free GPU memory and stop listening to events. */
  dispose(): void {
    for (const u of this.unsubscribers) u();
    (this.scene.userData.skyEnv as THREE.Texture | undefined)?.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments || o instanceof THREE.Line || o instanceof THREE.Points) {
        if (!o.geometry.userData.cached) o.geometry.dispose();
      }
    });
  }
}
