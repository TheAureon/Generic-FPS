import * as THREE from 'three';
import { WEAPONS, type WeaponId } from '../config';
import type { SkyDef } from '../map/MapTypes';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getFlashTexture } from '../assets/textures';
import { createWeaponModel, markerPosition } from '../assets/weaponModels';
import { AIM_POSE, BOLT, EJECT_PORT, HIP_POSE, PUMP, RELOADS, SIGHT_DISTANCE, smoothstep, window01 } from './animations';
import { ViewmodelArms } from './ViewmodelArms';

/**
 * The gun you see in your hands. It lives in its own little scene with its
 * own camera and is drawn on top of the world, so it never clips into walls
 * and isn't affected by your field-of-view setting.
 */

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
  /** 0..1 through the current reload (or current shell), -1 if not reloading. */
  reloadProgress: number;
  onGround: boolean;
}

export class Viewmodel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
  /** Moves with sway/bob/recoil. */
  private rig = new THREE.Group();
  private models = new Map<WeaponId, THREE.Group>();
  private flashes = new Map<WeaponId, THREE.Object3D>();
  /** Per gun: aiming position and shell ejection point (from defaults or a custom model's markers). */
  private aimPose = new Map<WeaponId, THREE.Vector3>();
  private ejectPort = new Map<WeaponId, THREE.Vector3>();
  private current: WeaponId = 'pistol';

  private kickBack = 0;
  private kickUp = 0;
  private swayX = 0;
  private swayY = 0;
  private bobT = 0;
  private reloadBlend = 0;
  /** Seconds since the last shotgun shot (drives the pump action). */
  private pumpT = 99;
  /** Seconds since the last sniper shot (drives the bolt action). */
  private boltT = 99;
  private bolt = { reach: 0, lift: 0, back: 0 };
  private arms: ViewmodelArms;
  private flashTimer = 0;
  private time = 0;
  private casings: Casing[] = [];
  private nextCasing = 0;
  visible = true;
  private hemi = new THREE.HemisphereLight(0xdde8ff, 0x4a4036, 1.4);
  private sun = new THREE.DirectionalLight(0xfff1dd, 1.6);
  /** Extra light matching nearby lamps (starts dark). */
  private lampAmbient = new THREE.AmbientLight(0x000000, 1);

  constructor() {
    this.scene.add(this.lampAmbient);
    this.scene.add(this.camera);
    this.camera.add(this.rig);
    this.scene.add(this.hemi);
    const sun = this.sun;
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
      // A custom model can mark its sight and ejection port.
      const sight = markerPosition(model, 'sight');
      this.aimPose.set(id, sight ? new THREE.Vector3(-sight.x, -sight.y, -SIGHT_DISTANCE - sight.z) : AIM_POSE[id].clone());
      this.ejectPort.set(id, markerPosition(model, 'eject') ?? EJECT_PORT[id].clone());

      const flash = makeFlash(flashTex, id === 'shotgun' || id === 'sniper' ? 1.5 : 1);
      model.getObjectByName('muzzle')!.add(flash);
      this.flashes.set(id, flash);
    }
    this.arms = new ViewmodelArms(this.rig);
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
    c.mesh.position.copy(this.ejectPort.get(this.current)!).applyMatrix4(model.matrixWorld);
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
    this.pumpT = 99;
    this.boltT = 99;
    this.models.get(id)!.visible = true;
    this.arms.setWeapon(id, this.models.get(id)!);
  }

  /** Light the gun like the map: the sun's color and the sky's tint. */
  matchLighting(sky: SkyDef): void {
    this.sun.color.set(sky.sunColor);
    this.hemi.color.set(sky.zenith).lerp(new THREE.Color(0xffffff), 0.6);
    this.hemi.groundColor.set(sky.ground ?? 0x4a4036);
  }

  /** Blend the gun's extra light toward the lamp light around the player. */
  tintLamp(color: THREE.Color, dt: number): void {
    this.lampAmbient.color.lerp(color, 1 - Math.exp(-dt * 5));
  }

  /** The sniper's bolt is being worked: the scope is unusable until it's done. */
  get cyclingBolt(): boolean {
    return this.current === 'sniper' && boltBusy(this.boltT);
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
    // The shotgun's shell comes out when it's pumped, not when it fires.
    // Same for the sniper: the case comes out when the bolt is pulled back.
    if (this.current === 'shotgun') this.pumpT = 0;
    else if (this.current === 'sniper') this.boltT = 0;
    else this.ejectCasing();
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

    this.reloadBlend += ((s.reloadProgress >= 0 ? 1 : 0) - this.reloadBlend) * Math.min(1, dt * 10);
    // Reloads tilt the gun to show the magazine well (shell loading tilts it less).
    const anim = RELOADS[this.current];
    const rl = this.reloadBlend * anim.tilt;

    // Shotgun pump: shortly after a shot, rack the pump back (spent shell pops
    // out) and push it forward again, well before the next shot is ready.
    const prevPumpT = this.pumpT;
    this.pumpT += dt;
    const u = this.pumpT - PUMP.start;
    let rack = 0;
    if (u > 0 && u < PUMP.back) rack = smoothstep(u / PUMP.back);
    else if (u >= PUMP.back && u < PUMP.back + PUMP.forward) rack = 1 - smoothstep((u - PUMP.back) / PUMP.forward);
    const pump = rack * PUMP.travel;

    // Pistol reload ends with racking the slide: the gun is pushed out and
    // turned to show its left side, where the left hand grabs the slide.
    const rp = s.reloadProgress;
    const slideRack = anim.slide && rp >= 0 ? window01(rp, anim.slide.poseIn, anim.slide.poseOut) : 0;
    if (prevPumpT - PUMP.start < PUMP.back && u >= PUMP.back) this.ejectCasing();

    // Sniper bolt action: right hand to the bolt, turn it up, pull it back
    // (the case flies out), push it forward, turn it down, hand back to the grip.
    const prevBoltT = this.boltT;
    this.boltT += dt;
    const bk = boltKeys(this.boltT, this.bolt);
    if (prevBoltT < BOLT_EJECT && this.boltT >= BOLT_EJECT) this.ejectCasing();
    // A small jolt when the new magazine is slapped in.
    const seat = rp >= 0 && anim.seatAt !== undefined ? Math.exp(-Math.pow((rp - anim.seatAt) * 18, 2)) : 0;

    // Blend hip -> aim pose.
    const pos = model.position.lerpVectors(HIP_POSE, this.aimPose.get(this.current)!, s.ads);
    // Reloading brings the gun in toward the middle, canted so you see the magazine.
    pos.x += bobX + this.swayX - rl * 0.06;
    pos.y += bobY + breathe + this.swayY - s.lowered * 0.35 + rl * 0.045 + seat * 0.012 - s.sprint * 0.04;
    pos.z += this.kickBack + rl * 0.06 + rack * 0.015 - slideRack * 0.1;
    pos.x -= slideRack * 0.06;
    pos.y += slideRack * 0.02;
    // Working the bolt: the gun cants to show its right side and moves out a
    // little, so you can see the bolt and the hand doesn't fill the screen.
    pos.x -= bk * 0.02;
    pos.y -= bk * 0.02;
    pos.z -= bk * 0.05;

    model.rotation.set(
      this.kickUp - s.lowered * 0.9 + rl * 0.12 + seat * 0.05 - s.sprint * 0.35,
      this.swayX * 2 + rl * 0.3 - slideRack * 1.1 + s.sprint * 0.6,
      rl * 0.6 + rack * 0.12 + bk * 0.4 - slideRack * 0.6 + s.sprint * 0.25,
    );
    this.arms.update(dt, model, s.reloadProgress, pump, this.bolt);

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

/** When the bolt is at the back of its pull (the case ejects then), and when it's all done. */
const BOLT_EJECT = BOLT.start + BOLT.reach + BOLT.lift + BOLT.back;
const BOLT_END = BOLT_EJECT + BOLT.forward + BOLT.down + BOLT.ret;

/** Fills in the bolt pose for time `t`; returns how "busy" the hand is (0..1). */
function boltKeys(t: number, out: { reach: number; lift: number; back: number }): number {
  let u = t - BOLT.start;
  out.reach = out.lift = out.back = 0;
  if (u <= 0 || t >= BOLT_END) return 0;
  const seg = (len: number) => {
    const k = Math.min(1, Math.max(0, u / len));
    u -= len;
    return smoothstep(k);
  };
  const reach = seg(BOLT.reach);
  const lift = seg(BOLT.lift);
  const back = seg(BOLT.back);
  const fwd = seg(BOLT.forward);
  const down = seg(BOLT.down);
  const ret = seg(BOLT.ret);
  out.reach = reach * (1 - ret);
  out.lift = lift * (1 - down);
  out.back = back * (1 - fwd) * BOLT.travel;
  return out.reach;
}

/** True while the sniper's bolt is being worked (you can't use the scope then). */
export function boltBusy(t: number): boolean {
  return t > BOLT.start && t < BOLT_END - BOLT.ret * 0.5;
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
