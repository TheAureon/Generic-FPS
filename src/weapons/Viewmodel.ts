import * as THREE from 'three';
import { WEAPONS, type WeaponId } from '../config';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getFlashTexture } from '../assets/textures';
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

/** Where spent shells pop out of each gun (in the gun's own coordinates). */
const EJECT_PORT: Record<WeaponId, THREE.Vector3> = {
  pistol: new THREE.Vector3(0.02, 0.045, -0.03),
  rifle: new THREE.Vector3(0.03, 0.025, -0.03),
  shotgun: new THREE.Vector3(0.03, 0.02, 0.0),
  sniper: new THREE.Vector3(0.03, 0.025, 0.06),
};

interface Casing {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

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
  private casings: Casing[] = [];
  private nextCasing = 0;
  visible = true;

  constructor() {
    this.scene.add(this.camera);
    this.camera.add(this.rig);
    this.scene.add(new THREE.HemisphereLight(0xdde8ff, 0x4a4036, 1.4));
    const sun = new THREE.DirectionalLight(0xfff1dd, 1.6);
    sun.position.set(0.5, 1, 0.3);
    this.scene.add(sun);

    const flashTex = getFlashTexture();
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

    // Pool of spent shell casings (brass; the shotgun's are red).
    const brass = new THREE.MeshStandardMaterial({ color: 0xd9a63a, metalness: 0.8, roughness: 0.3 });
    const geo = new THREE.CylinderGeometry(0.0045, 0.0045, 0.02, 8);
    for (let i = 0; i < 14; i++) {
      const mesh = new THREE.Mesh(geo, brass.clone());
      mesh.visible = false;
      mesh.renderOrder = 1;
      this.camera.add(mesh);
      this.casings.push({ mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 });
    }
  }

  /** Pop a spent shell out of the gun's ejection port. */
  private ejectCasing(): void {
    const c = this.casings[this.nextCasing];
    this.nextCasing = (this.nextCasing + 1) % this.casings.length;
    const model = this.models.get(this.current)!;
    model.updateMatrixWorld(true);
    // The camera sits at the origin of this little scene, so world = camera space.
    c.mesh.position.copy(EJECT_PORT[this.current]).applyMatrix4(model.matrixWorld);
    c.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    const shotgun = this.current === 'shotgun';
    c.mesh.scale.set(shotgun ? 2.2 : 1, shotgun ? 2 : 1, shotgun ? 2.2 : 1);
    (c.mesh.material as THREE.MeshStandardMaterial).color.set(shotgun ? 0xb3302a : 0xd9a63a);
    c.vel.set(0.9 + Math.random() * 0.5, 0.9 + Math.random() * 0.5, 0.1 + Math.random() * 0.3);
    c.spin.set(Math.random() * 30, Math.random() * 30, Math.random() * 30);
    c.life = 0.6;
    c.mesh.visible = true;
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
    for (const c of this.casings) c.mesh.visible = true;
    renderer.compile(this.scene, this.camera);
    for (const c of this.casings) c.mesh.visible = false;
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
    this.ejectCasing();
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

    for (const c of this.casings) {
      if (c.life <= 0) continue;
      c.life -= dt;
      c.vel.y -= 6 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      c.mesh.rotation.z += c.spin.z * dt;
      if (c.life <= 0) c.mesh.visible = false;
    }

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
