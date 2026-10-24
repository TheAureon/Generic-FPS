import * as THREE from 'three';
import { CONFIG, MATCH } from '../config';
import { audio } from '../audio/AudioEngine';
import { getMap } from '../map/maps';
import type { MatchConfig } from '../modes/GameMode';
import { animateMaterials } from '../assets/materials';
import { Hud } from '../ui/Hud';
import { MenuBackdrop } from '../ui/MenuBackdrop';
import { Menus } from '../ui/Menus';
import { Viewmodel } from '../weapons/Viewmodel';
import { Input } from './Input';
import { RenderPipeline } from '../render/Pipeline';
import { Match } from './Match';
import { settings } from './Settings';

/** Physics runs at a fixed rate so movement feels the same at any frame rate. */
const PHYSICS_HZ = 120;
const PHYSICS_DT = 1 / PHYSICS_HZ;
const MAX_FRAME_DT = 0.1;

/**
 * menu    → main menu / match setup (arena slowly orbiting behind)
 * playing → in a match, mouse captured
 * paused  → in a match, pause menu (or waiting for the mouse to be captured)
 * ended   → match over, end screen with scores
 */
type State = 'menu' | 'playing' | 'paused' | 'ended';

/** Owns the renderer, the menus, the main loop, and the current match. */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly input: Input;
  readonly hud: Hud;
  readonly menus: Menus;
  readonly viewmodel = new Viewmodel();
  match: Match | null = null;

  private state: State = 'menu';
  private clock = new THREE.Clock();
  private accumulator = 0;
  private lastConfig: MatchConfig | null = null;
  private backdrop: MenuBackdrop | null = null;
  private readonly pipeline: RenderPipeline;
  private lampTimer = 0;
  private lampColor = new THREE.Color();
  private _eye = new THREE.Vector3();
  private _mk = new THREE.Vector3();
  /** Testing aid: lets automated checks play without pointer lock. */
  private forcePlay = false;

  constructor(gameRoot: HTMLElement, uiRoot: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.pipeline = new RenderPipeline(this.renderer);
    this.applyQuality();
    settings.onChange(() => this.applyQuality());
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // We draw the world, then the gun on top, so clear manually.
    this.renderer.autoClear = false;
    gameRoot.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(settings.get().fov, window.innerWidth / window.innerHeight, 0.05, 500);
    this.input = new Input(this.renderer.domElement);

    this.viewmodel.setAspect(this.camera.aspect);
    this.viewmodel.initEnvironment(this.renderer);
    this.viewmodel.precompile(this.renderer);

    this.hud = new Hud(uiRoot);
    this.hud.setVisible(false);
    this.menus = new Menus(uiRoot, {
      startMatch: (cfg) => this.startMatch(cfg),
      resume: () => this.resume(),
      restart: () => this.lastConfig && this.startMatch(this.lastConfig),
      quitToMenu: () => this.quitToMenu(),
    });
    this.menus.show('title');

    document.addEventListener('pointerlockchange', () => this.onPointerLockChange());
    window.addEventListener('resize', () => this.onResize());
  }

  /** Resolution and shadows from the Graphics quality setting. */
  private applyQuality(): void {
    const q = CONFIG.quality[settings.get().quality] ?? CONFIG.quality.high;
    const ratio = Math.min(window.devicePixelRatio, q.pixelRatio);
    if (this.renderer.getPixelRatio() !== ratio) this.renderer.setPixelRatio(ratio);
    if (q !== this.appliedQuality) {
      this.appliedQuality = q;
      this.pipeline.qualityChanged();
    }
  }
  private appliedQuality: unknown = null;

  start(): void {
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---- Flow between screens -------------------------------------------------

  startMatch(cfg: MatchConfig): void {
    this.match?.dispose();
    this.lastConfig = cfg;
    this.match = new Match(cfg, {
      camera: this.camera,
      renderer: this.renderer,
      input: this.input,
      hud: this.hud,
      viewmodel: this.viewmodel,
    });
    this.viewmodel.matchLighting(this.match.map.sky.def);
    this.accumulator = 0;
    this.hud.reset();
    this.hud.minimap.setMap(this.match.map.def, this.match.map.playBounds);
    this.hud.setVisible(true);
    this.menus.hide();
    // Wait for the mouse to be captured before play begins.
    this.state = 'paused';
    this.capturePointer();
  }

  private resume(): void {
    if (!this.match) return;
    this.menus.hide();
    this.capturePointer();
  }

  /** Capture the mouse; if the browser refuses, show the pause menu again. */
  private capturePointer(): void {
    if (this.forcePlay) {
      this.state = 'playing';
      return;
    }
    this.input.requestLock();
    setTimeout(() => {
      if (this.state === 'paused' && !this.input.locked && this.menus.current === null) {
        this.menus.show('pause', 'The mouse could not be captured. Click Resume to continue.');
      }
    }, 600);
  }

  private quitToMenu(): void {
    this.match?.dispose();
    this.match = null;
    this.state = 'menu';
    this.hud.setVisible(false);
    this.input.exitLock();
    this.menus.show('main');
  }

  private endMatch(): void {
    const m = this.match!;
    this.state = 'ended';
    this.input.exitLock();
    this.hud.setVisible(false);
    const result = m.mode.result!;
    audio.play(result.win ? 'win' : 'lose');
    const accuracy = m.shotsFired ? Math.round((100 * m.shotsHit) / m.shotsFired) : 0;
    this.menus.showEnd({ ...result, stats: [...result.stats, `Accuracy: ${accuracy}%`] }, m.mode.scoreboard(), { scoreLabel: m.mode.scoreLabel, teamScores: m.mode.teamScores?.() });
  }

  private onPointerLockChange(): void {
    if (this.input.locked) {
      if (this.match && (this.state === 'paused' || this.state === 'playing')) {
        this.state = 'playing';
        this.menus.hide();
      }
    } else if (this.state === 'playing' && !this.forcePlay) {
      this.state = 'paused';
      this.menus.show('pause');
    }
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.viewmodel.setAspect(this.camera.aspect);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ---- Main loop ---------------------------------------------------------------

  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), MAX_FRAME_DT);
    animateMaterials(this.clock.elapsedTime);
    const m = this.match;

    if (m && this.state !== 'menu') {
      this.updateMatch(dt, m);
      this.pipeline.render(m.scene, this.camera, [this.viewmodel.scene]);
      if (this.state === 'playing' || this.state === 'paused') this.viewmodel.render(this.renderer);
    } else {
      this.renderMenuBackdrop(dt);
    }
    this.input.endFrame();
  }

  private updateMatch(dt: number, m: Match): void {
    const playing = this.state === 'playing';
    const alive = m.player.isAlive();

    // Debug toggles (F-keys need fn on a Mac, so there are letter alternatives).
    if (this.input.wasPressed('F3') || this.input.wasPressed('Backquote')) this.hud.showDebug = !this.hud.showDebug;
    if (this.input.wasPressed('F4') || this.input.wasPressed('KeyB')) m.botDebug.visible = !m.botDebug.visible;

    if (playing) {
      m.controller.inputEnabled = alive;
      if (alive) m.controller.applyLook(this.input);
      else this.input.consumeMouseDelta();
      this.accumulator += dt;
      while (this.accumulator >= PHYSICS_DT) {
        m.physicsStep(PHYSICS_DT);
        this.accumulator -= PHYSICS_DT;
      }
      m.update(dt);
    }
    m.controller.updateCamera();
    m.map.updateShadows(this.camera.position);
    // Weapons after the camera moves, so shots go exactly where you see.
    m.weapons.update(playing ? dt : 0, this.input, playing && alive);
    this.viewmodel.visible = this.viewmodel.visible && alive;

    // HUD.
    this.hud.updateVitals(m.player.health, m.player.armor);
    this.hud.update(playing ? dt : 0, m.player.position.x, m.player.position.z, m.controller.yaw);
    this.hud.setStatus(m.mode.status());
    this.hud.minimap.draw(m.player.position.x, m.player.position.y, m.player.position.z, m.controller.yaw, m.radarBlips(dt));
    this.hud.showScoreboard(playing && this.input.isDown('Tab') ? m.mode.scoreboard() : null, m.mode.name, { scoreLabel: m.mode.scoreLabel, teamScores: m.mode.teamScores?.() });
    this.hud.setObjective(m.mode.progress?.() ?? null);
    this.updateMarkers(m);
    audio.updateListener(this.camera);

    // The gun in your hands picks up the color of nearby lamps.
    this.lampTimer -= dt;
    if (this.lampTimer <= 0) {
      this.lampTimer = 0.2;
      m.map.sampleLampLight(this.camera.getWorldPosition(this._eye), this.lampColor);
    }
    this.viewmodel.tintLamp(this.lampColor, dt);

    const p = m.controller;
    this.hud.updateDebug(dt, () => [
      `pos ${p.position.x.toFixed(1)} ${p.position.y.toFixed(2)} ${p.position.z.toFixed(1)}`,
      `speed ${Math.hypot(p.velocity.x, p.velocity.z).toFixed(1)} m/s${p.sprinting ? ' (sprint)' : ''}${p.crouching ? ' (crouch)' : ''}`,
      ...m.bots.brains.map((br) => `${br.bot.name}: ${br.state} hp ${Math.ceil(br.bot.health)}${br.target && br.bot.perception.canSee ? ' → ' + br.target.name : ''}`),
      `draw calls ${this.renderer.info.render.calls}`,
      '` (or F3) hides this · B (or F4) shows bot paths',
    ]);

    if (playing && m.mode.result) this.endMatch();
  }

  /** Objectives and teammates, projected onto the screen. Objectives off screen stick to the edge. */
  private updateMarkers(m: Match): void {
    const W = window.innerWidth, H = window.innerHeight, margin = 48;
    const camPos = this.camera.getWorldPosition(this._eye);
    const out: Parameters<Hud['setMarkers']>[0] = [];
    for (const mk of m.screenMarkers()) {
      const v = this._mk.set(mk.x, mk.y + (mk.ally ? 0 : 1.2), mk.z);
      const dist = v.distanceTo(camPos);
      v.project(this.camera);
      const behind = v.z > 1;
      if (behind) { v.x = -v.x; v.y = -v.y; }
      let sx = ((v.x + 1) / 2) * W, sy = ((1 - v.y) / 2) * H;
      const onScreen = !behind && sx > margin && sx < W - margin && sy > margin && sy < H - margin;
      if (mk.ally) {
        if (onScreen && dist < 70) out.push({ sx, sy, label: mk.label, sub: '', color: mk.color, ally: true });
        continue;
      }
      if (!onScreen) {
        // Pin to the screen edge, in the marker's direction.
        const dx = sx - W / 2, dy = sy - H / 2;
        const k = Math.min((W / 2 - margin) / Math.max(1e-3, Math.abs(dx)), (H / 2 - margin) / Math.max(1e-3, Math.abs(dy)));
        sx = W / 2 + dx * (behind ? Math.max(k, 1) : Math.min(k, 1));
        sy = H / 2 + dy * (behind ? Math.max(k, 1) : Math.min(k, 1));
        sx = Math.min(W - margin, Math.max(margin, sx));
        sy = Math.min(H - margin, Math.max(margin, sy));
      }
      out.push({ sx, sy, label: mk.label, sub: `${Math.round(dist)} m`, color: mk.color, edge: !onScreen });
    }
    this.hud.setMarkers(out);
  }

  /** Behind the title screen and menus: the arena at dusk with a slow camera. */
  private renderMenuBackdrop(dt: number): void {
    this.backdrop ??= new MenuBackdrop(getMap(MATCH.defaultMap));
    this.backdrop.update(dt, this.camera, this.menus.current !== 'title');
    this.pipeline.render(this.backdrop.scene, this.camera);
  }

  // ---- Testing aids (used by automated checks) ---------------------------------

  get controller() { return this.match!.controller; }
  get player() { return this.match!.player; }
  get bots() { return this.match!.bots; }
  get weapons() { return this.match!.weapons; }
  get map() { return this.match!.map; }
  get effects() { return this.match!.effects; }

  /** Start a match and play without needing the mouse captured. */
  debugStartPlaying(cfg?: Partial<MatchConfig>): void {
    this.forcePlay = true;
    if (!this.match || cfg) {
      this.startMatch({
        mode: 'deathmatch', map: MATCH.defaultMap, difficulty: 'medium', botCount: 4, killLimit: 20,
        ...this.lastConfig, ...cfg,
      });
    }
    this.state = 'playing';
    this.menus.hide();
  }

  /** Run the player's physics for exactly `seconds` of game time. */
  debugSimulate(seconds: number): void {
    const m = this.match!;
    for (let t = 0; t < seconds; t += PHYSICS_DT) m.controller.step(PHYSICS_DT, this.input);
    m.controller.updateCamera();
  }

  /** Run the whole match for `seconds` without rendering. */
  debugRun(seconds: number): void {
    const m = this.match!;
    for (let t = 0; t < seconds; t += PHYSICS_DT) {
      m.physicsStep(PHYSICS_DT);
      m.update(PHYSICS_DT);
      m.controller.updateCamera();
      m.weapons.update(PHYSICS_DT, this.input, m.player.isAlive());
      this.input.endFrame();
      if (m.mode.result) break;
    }
  }
}
