import * as THREE from 'three';
import { CONFIG } from '../config';
import { buildMap, type BuiltMap } from '../map/MapBuilder';
import { getMap } from '../map/maps';
import { PlayerController } from '../player/PlayerController';
import { Hud } from '../ui/Hud';
import { Overlay } from '../ui/Overlay';
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
  readonly player: PlayerController;
  readonly map: BuiltMap;

  private hud: Hud;
  private overlay: Overlay;
  private clock = new THREE.Clock();
  private accumulator = 0;
  private state: State = 'menu';
  /** Testing aid: lets automated checks play without pointer lock. */
  private forcePlay = false;

  constructor(gameRoot: HTMLElement, uiRoot: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.render.maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = CONFIG.render.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    gameRoot.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(settings.get().fov, window.innerWidth / window.innerHeight, 0.05, 500);
    this.scene.add(this.camera);

    this.input = new Input(this.renderer.domElement);
    this.map = buildMap(getMap('test-room'), this.scene);
    this.player = new PlayerController(this.map.world, this.camera);
    this.player.spawn(this.map.def.playerSpawns[0]);

    this.hud = new Hud(uiRoot);
    this.overlay = new Overlay(uiRoot, () => this.input.requestLock());

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

  start(): void {
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), MAX_FRAME_DT);

    if (this.input.wasPressed('F3')) this.hud.showDebug = !this.hud.showDebug;

    if (this.state === 'playing') {
      this.player.applyLook(this.input);
      this.accumulator += dt;
      while (this.accumulator >= PHYSICS_DT) {
        this.player.step(PHYSICS_DT, this.input);
        this.accumulator -= PHYSICS_DT;
      }
    }
    this.player.updateCamera();

    this.renderer.render(this.scene, this.camera);

    const p = this.player;
    this.hud.updateDebug(dt, () => [
      `pos ${p.position.x.toFixed(1)} ${p.position.y.toFixed(2)} ${p.position.z.toFixed(1)}`,
      `speed ${Math.hypot(p.velocity.x, p.velocity.z).toFixed(1)} m/s${p.sprinting ? ' (sprint)' : ''}${p.crouching ? ' (crouch)' : ''}`,
      `F3 hides this`,
    ]);

    this.input.endFrame();
  }

  /** Testing aid: start playing without needing the mouse captured. */
  debugStartPlaying(): void {
    this.forcePlay = true;
    this.state = 'playing';
    this.overlay.hide();
  }

  /** Testing aid: run the physics for exactly `seconds` of game time. */
  debugSimulate(seconds: number): void {
    for (let t = 0; t < seconds; t += PHYSICS_DT) this.player.step(PHYSICS_DT, this.input);
    this.player.updateCamera();
  }
}
