import * as THREE from 'three';
import type { WeaponId } from '../config';

/**
 * Your arms in first person: simple box sleeves with gloves, holding the gun.
 * Each frame the hands are placed on the gun's grip points, so they follow
 * every bob, sway and recoil. During reloads the left hand acts out the
 * reload (swap the magazine, or load shells one by one).
 */

interface HandPoints {
  /** Right hand on the pistol grip, left hand on the front (gun coordinates). */
  right: THREE.Vector3;
  left: THREE.Vector3;
  /** Where the left hand grabs the magazine / pushes shells in. */
  reload: THREE.Vector3;
  /** Pistol: where the left hand grabs the back of the slide to rack it. */
  slide?: THREE.Vector3;
}

const HANDS: Record<WeaponId, HandPoints> = {
  pistol: { right: v(0, -0.055, 0.05), left: v(-0.03, -0.07, 0.03), reload: v(0, -0.125, 0.06), slide: v(-0.03, 0.035, 0.075) },
  rifle: { right: v(0, -0.08, 0.1), left: v(0, -0.045, -0.25), reload: v(0, -0.15, -0.075) },
  shotgun: { right: v(0, -0.08, 0.1), left: v(0, -0.05, -0.3), reload: v(0, -0.05, -0.06) },
  sniper: { right: v(0, -0.085, 0.12), left: v(0, -0.03, -0.2), reload: v(0, -0.09, -0.03) },
};

/** Where each elbow is, relative to its hand (camera space): arms come from the lower corners. */
const RIGHT_ELBOW = v(0.15, -0.13, 0.26);
const LEFT_ELBOW = v(-0.17, -0.17, 0.22);
/** Left elbow while racking the pistol slide: out to the side, so the arm doesn't cover the gun. */
const LEFT_ELBOW_RACK = v(-0.3, -0.1, 0.12);

function v(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z);
}
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Keyframes for the left hand: [time 0..1, point name]. */
type Spot = 'grip' | 'reload' | 'below' | 'away' | 'tap' | 'slide' | 'slideBack' | 'slideOff';
const MAG_KEYS: [number, Spot][] = [
  [0, 'grip'],
  [0.16, 'reload'],
  [0.24, 'reload'], // grab the magazine
  [0.42, 'away'], // pull it out and drop it out of view
  [0.55, 'away'], // (grab a fresh one)
  [0.7, 'below'],
  [0.76, 'reload'], // push it in
  [0.82, 'tap'], // slap it home
  [0.86, 'reload'],
  [1, 'grip'],
];
/** Pistol: a quicker magazine swap, then rack the slide to chamber a round. */
const PISTOL_KEYS: [number, Spot][] = [
  [0, 'grip'],
  [0.12, 'reload'],
  [0.18, 'reload'], // grab the magazine
  [0.32, 'away'],
  [0.42, 'away'],
  [0.54, 'below'],
  [0.6, 'reload'], // push it in
  [0.65, 'tap'],
  [0.68, 'reload'],
  [0.78, 'slide'], // grab the back of the slide
  [0.86, 'slideBack'], // pull it back...
  [0.9, 'slideOff'], // ...and let go: it snaps forward
  [1, 'grip'],
];
/** When the slide is pulled back and released (fractions of the pistol reload). */
const SLIDE_GRAB = 0.78, SLIDE_RELEASE = 0.86, SLIDE_TRAVEL = 0.04;
const SHELL_KEYS: [number, Spot][] = [
  [0, 'grip'],
  [0.25, 'away'], // fetch a shell
  [0.5, 'below'],
  [0.68, 'reload'], // push it into the loading port
  [0.78, 'reload'],
  [1, 'grip'],
];

const NO_BOLT = { reach: 0, lift: 0, back: 0 };
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _inv = new THREE.Matrix4();
const _elbow = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

export class ViewmodelArms {
  readonly right: THREE.Group;
  readonly left: THREE.Group;
  /** A shotgun shell carried by the left hand while loading. */
  private shell: THREE.Mesh;
  private leftPos = new THREE.Vector3();
  private leftLocal = new THREE.Vector3();
  private leftInit = false;
  private mag: THREE.Object3D | null = null;
  private magHome = new THREE.Vector3();
  private pump: THREE.Object3D | null = null;
  private pumpHome = 0;
  private slide: THREE.Object3D | null = null;
  private slideHome = 0;
  private bolt: THREE.Object3D | null = null;
  private boltHome = 0;
  private weapon: WeaponId = 'pistol';

  constructor(parent: THREE.Object3D) {
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x4a5040, roughness: 0.9 });
    const cuff = new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.85 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x6e5a44, roughness: 0.75 });
    this.right = makeArm(sleeve, cuff, glove);
    this.left = makeArm(sleeve, cuff, glove);
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
    if (this.mag) this.mag.position.copy(this.magHome);
    this.weapon = id;
    this.mag = model.getObjectByName('mag') ?? null;
    if (this.mag) this.magHome.copy(this.mag.position);
    if (this.pump) this.pump.position.z = this.pumpHome;
    this.pump = model.getObjectByName('pump') ?? null;
    if (this.pump) this.pumpHome = this.pump.position.z;
    if (this.slide) this.slide.position.z = this.slideHome;
    this.slide = model.getObjectByName('slide') ?? null;
    if (this.slide) this.slideHome = this.slide.position.z;
    if (this.bolt) this.bolt.position.z = this.boltHome;
    if (this.bolt) this.bolt.rotation.z = 0;
    this.bolt = model.getObjectByName('bolt') ?? null;
    if (this.bolt) this.boltHome = this.bolt.position.z;
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
  update(dt: number, model: THREE.Object3D, reload: number, perShell: boolean, pump = 0, bolt = NO_BOLT): void {
    const hands = HANDS[this.weapon];
    model.updateMatrix();
    const m = model.matrix;

    // Right hand: on the grip, or working the bolt.
    _a.copy(hands.right);
    if (this.bolt) {
      this.bolt.rotation.z = bolt.lift * 1.25;
      this.bolt.position.z = this.boltHome + bolt.back;
      if (bolt.reach > 0) {
        // The knob, in gun coordinates (follows the bolt as it turns and slides).
        this.bolt.updateMatrix();
        _b.set(0.065, -0.012, 0.005).applyMatrix4(this.bolt.matrix);
        _a.lerp(_b, bolt.reach);
      }
    }
    _a.applyMatrix4(m);
    this.place(this.right, _a, RIGHT_ELBOW);

    // Left hand: on the front grip, or doing the reload.
    if (this.pump) this.pump.position.z = this.pumpHome + pump;
    let target = _b.copy(hands.left).setZ(hands.left.z + pump).applyMatrix4(m);
    let holding = false;
    if (reload >= 0) {
      const pistol = !!hands.slide;
      const keys = perShell ? SHELL_KEYS : pistol ? PISTOL_KEYS : MAG_KEYS;
      target = this.keyframe(keys, reload, hands, m, _b);
      holding = perShell ? reload > 0.22 && reload < 0.7 : pistol ? reload > 0.18 && reload < 0.6 : reload > 0.24 && reload < 0.76;
      this.shell.visible = perShell && holding;
    } else {
      this.shell.visible = false;
    }
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
    const racking = hands.slide && reload >= 0 ? smooth(Math.min(1, Math.max(0, (reload - 0.68) / 0.1))) * (1 - smooth(Math.min(1, Math.max(0, (reload - 0.9) / 0.1)))) : 0;
    this.place(this.left, this.leftPos, racking > 0 ? _elbow.lerpVectors(LEFT_ELBOW, LEFT_ELBOW_RACK, racking) : LEFT_ELBOW);

    // Pistol slide: follows the hand back, then snaps forward when let go.
    if (this.slide) {
      let back = 0;
      if (reload > SLIDE_GRAB && reload < SLIDE_RELEASE) back = smooth((reload - SLIDE_GRAB) / (SLIDE_RELEASE - SLIDE_GRAB));
      else if (reload >= SLIDE_RELEASE && reload < SLIDE_RELEASE + 0.025) back = 1 - (reload - SLIDE_RELEASE) / 0.025;
      this.slide.position.z = this.slideHome + back * SLIDE_TRAVEL;
    }

    // The magazine travels with the hand while it's out of the gun.
    if (this.mag) {
      this.mag.position.copy(this.magHome);
      if (holding && !perShell) {
        // Hand offset from the grab point, turned into the gun's own coordinates.
        _a.copy(hands.reload).applyMatrix4(m);
        _dir.subVectors(this.leftPos, _a).applyQuaternion(_q.copy(model.quaternion).invert());
        this.mag.position.add(_dir);
      }
    }
  }

  private keyframe(keys: [number, Spot][], t: number, hands: HandPoints, m: THREE.Matrix4, out: THREE.Vector3): THREE.Vector3 {
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
    const [t0, s0] = keys[i];
    const [t1, s1] = keys[i + 1];
    const k = smooth(Math.min(1, Math.max(0, (t - t0) / (t1 - t0))));
    this.spot(s0, hands, m, out);
    this.spot(s1, hands, m, _dir);
    return out.lerp(_dir, k);
  }

  private spot(s: Spot, hands: HandPoints, m: THREE.Matrix4, out: THREE.Vector3): THREE.Vector3 {
    switch (s) {
      case 'grip':
        return out.copy(hands.left).applyMatrix4(m);
      case 'slide':
        return out.copy(hands.slide ?? hands.left).applyMatrix4(m);
      case 'slideBack':
        return out.copy(hands.slide ?? hands.left).setZ((hands.slide?.z ?? 0) + SLIDE_TRAVEL).applyMatrix4(m);
      case 'slideOff':
        // Let go: the hand flicks up and back off the slide.
        return out.copy(hands.slide ?? hands.left).add(v0.set(-0.05, 0.015, 0.07)).applyMatrix4(m);
      case 'reload':
        return out.copy(hands.reload).applyMatrix4(m);
      case 'below':
        return out.copy(hands.reload).applyMatrix4(m).add(v0.set(0, -0.06, 0.01));
      case 'tap':
        return out.copy(hands.reload).applyMatrix4(m).add(v0.set(0, 0.015, 0));
      case 'away':
        // Down and out of view.
        return out.copy(hands.reload).applyMatrix4(m).add(v0.set(-0.06, -0.32, 0.08));
    }
  }

  /** Point an arm from its hand back toward the (off-screen) elbow. */
  private place(arm: THREE.Group, hand: THREE.Vector3, elbowOffset: THREE.Vector3): void {
    arm.position.copy(hand);
    arm.quaternion.setFromUnitVectors(Z, _dir.copy(elbowOffset).normalize());
  }
}

const v0 = new THREE.Vector3();

/** One arm: glove at the origin, sleeve running back along +Z. */
function makeArm(sleeve: THREE.Material, cuff: THREE.Material, glove: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const part = (w: number, h: number, len: number, z: number, mat: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, len), mat);
    mesh.position.z = z;
    mesh.renderOrder = 1;
    g.add(mesh);
  };
  part(0.05, 0.055, 0.1, 0.01, glove); // hand
  part(0.066, 0.066, 0.05, 0.08, cuff); // glove cuff
  part(0.075, 0.075, 0.6, 0.39, sleeve); // sleeve, off the bottom of the screen
  return g;
}
