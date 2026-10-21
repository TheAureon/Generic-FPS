import * as THREE from 'three';
import { createCharacterModel, type CharacterModel } from '../assets/characterModel';
import { createWorldWeaponModel } from '../assets/weaponModels';
import { CharacterAnimator, gunGrips } from '../bots/CharacterAnimator';
import { buildMap } from '../map/MapBuilder';
import type { MapDef } from '../map/MapTypes';

/**
 * The scene behind the title screen and menus: the arena at dusk, dust
 * floating in the light, a few bots standing guard, and a slow camera.
 */
export class MenuBackdrop {
  readonly scene = new THREE.Scene();
  private dust: THREE.Points;
  private dustVel: Float32Array;
  private guards: { model: CharacterModel; anim: CharacterAnimator; baseYaw: number; phase: number }[] = [];
  private time = 0;
  /** Camera blends between the title shot and the menu shot. */
  private menuBlend = 0;
  private readonly bounds: THREE.Box3;

  constructor(map: MapDef) {
    const built = buildMap(map, this.scene);
    this.bounds = built.bounds;

    // Dusk sky: deep blue at the top fading to a warm haze at the horizon.
    const sky = document.createElement('canvas');
    sky.width = 2;
    sky.height = 256;
    const g = sky.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#0f1a2e');
    grad.addColorStop(0.45, '#33405c');
    grad.addColorStop(0.75, '#a86f52');
    grad.addColorStop(1, '#e0a36b');
    g.fillStyle = grad;
    g.fillRect(0, 0, 2, 256);
    const skyTex = new THREE.CanvasTexture(sky);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = skyTex;
    this.scene.fog = new THREE.Fog(0x8a6a5a, 30, 110);

    // Warm low sun + cool fill, to match the sky.
    this.scene.traverse((o) => {
      if (o instanceof THREE.DirectionalLight) {
        o.color.set(0xffc58f);
        o.intensity = 2.6;
        o.position.set(-40, 18, 25);
      } else if (o instanceof THREE.HemisphereLight) {
        o.color.set(0x8fa6d6);
        o.groundColor.set(0x3a2a24);
        o.intensity = 0.9;
      }
    });

    // Dust motes drifting through the air.
    const N = 700;
    const pos = new Float32Array(N * 3);
    this.dustVel = new Float32Array(N * 3);
    const b = this.bounds;
    for (let i = 0; i < N; i++) {
      pos[i * 3] = THREE.MathUtils.lerp(b.min.x, b.max.x, Math.random());
      pos[i * 3 + 1] = Math.random() * 9;
      pos[i * 3 + 2] = THREE.MathUtils.lerp(b.min.z, b.max.z, Math.random());
      this.dustVel[i * 3] = (Math.random() - 0.5) * 0.25;
      this.dustVel[i * 3 + 1] = 0.05 + Math.random() * 0.12;
      this.dustVel[i * 3 + 2] = (Math.random() - 0.5) * 0.25;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.09,
        map: softDot(),
        color: 0xffd9a8,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.scene.add(this.dust);

    // A few bots standing guard (on the roof, the west deck, by the east door).
    const posts: [number, number, number, number][] = [
      [1.5, 3.5, -2.5, Math.PI * 0.85],
      [-26.5, 2.5, -1, -Math.PI / 2],
      [8, 0, 1.5, -Math.PI * 0.6],
    ];
    for (const [x, y, z, yaw] of posts) {
      const model = createCharacterModel(0xb8402f, 0x3f444c);
      const gun = createWorldWeaponModel('rifle');
      gun.scale.setScalar(1.1);
      model.hand.add(gun);
      model.root.position.set(x, y, z);
      model.root.rotation.y = yaw;
      built.sampleLampLight(new THREE.Vector3(x, y + 1.2, z), model.material.lampLight);
      this.scene.add(model.root);
      this.guards.push({ model, anim: new CharacterAnimator(model, gun, gunGrips(gun)), baseYaw: yaw, phase: Math.random() * 10 });
    }
  }

  /** Animate and point `camera` for the title (menu=false) or menus (menu=true). */
  update(dt: number, camera: THREE.PerspectiveCamera, menu: boolean): void {
    this.time += dt;
    const t = this.time;

    // Dust drifts up and sideways, wrapping around inside the arena.
    const p = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = p.array as Float32Array;
    const b = this.bounds;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] += (this.dustVel[i] + Math.sin(t * 0.3 + i) * 0.05) * dt;
      arr[i + 1] += this.dustVel[i + 1] * dt;
      arr[i + 2] += this.dustVel[i + 2] * dt;
      if (arr[i + 1] > 9) arr[i + 1] = 0;
      if (arr[i] < b.min.x) arr[i] = b.max.x;
      if (arr[i] > b.max.x) arr[i] = b.min.x;
      if (arr[i + 2] < b.min.z) arr[i + 2] = b.max.z;
      if (arr[i + 2] > b.max.z) arr[i + 2] = b.min.z;
    }
    p.needsUpdate = true;

    // Guards breathe and slowly scan around (taking small steps as they turn).
    for (const gd of this.guards) {
      const s = t + gd.phase;
      gd.anim.update(dt, {
        velocity: STILL,
        onGround: true,
        yaw: gd.baseYaw + Math.sin(s * 0.25) * 0.9,
        pitch: -0.12 + Math.sin(s * 0.31) * 0.08,
        reload: -1,
        runSpeed: 5,
      });
    }

    // Camera: a low, slow sweep around the center building for the title; a
    // wider, higher shot for the menus. Blend smoothly when switching.
    this.menuBlend += ((menu ? 1 : 0) - this.menuBlend) * Math.min(1, dt * 1.5);
    const m = this.menuBlend;
    const a = t * 0.045 + 0.6;
    // Title: camera low and looking slightly up, so the logo sits over the sky
    // and the arena fills the bottom of the screen.
    // (Stays inside the outer walls: their outsides aren't drawn.)
    const radius = 28.5;
    const height = THREE.MathUtils.lerp(5.5, 11, m) + Math.sin(t * 0.37) * 0.4;
    camera.position.set(Math.sin(a) * radius, height, Math.cos(a) * radius * 0.73);
    camera.lookAt(Math.sin(t * 0.21) * 1.5, THREE.MathUtils.lerp(10.5, 1.5, m), 0);
    const fov = THREE.MathUtils.lerp(52, 60, m);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }
}

const STILL = new THREE.Vector3();

/** Soft round dot texture for the dust. */
function softDot(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}
