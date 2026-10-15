import * as THREE from 'three';
import { WEAPONS, type WeaponId } from '../config';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createWeaponModel } from '../assets/weaponModels';

/**
 * The gun you see in your hands. It lives in its own little scene with its
 * own camera and is drawn on top of the world, so it never clips into walls
 * and isn't affected by your field-of-view setting.
 */

/** Where the gun sits when aiming down sights, per weapon (so the sights line up with the screen center). */
const AIM_POSE: Record<WeaponId, THREE.Vector3> = {
  pistol: new THREE.Vector3(0, -0.053, -0.27),
  rifle: new THREE.Vector3(0, -0.0775, -0.24),
  shotgun: new THREE.Vector3(0, -0.041, -0.38),
  sniper: new THREE.Vector3(0, -0.085, -0.12),
};
const HIP_POSE = new THREE.Vector3(0.15, -0.15, -0.42);

export interface ViewmodelState {
  /** 0 = hip, 1 = fully aimed. */
  ads: number;
  /** 0..1 how much we're sprinting. */
  sprint: number;
  /** 0..1 how fast we're moving (for bobbing). */
  move: number;
  /** Mouse movement this frame (for sway). */
  lookDX: number;
  lookDY: number;
  /** 0 = gun fully up, 1 = fully lowered (switching weapons). */
  lowered: number;
  reloading: boolean;
  onGround: boolean;
}

export class Viewmodel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
  /** Moves with sway/bob/recoil. */
  private rig = new THREE.Group();
  private models = new Map<WeaponId, THREE.Group>();
  private flashes = new Map<WeaponId, THREE.Object3D>();
  private current: WeaponId = 'pistol';

  private kickBack = 0;
  private kickUp = 0;
  private swayX = 0;
  private swayY = 0;
  private bobT = 0;
  private reloadBlend = 0;
  private flashTimer = 0;
  private time = 0;
  visible = true;

  constructor() {
    this.scene.add(this.camera);
    this.camera.add(this.rig);
    this.scene.add(new THREE.HemisphereLight(0xdde8ff, 0x4a4036, 1.4));
    const sun = new THREE.DirectionalLight(0xfff1dd, 1.6);
    sun.position.set(0.5, 1, 0.3);
    this.scene.add(sun);

    const flashTex = makeFlashTexture();
    for (const id of Object.keys(WEAPONS) as WeaponId[]) {
      const model = createWeaponModel(id);
      model.visible = false;
      model.traverse((o) => {
        // Draw the gun on top of everything in this scene.
        if (o instanceof THREE.Mesh) o.renderOrder = 1;
      });
      this.rig.add(model);
      this.models.set(id, model);

      const flash = makeFlash(flashTex, id === 'shotgun' || id === 'sniper' ? 1.5 : 1);
      model.getObjectByName('muzzle')!.add(flash);
      this.flashes.set(id, flash);
    }
    this.setWeapon('pistol');
  }

  /** Gives the guns something to reflect so metal doesn't look black. */
  initEnvironment(renderer: THREE.WebGLRenderer): void {
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.6;
    pmrem.dispose();
  }

  /**
   * Prepares every gun's shaders up front, so the first switch to each
   * weapon doesn't stutter.
   */
  precompile(renderer: THREE.WebGLRenderer): void {
    const saved = [...this.models.values()].map((m) => m.visible);
    for (const m of this.models.values()) m.visible = true;
    for (const f of this.flashes.values()) f.visible = true;
    renderer.compile(this.scene, this.camera);
    [...this.models.values()].forEach((m, i) => (m.visible = saved[i]));
    for (const f of this.flashes.values()) f.visible = false;
  }

  setWeapon(id: WeaponId): void {
    this.models.get(this.current)!.visible = false;
    this.current = id;
    this.models.get(id)!.visible = true;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Called when a shot is fired. */
  kick(strength: number): void {
    this.kickBack += 0.035 * strength;
    this.kickUp += 0.06 * strength;
    this.flashTimer = 0.05;
    const f = this.flashes.get(this.current)!;
    f.rotation.z = Math.random() * Math.PI;
    f.scale.setScalar(0.8 + Math.random() * 0.5);
  }

  update(dt: number, s: ViewmodelState): void {
    this.time += dt;
    const model = this.models.get(this.current)!;

    // Recoil springs back.
    this.kickBack *= Math.exp(-dt * 14);
    this.kickUp *= Math.exp(-dt * 12);

    // Sway: the gun lags behind mouse movement a little.
    const swayScale = 1 - s.ads * 0.8;
    this.swayX += (-s.lookDX * 0.0004 * swayScale - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (s.lookDY * 0.0004 * swayScale - this.swayY) * Math.min(1, dt * 10);
    this.swayX = THREE.MathUtils.clamp(this.swayX, -0.04, 0.04);
    this.swayY = THREE.MathUtils.clamp(this.swayY, -0.04, 0.04);

    // Bob while walking, gentle breathing while standing.
    if (s.onGround) this.bobT += dt * (6 + s.sprint * 4) * s.move;
    const bobAmt = (0.008 + s.sprint * 0.012) * s.move * (1 - s.ads * 0.85);
    const bobX = Math.sin(this.bobT) * bobAmt;
    const bobY = -Math.abs(Math.cos(this.bobT)) * bobAmt;
    const breathe = Math.sin(this.time * 1.6) * 0.002 * (1 - s.ads);

    this.reloadBlend += ((s.reloading ? 1 : 0) - this.reloadBlend) * Math.min(1, dt * 10);

    // Blend hip -> aim pose.
    const pos = model.position.lerpVectors(HIP_POSE, AIM_POSE[this.current], s.ads);
    pos.x += bobX + this.swayX;
    pos.y += bobY + breathe + this.swayY - s.lowered * 0.35 - this.reloadBlend * 0.06 - s.sprint * 0.04;
    pos.z += this.kickBack;

    model.rotation.set(
      this.kickUp - s.lowered * 0.9 - this.reloadBlend * 0.5 - s.sprint * 0.35,
      this.swayX * 2 + s.sprint * 0.6,
      this.reloadBlend * 0.5 + s.sprint * 0.25,
    );

    this.flashTimer -= dt;
    this.flashes.get(this.current)!.visible = this.flashTimer > 0;
  }

  /** World position of the muzzle as seen from `mainCamera` (for tracers). */
  muzzleWorldPosition(mainCamera: THREE.Camera, out: THREE.Vector3): THREE.Vector3 {
    const muzzle = this.models.get(this.current)!.getObjectByName('muzzle')!;
    this.camera.updateMatrixWorld();
    muzzle.getWorldPosition(out); // relative to the viewmodel camera at the origin
    return out.applyMatrix4(mainCamera.matrixWorld);
  }

  render(renderer: THREE.WebGLRenderer): void {
    if (!this.visible) return;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}

function makeFlashTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,230,1)');
  grad.addColorStop(0.25, 'rgba(255,210,120,0.9)');
  grad.addColorStop(0.6, 'rgba(255,140,40,0.35)');
  grad.addColorStop(1, 'rgba(255,100,0,0)');
  g.fillStyle = grad;
  // A star shape: a circle plus spikes.
  g.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const r = i % 2 === 0 ? 64 : 26;
    g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
  }
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeFlash(tex: THREE.Texture, size: number): THREE.Object3D {
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const g = new THREE.Group();
  // Facing the camera...
  const front = new THREE.Mesh(new THREE.PlaneGeometry(0.16 * size, 0.16 * size), mat);
  // ...and two side-on planes so it looks like a flame cone from the side.
  const side1 = new THREE.Mesh(new THREE.PlaneGeometry(0.1 * size, 0.24 * size), mat);
  side1.rotation.set(Math.PI / 2, 0, 0);
  side1.position.z = -0.08 * size;
  const side2 = new THREE.Mesh(new THREE.PlaneGeometry(0.24 * size, 0.1 * size), mat);
  side2.rotation.y = Math.PI / 2;
  side2.position.z = -0.08 * size;
  g.add(front, side1, side2);
  for (const m of [front, side1, side2]) m.renderOrder = 2;
  g.visible = false;
  return g;
}
