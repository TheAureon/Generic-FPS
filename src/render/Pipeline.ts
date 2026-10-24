import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CONFIG } from '../config';
import { currentQuality } from './quality';
import type { Sky } from './Sky';

/**
 * How the world gets drawn, depending on the Graphics setting:
 * - Low: plain rendering, cheaper materials, no shadows
 * - Medium: shadows, soft reflections of the surroundings, and color grading
 *   (warm light, cool shadows, a gentle vignette)
 * - High: all of that, plus ambient occlusion (soft shading where things
 *   meet: corners, under furniture, around characters' feet), sharper
 *   soft-edged shadows, and a "bloom" glow around lamps, visors and flashes
 */
export class RenderPipeline {
  private env: THREE.Texture;
  private pmrem: THREE.PMREMGenerator;
  private composer: EffectComposer | null = null;
  private composerQuality = '';
  private renderPass: RenderPass | null = null;
  private gtao: GTAOPass | null = null;
  private grade: ShaderPass | null = null;
  private gradeKey: unknown = undefined;
  private size = new THREE.Vector2();
  private ratio = 0;
  private dirty = false;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.env = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
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
    // Reflections: of the scene's own sky if it has one (made once per
    // scene), otherwise a soft studio-like light. Kept faint so the baked
    // lighting stays in charge.
    let env: THREE.Texture | null = null;
    if (q.envMap) {
      const sky = scene.userData.sky as Sky | undefined;
      if (sky) env = scene.userData.skyEnv ??= this.pmrem.fromScene(sky.reflectionScene(), 0, 0.1, 500).texture;
      else env = this.env;
    }
    if (scene.environment !== env) {
      scene.environment = env;
      scene.environmentIntensity = scene.userData.sky ? 0.35 : 0.2;
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

    // Low: straight to the screen.
    if (!q.bloom && !q.grade) {
      r.clear();
      r.render(scene, camera);
      return;
    }
    this.ensureComposer(q);
    this.renderPass!.scene = scene;
    this.renderPass!.camera = camera;
    if (this.gtao) {
      this.gtao.scene = scene;
      this.gtao.camera = camera;
    }
    this.updateGrade(scene);
    this.composer!.render();
  }

  /** Color grading follows the map's light: highlights take the sun's color, shadows the sky's. */
  private updateGrade(scene: THREE.Scene): void {
    if (!this.grade) return;
    const sky = scene.userData.sky as Sky | undefined;
    const key = sky ? sky.def : null;
    if (this.gradeKey === key) return;
    this.gradeKey = key;
    const u = this.grade.uniforms;
    const sun = new THREE.Color(sky?.def.sunColor ?? 0xfff1dd);
    const zen = new THREE.Color(sky?.def.zenith ?? 0x4a7fbf);
    const norm = (c: THREE.Color) => c.multiplyScalar(3 / (c.r + c.g + c.b + 1e-3));
    u.highlightTint.value.copy(norm(new THREE.Color(1, 1, 1).lerp(sun, 0.4)));
    // Shadows only slightly cool (a warm room shouldn't turn blue).
    u.shadowTint.value.copy(norm(new THREE.Color(1, 0.99, 0.97).lerp(zen, 0.1)));
  }

  private ensureComposer(q: ReturnType<typeof currentQuality>): void {
    const r = this.renderer;
    r.getSize(this.size);
    const ratio = r.getPixelRatio();
    const key = `${q.bloom}|${q.ao}|${q.grade}`;
    if (this.composer && this.composerQuality !== key) {
      this.composer.dispose();
      this.gtao?.dispose();
      this.composer = null;
      this.gtao = null;
      this.grade = null;
      this.gradeKey = undefined;
    }
    if (!this.composer) {
      this.composerQuality = key;
      const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(r, target);
      this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
      this.composer.addPass(this.renderPass);
      if (q.ao) {
        // Ambient occlusion, worked out at half resolution (it's soft anyway).
        const gtao = new GTAOPass(new THREE.Scene(), new THREE.PerspectiveCamera(), 2, 2);
        gtao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 12 });
        const setSize = gtao.setSize.bind(gtao);
        gtao.setSize = (w: number, h: number) => setSize(Math.max(1, Math.floor(w / 2)), Math.max(1, Math.floor(h / 2)));
        gtao.blendIntensity = 0.85;
        this.gtao = gtao;
        this.composer.addPass(gtao);
      }
      // Only really bright things glow (lamp panels, visors, flashes, sparks).
      if (q.bloom) {
        // Tame impossibly bright pixels first (a sun glint on water can be
        // brighter than the image can store, and would bloom into a white fog).
        this.composer.addPass(new ShaderPass(ClampShader));
        this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.5, 1.0));
      }
      if (q.grade) {
        this.grade = new ShaderPass(GradeShader);
        this.composer.addPass(this.grade);
      }
      this.composer.addPass(new OutputPass());
      this.ratio = 0;
    }
    if (this.ratio !== ratio || this.composer.renderTarget1.width !== Math.floor(this.size.x * ratio)) {
      this.ratio = ratio;
      this.composer.setPixelRatio(ratio);
      this.composer.setSize(this.size.x, this.size.y);
    }
  }
}

/** Limits each pixel's brightness (and clears broken pixels) before the bloom. */
const ClampShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 c = tex.rgb;
      if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
      gl_FragColor = vec4(clamp(c, 0.0, 12.0), tex.a);
    }
  `,
};

/**
 * Color grading (in linear light, before tone mapping): a touch more
 * color, warm highlights and cool shadows (from the sky), a gentle
 * S-curve, and a soft vignette.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    saturation: { value: 1.12 },
    contrast: { value: 1.08 },
    vignette: { value: 0.32 },
    highlightTint: { value: new THREE.Color(1.03, 1.0, 0.95) },
    shadowTint: { value: new THREE.Color(0.95, 0.99, 1.06) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation, contrast, vignette;
    uniform vec3 highlightTint, shadowTint;
    varying vec2 vUv;
    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 c = max(tex.rgb, vec3(0.0));
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, saturation);
      float t = l / (l + 0.35);
      c *= mix(shadowTint, highlightTint, t);
      // Contrast around middle grey (keeps blacks black, highlights bright).
      c = 0.18 * pow(c / 0.18 + 1e-5, vec3(contrast));
      vec2 d = vUv - 0.5;
      c *= 1.0 - vignette * smoothstep(0.15, 0.75, dot(d, d) * 2.0);
      gl_FragColor = vec4(c, tex.a);
    }
  `,
};
