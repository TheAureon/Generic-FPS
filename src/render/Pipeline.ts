import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CONFIG } from '../config';
import { currentQuality } from './quality';

/**
 * How the world gets drawn, depending on the Graphics setting:
 * - Low: plain rendering, cheaper materials, no shadows
 * - Medium: shadows, soft reflections of the surroundings on metal and armor
 * - High: sharper, softer-edged shadows, and a "bloom" glow around lamps,
 *   visors and muzzle flashes (computed at half resolution to stay fast)
 */
export class RenderPipeline {
  private env: THREE.Texture;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private size = new THREE.Vector2();
  private ratio = 0;
  private dirty = false;

  constructor(private renderer: THREE.WebGLRenderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }

  /** Graphics setting changed: shadows and materials need new shaders. */
  qualityChanged(): void {
    const q = currentQuality();
    this.renderer.shadowMap.type = q.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer.shadowMap.enabled = CONFIG.render.shadows && q.shadows;
    this.dirty = true;
  }

  /** Draw a scene to the screen (the gun is drawn on top afterwards). */
  render(scene: THREE.Scene, camera: THREE.Camera, extraScenes: THREE.Scene[] = []): void {
    const q = currentQuality();
    const r = this.renderer;
    // Reflections: a soft studio-like environment, kept faint so the baked
    // lighting stays in charge.
    const env = q.envMap ? this.env : null;
    if (scene.environment !== env) {
      scene.environment = env;
      scene.environmentIntensity = 0.2;
    }
    if (this.dirty) {
      this.dirty = false;
      for (const s of [scene, ...extraScenes]) {
        s.traverse((o) => {
          const m = (o as THREE.Mesh).material;
          if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
          else if (m) m.needsUpdate = true;
        });
      }
    }

    if (!q.bloom) {
      r.clear();
      r.render(scene, camera);
      return;
    }
    this.ensureComposer();
    this.renderPass!.scene = scene;
    this.renderPass!.camera = camera;
    this.composer!.render();
  }

  private ensureComposer(): void {
    const r = this.renderer;
    r.getSize(this.size);
    const ratio = r.getPixelRatio();
    if (!this.composer) {
      const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(r, target);
      this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
      // Only really bright things glow (lamp panels, visors, flashes, sparks).
      this.composer.addPass(this.renderPass);
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.45, 1.0));
      this.composer.addPass(new OutputPass());
      this.ratio = 0;
    }
    if (this.ratio !== ratio || this.composer.renderTarget1.width !== Math.floor(this.size.x * ratio)) {
      this.ratio = ratio;
      this.composer.setPixelRatio(ratio);
      // (The bloom pass itself works at half resolution and below: the glow is blurry anyway.)
      this.composer.setSize(this.size.x, this.size.y);
    }
  }
}
