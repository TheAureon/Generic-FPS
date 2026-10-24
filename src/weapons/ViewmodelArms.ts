import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { markerPosition } from '../assets/weaponModels';
import type { WeaponId } from '../config';
import {
  BOLT, BOLT_KNOB, ELBOWS, HANDS, RELOADS, SPOT_OFFSETS, smoothstep, window01,
  type HandPoints, type KeyTable, type Spot,
} from './animations';

/**
 * Your arms in first person: simple box sleeves with gloves, holding the gun.
 * Each frame the hands are placed on the gun's grip points, so they follow
 * every bob, sway and recoil. During reloads the left hand plays the reload
 * keyframes from animations.ts, and the gun's moving parts (magazine, slide,
 * pump, bolt) move with it.
 */

const NO_BOLT = { reach: 0, lift: 0, back: 0 };
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const _elbow = new THREE.Vector3();
const _q = new THREE.Quaternion();
const v0 = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

/**
 * A movable part of the gun (magazine, slide, pump, bolt). Moves are given in
 * the gun's own coordinates, so this works however deep the part sits inside
 * a loaded model.
 */
class MovingPart {
  private homePos: THREE.Vector3;
  private homeQuat: THREE.Quaternion;
  /** Part's parent → gun coordinates, and back. */
  private toGun = new THREE.Matrix4();
  private fromGun = new THREE.Matrix4();
  private homeInGun = new THREE.Vector3();
  private zAxis = new THREE.Vector3();

  constructor(readonly node: THREE.Object3D, gun: THREE.Object3D) {
    this.homePos = node.position.clone();
    this.homeQuat = node.quaternion.clone();
    gun.updateMatrixWorld(true);
    this.toGun.copy(gun.matrixWorld).invert().multiply(node.parent!.matrixWorld);
    this.fromGun.copy(this.toGun).invert();
    this.homeInGun.copy(this.homePos).applyMatrix4(this.toGun);
    // The gun's Z axis, seen from the part's parent (for turning the bolt).
    this.zAxis.set(0, 0, 1).transformDirection(this.fromGun);
  }

  /** Offset from home (gun coordinates), plus an optional turn around the gun's length. */
  set(offset: THREE.Vector3, turn = 0): void {
    this.node.position.copy(_b.copy(this.homeInGun).add(offset).applyMatrix4(this.fromGun));
    if (turn) this.node.quaternion.copy(_q.setFromAxisAngle(this.zAxis, turn)).multiply(this.homeQuat);
    else this.node.quaternion.copy(this.homeQuat);
  }

  reset(): void {
    this.node.position.copy(this.homePos);
    this.node.quaternion.copy(this.homeQuat);
  }

  /** Where a point given in the part's own coordinates is, in gun coordinates. */
  pointInGun(local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    this.node.updateMatrix();
    return out.copy(local).applyMatrix4(this.node.matrix).applyMatrix4(this.toGun);
  }
}

export class ViewmodelArms {
  readonly right: THREE.Group;
  readonly left: THREE.Group;
  /** A shotgun shell carried by the left hand while loading. */
  private shell: THREE.Mesh;
  private leftPos = new THREE.Vector3();
  private leftLocal = new THREE.Vector3();
  private leftInit = false;
  private weapon: WeaponId = 'pistol';
  /** This gun's hand points (defaults, or markers from a custom model). */
  private hands: HandPoints = HANDS.pistol;
  private mag: MovingPart | null = null;
  private slide: MovingPart | null = null;
  private pump: MovingPart | null = null;
  private bolt: MovingPart | null = null;

  constructor(parent: THREE.Object3D) {
    const mats: ArmMaterials = {
      sleeve: new THREE.MeshStandardMaterial({ color: 0x4a5040, roughness: 0.9 }),
      // Tactical gloves: dark fabric, a molded knuckle guard, and grippy palm and finger pads.
      glove: new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.85 }),
      guard: new THREE.MeshStandardMaterial({ color: 0x3d4248, roughness: 0.45, metalness: 0.1 }),
      pad: new THREE.MeshStandardMaterial({ color: 0x1c1e21, roughness: 0.95 }),
      strap: new THREE.MeshStandardMaterial({ color: 0x56584f, roughness: 0.8 }),
    };
    this.right = makeArm(mats, 1);
    this.left = makeArm(mats, -1);
    this.shell = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.011, 0.05, 8),
      new THREE.MeshStandardMaterial({ color: 0xb3302a, roughness: 0.5 }),
    );
    this.shell.rotation.x = Math.PI / 2;
    this.shell.position.set(0.012, 0.03, -0.05);
    this.shell.renderOrder = 1;
    this.shell.visible = false;
    this.left.add(this.shell);
    parent.add(this.right, this.left);
  }

  setWeapon(id: WeaponId, model: THREE.Object3D): void {
    for (const p of [this.mag, this.slide, this.pump, this.bolt]) p?.reset();
    this.weapon = id;
    const part = (name: string) => {
      const node = model.getObjectByName(name);
      return node && node !== model ? new MovingPart(node, model) : null;
    };
    this.mag = part('mag');
    this.slide = part('slide');
    this.pump = part('pump');
    this.bolt = part('bolt');

    // Hand points: a custom model's markers win over the defaults.
    const d = HANDS[id];
    const marker = (name: string, fallback: THREE.Vector3 | undefined) => markerPosition(model, name) ?? fallback?.clone();
    this.hands = {
      right: marker('grip_right', d.right)!,
      left: marker('grip_left', d.left)!,
      reload: marker('grip_reload', d.reload)!,
      slide: marker('grip_slide', d.slide),
    };
    this.leftInit = false;
  }

  /**
   * Place both arms on `model` (already posed for this frame).
   * `reload` is 0..1 through the current reload (or one shell), or -1.
   * `pump` is how far the shotgun's pump is pulled back (meters).
   * `bolt` is the sniper's bolt action: how far the right hand has moved from
   * the grip to the bolt (0..1), how far the bolt is turned up (0..1), and how
   * far it's pulled back (meters).
   */
  update(dt: number, model: THREE.Object3D, reload: number, pump = 0, bolt = NO_BOLT): void {
    const hands = this.hands;
    const anim = RELOADS[this.weapon];
    model.updateMatrix();
    const m = model.matrix;

    // Right hand: on the grip, or working the bolt.
    _a.copy(hands.right);
    if (this.bolt) {
      this.bolt.set(v0.set(0, 0, bolt.back), bolt.lift * BOLT.liftAngle);
      if (bolt.reach > 0) _a.lerp(this.bolt.pointInGun(BOLT_KNOB, _b), bolt.reach);
    }
    _a.applyMatrix4(m);
    this.place(this.right, _a, ELBOWS.right);

    // Left hand: on the front grip (riding the pump), or doing the reload.
    this.pump?.set(v0.set(0, 0, pump));
    let target = _b.copy(hands.left).setZ(hands.left.z + pump).applyMatrix4(m);
    const inside = (w?: [number, number]) => !!w && reload >= w[0] && reload <= w[1];
    const holdingMag = reload >= 0 && inside(anim.holdMag);
    this.shell.visible = reload >= 0 && inside(anim.holdShell);
    if (reload >= 0) target = this.keyframe(anim.keys, reload, m, _b);

    // Follow the target quickly but smoothly (no pops when a reload starts or
    // is cancelled). Smoothed in the gun's own coordinates, so the hand stays
    // glued to the gun when it kicks or sways.
    _inv.copy(m).invert();
    target.applyMatrix4(_inv);
    if (!this.leftInit) {
      this.leftLocal.copy(target);
      this.leftInit = true;
    } else {
      this.leftLocal.lerp(target, 1 - Math.exp(-dt * 30));
    }
    this.leftPos.copy(this.leftLocal).applyMatrix4(m);
    const sl = anim.slide;
    const racking = sl && reload >= 0 ? window01(reload, sl.poseIn, sl.poseOut) : 0;
    this.place(this.left, this.leftPos, racking > 0 ? _elbow.lerpVectors(ELBOWS.left, ELBOWS.leftRacking, racking) : ELBOWS.left);

    // Pistol slide: follows the hand back, then snaps forward when let go.
    if (this.slide && sl) {
      let back = 0;
      if (reload > sl.grab && reload < sl.release) back = smoothstep((reload - sl.grab) / (sl.release - sl.grab));
      else if (reload >= sl.release && reload < sl.release + sl.snap) back = 1 - (reload - sl.release) / sl.snap;
      this.slide.set(v0.set(0, 0, back * sl.travel));
    }

    // The magazine travels with the hand while it's out of the gun.
    if (this.mag) {
      if (holdingMag) this.mag.set(_dir.copy(this.leftLocal).sub(hands.reload));
      else this.mag.reset();
    }
  }

  /** The left hand's target at time t of a reload (camera coordinates). */
  private keyframe(keys: KeyTable, t: number, m: THREE.Matrix4, out: THREE.Vector3): THREE.Vector3 {
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
    const [t0, s0] = keys[i];
    const [t1, s1] = keys[i + 1];
    const k = smoothstep((t - t0) / (t1 - t0));
    this.spot(s0, m, out);
    this.spot(s1, m, _dir);
    return out.lerp(_dir, k);
  }

  private spot(s: Spot, m: THREE.Matrix4, out: THREE.Vector3): THREE.Vector3 {
    const h = this.hands;
    const travel = RELOADS[this.weapon].slide?.travel ?? 0;
    switch (s) {
      case 'grip':
        return out.copy(h.left).applyMatrix4(m);
      case 'slide':
        return out.copy(h.slide ?? h.left).applyMatrix4(m);
      case 'slideBack':
        return out.copy(h.slide ?? h.left).add(v0.set(0, 0, travel)).applyMatrix4(m);
      case 'slideOff':
        return out.copy(h.slide ?? h.left).add(SPOT_OFFSETS.slideOff).applyMatrix4(m);
      case 'reload':
        return out.copy(h.reload).applyMatrix4(m);
      case 'below':
      case 'tap':
      case 'away':
        return out.copy(h.reload).applyMatrix4(m).add(SPOT_OFFSETS[s]);
    }
  }

  /** Point an arm from its hand back toward the (off-screen) elbow. */
  private place(arm: THREE.Group, hand: THREE.Vector3, elbowOffset: THREE.Vector3): void {
    arm.position.copy(hand);
    arm.quaternion.setFromUnitVectors(Z, _dir.copy(elbowOffset).normalize());
  }
}

interface ArmMaterials {
  sleeve: THREE.Material;
  glove: THREE.Material;
  guard: THREE.Material;
  pad: THREE.Material;
  strap: THREE.Material;
}

/**
 * One arm: a gloved hand at the origin (fingers curled forward along -Z, as
 * if gripping), sleeve running back along +Z. `side` is 1 for the right
 * hand, -1 for the left (the thumb is on the side toward the middle).
 */
function makeArm(m: ArmMaterials, side: 1 | -1): THREE.Group {
  const g = new THREE.Group();
  const part = (w: number, h: number, len: number, x: number, y: number, z: number, mat: THREE.Material, r = 0.006, rx = 0, ry = 0) => {
    const radius = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, len / 2 - 1e-4);
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, len, 2, radius), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, 0);
    mesh.renderOrder = 1;
    g.add(mesh);
  };
  // Back of the hand and palm.
  part(0.05, 0.042, 0.07, 0, 0.004, 0.018, m.glove, 0.012);
  // Molded knuckle guard across the back, and a vent strip behind it.
  part(0.046, 0.01, 0.024, 0, 0.026, -0.006, m.guard, 0.004);
  part(0.03, 0.006, 0.022, 0, 0.026, 0.026, m.guard, 0.003);
  // Four fingers curled down around the grip (two segments each), with grip pads.
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 0.0118 * -side + side * 0.001;
    const len = i === 0 || i === 3 ? 0.022 : 0.026;
    part(0.0105, 0.016, len, x, 0.008, -0.026, m.glove, 0.0045);
    part(0.0105, 0.024, 0.014, x, -0.012, -0.036, m.glove, 0.0045, -0.35);
    part(0.0095, 0.012, 0.004, x, -0.016, -0.0435, m.pad, 0.002, -0.35);
  }
  // Thumb, along the inner side and wrapped forward.
  part(0.015, 0.015, 0.042, -side * 0.026, 0.004, -0.004, m.glove, 0.006, 0, side * 0.45);
  part(0.012, 0.004, 0.02, -side * 0.031, 0.012, -0.016, m.pad, 0.002, 0, side * 0.45);
  // Palm pad underneath.
  part(0.044, 0.006, 0.05, 0, -0.018, 0.016, m.pad, 0.003);
  // Cuff with a hook-and-loop strap, then the sleeve (off the bottom of the screen).
  part(0.062, 0.06, 0.05, 0, 0.002, 0.075, m.glove, 0.012);
  part(0.064, 0.024, 0.032, side * 0.004, 0.012, 0.078, m.strap, 0.006);
  part(0.08, 0.08, 0.06, 0, 0, 0.115, m.sleeve, 0.016);
  part(0.075, 0.075, 0.56, 0, 0, 0.41, m.sleeve, 0.012);
  return g;
}
