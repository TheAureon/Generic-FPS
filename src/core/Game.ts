import * as THREE from 'three';
import { CONFIG } from '../config';
import { audio } from '../audio/AudioEngine';
import { BotDebugView } from '../bots/BotDebugView';
import { BotManager } from '../bots/BotManager';
import { Effects } from '../effects/Effects';
import { TargetDummy } from '../entities/TargetDummy';
import { buildMap, type BuiltMap } from '../map/MapBuilder';
import { getMap } from '../map/maps';
import type { SpawnPoint } from '../map/MapTypes';
import { Player } from '../player/Player';
import { PlayerController } from '../player/PlayerController';
import { Hud } from '../ui/Hud';
import { Overlay } from '../ui/Overlay';
import { WeaponSystem } from '../weapons/WeaponSystem';
import { events } from './events';
import type { Damageable } from './Hitbox';
import { Input } from './Input';
import { settings } from './Settings';

/** Physics runs at a fixed rate so movement feels the same at any frame rate. */
const PHYSICS_HZ = 120;
const PHYSICS_DT = 1 / PHYSICS_HZ;
const MAX_FRAME_DT = 0.1;

type State = 'menu' | 'playing' | 'paused';

/** Owns the renderer, the scene, and the main loop. */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly input: Input;
  /** Movement and camera. */
  readonly controller: PlayerController;
  /** Health, armor, dying. */
  readonly player: Player;
  readonly map: BuiltMap;
  readonly effects: Effects;
  readonly weapons: WeaponSystem;
  readonly bots: BotManager;
  readonly botDebug: BotDebugView;
  readonly dummies: TargetDummy[] = [];

  private hud: Hud;
  private overlay: Overlay;
  private clock = new THREE.Clock();
  private accumulator = 0;
  private state: State = 'menu';
  /** Testing aid: lets automated checks play without pointer lock. */
  private forcePlay = false;
  private _targets: Damageable[] = [];

  constructor(gameRoot: HTMLElement, uiRoot: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.render.maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = CONFIG.render.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // We draw the world, then the gun on top, so clear manually.
    this.renderer.autoClear = false;
    gameRoot.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(settings.get().fov, window.innerWidth / window.innerHeight, 0.05, 500);
    this.scene.add(this.camera);

    this.input = new Input(this.renderer.domElement);
    this.map = buildMap(getMap(CONFIG.testMatch.map), this.scene);
    this.controller = new PlayerController(this.map.world, this.camera);
    this.player = new Player(this.controller);
    this.player.respawn(this.map.def.playerSpawns[0]);

    this.hud = new Hud(uiRoot);
    this.effects = new Effects(this.scene);

    (this.map.def.practiceTargets ?? []).forEach((t, i) => {
      this.dummies.push(new TargetDummy(`Dummy ${i + 1}`, t, this.scene));
    });

    this.bots = new BotManager({
      scene: this.scene,
      map: this.map,
      effects: this.effects,
      player: this.player,
      freeForAll: CONFIG.testMatch.freeForAll,
    });
    this.bots.spawnBots(CONFIG.testMatch.botCount, CONFIG.testMatch.difficulty);
    this.botDebug = new BotDebugView(this.bots, this.scene);

    this.weapons = new WeaponSystem({
      world: this.map.world,
      player: this.controller,
      camera: this.camera,
      effects: this.effects,
      hud: this.hud,
      getTargets: () => this.targets(),
      ownerName: this.player.name,
    });
    this.weapons.viewmodel.setAspect(this.camera.aspect);
    this.weapons.viewmodel.initEnvironment(this.renderer);
    this.weapons.viewmodel.precompile(this.renderer);
    this.effects.precompile(this.renderer, this.camera);

    // Getting hurt: HUD flash + direction indicator + sound.
    this.player.onHurt = (info, armorHit) => {
      this.hud.showDamage(info.from.x, info.from.z, info.amount);
      audio.play(armorHit ? 'armor_hit' : 'hurt', { volume: 0.9 });
    };
    events.on('kill', (e) => {
      this.hud.addKill(e.killer, e.victim, e.weapon, e.headshot);
      if (e.victim === this.player.name) audio.play('death');
    });

    this.overlay = new Overlay(uiRoot, () => {
      audio.unlock();
      this.input.requestLock();
    });

    document.addEventListener('pointerlockchange', () => {
      if (this.input.locked) {
        this.state = 'playing';
        this.overlay.hide();
      } else if (this.state === 'playing' && !this.forcePlay) {
        this.state = 'paused';
        this.overlay.show(true);
      }
    });

    window.addEventListener('resize', () => this.onResize());
  }

  /** Everything the player's bullets can hit. */
  private targets(): readonly Damageable[] {
    this._targets.length = 0;
    for (const d of this.dummies) this._targets.push(d);
    for (const b of this.bots.bots) this._targets.push(b);
    return this._targets;
  }

  start(): void {
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.weapons.viewmodel.setAspect(this.camera.aspect);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), MAX_FRAME_DT);

    // Debug toggles (F-keys need fn on a Mac, so there are letter alternatives).
    if (this.input.wasPressed('F3') || this.input.wasPressed('Backquote')) this.hud.showDebug = !this.hud.showDebug;
    if (this.input.wasPressed('F4') || this.input.wasPressed('KeyB')) this.botDebug.visible = !this.botDebug.visible;

    const playing = this.state === 'playing';
    const alive = this.player.isAlive();
    if (playing) {
      this.controller.inputEnabled = alive;
      if (alive) this.controller.applyLook(this.input);
      else this.input.consumeMouseDelta();

      this.accumulator += dt;
      while (this.accumulator >= PHYSICS_DT) {
        this.controller.step(PHYSICS_DT, this.input);
        this.bots.physicsStep(PHYSICS_DT);
        this.accumulator -= PHYSICS_DT;
      }
      this.player.syncHitbox();
      this.bots.update(dt);
      for (const d of this.dummies) d.update(dt);
      this.effects.update(dt);
      this.updateDeath(dt);
    }
    this.botDebug.update();
    this.controller.updateCamera();
    // Weapons after the camera moves, so shots go exactly where you see.
    this.weapons.update(playing ? dt : 0, this.input, playing && alive);
    this.weapons.viewmodel.visible = this.weapons.viewmodel.visible && alive;
    this.hud.updateVitals(this.player.health, this.player.armor);
    this.hud.update(dt, this.player.position.x, this.player.position.z, this.controller.yaw);
    audio.updateListener(this.camera);

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.weapons.viewmodel.render(this.renderer);

    const p = this.controller;
    this.hud.updateDebug(dt, () => [
      `pos ${p.position.x.toFixed(1)} ${p.position.y.toFixed(2)} ${p.position.z.toFixed(1)}`,
      `speed ${Math.hypot(p.velocity.x, p.velocity.z).toFixed(1)} m/s${p.sprinting ? ' (sprint)' : ''}${p.crouching ? ' (crouch)' : ''}`,
      `spread ${this.weapons.currentSpread().toFixed(2)}°`,
      ...this.bots.brains.map((br) => `${br.bot.name}: ${br.state} hp ${Math.ceil(br.bot.health)}${br.target && br.bot.perception.canSee ? ' → ' + br.target.name : ''}`),
      `draw calls ${this.renderer.info.render.calls}`,
      '` (or F3) hides this · B (or F4) shows bot paths',
    ]);

    this.input.endFrame();
  }

  /** While dead: death camera, countdown, then respawn. */
  private updateDeath(dt: number): void {
    const pl = this.player;
    if (pl.isAlive()) {
      this.hud.setDeath(null);
      return;
    }
    this.controller.deathCam = Math.min(1, this.controller.deathCam + dt * 2);
    pl.respawnTimer -= dt;
    this.hud.setDeath({ killer: pl.killedBy, seconds: pl.respawnTimer });
    if (pl.respawnTimer <= 0) {
      pl.respawn(this.pickPlayerSpawn());
      this.weapons.resetAmmo();
      this.hud.setDeath(null);
    }
  }

  /** The player spawn point farthest from any living bot. */
  private pickPlayerSpawn(): SpawnPoint {
    let best = this.map.def.playerSpawns[0];
    let bestScore = -Infinity;
    for (const s of this.map.def.playerSpawns) {
      let nearest = Infinity;
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

  /** Testing aid: start playing without needing the mouse captured. */
  debugStartPlaying(): void {
    this.forcePlay = true;
    this.state = 'playing';
    this.overlay.hide();
  }

  /** Testing aid: run the player's physics for exactly `seconds` of game time. */
  debugSimulate(seconds: number): void {
    for (let t = 0; t < seconds; t += PHYSICS_DT) this.controller.step(PHYSICS_DT, this.input);
    this.controller.updateCamera();
  }

  /** Testing aid: run the whole game (bots included) for `seconds` without rendering. */
  debugRun(seconds: number): void {
    const prev = this.state;
    this.state = 'playing';
    for (let t = 0; t < seconds; t += PHYSICS_DT) {
      this.controller.step(PHYSICS_DT, this.input);
      this.bots.physicsStep(PHYSICS_DT);
      this.player.syncHitbox();
      this.bots.update(PHYSICS_DT);
      this.effects.update(PHYSICS_DT);
      this.updateDeath(PHYSICS_DT);
      this.controller.updateCamera();
      this.weapons.update(PHYSICS_DT, this.input, this.player.isAlive());
      this.input.endFrame();
    }
    this.state = prev;
  }
}
