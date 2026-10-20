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
}

const HANDS: Record<WeaponId, HandPoints> = {
  pistol: { right: v(0, -0.055, 0.05), left: v(-0.03, -0.07, 0.03), reload: v(0, -0.125, 0.06) },
  rifle: { right: v(0, -0.08, 0.1), left: v(0, -0.045, -0.25), reload: v(0, -0.15, -0.075) },
  shotgun: { right: v(0, -0.08, 0.1), left: v(0, -0.05, -0.3), reload: v(0, -0.05, -0.06) },
  sniper: { right: v(0, -0.085, 0.12), left: v(0, -0.03, -0.2), reload: v(0, -0.09, -0.03) },
};

/** Where each elbow is, relative to its hand (camera space): arms come from the lower corners. */
const RIGHT_ELBOW = v(0.15, -0.13, 0.26);
const LEFT_ELBOW = v(-0.17, -0.17, 0.22);

function v(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z);
}
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Keyframes for the left hand: [time 0..1, point name]. */
type Spot = 'grip' | 'reload' | 'below' | 'away' | 'tap';
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
const SHELL_KEYS: [number, Spot][] = [
  [0, 'grip'],
  [0.25, 'away'], // fetch a shell
  [0.5, 'below'],
  [0.68, 'reload'], // push it into the loading port
  [0.78, 'reload'],
  [1, 'grip'],
];

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _inv = new THREE.Matrix4();
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
    this.leftInit = false;
  }

  /**
   * Place both arms on `model` (already posed for this frame).
   * `reload` is 0..1 through the current reload (or one shell), or -1.
   * `pump` is how far the shotgun's pump is pulled back (meters).
   */
  update(dt: number, model: THREE.Object3D, reload: number, perShell: boolean, pump = 0): void {
    const hands = HANDS[this.weapon];
    model.updateMatrix();
    const m = model.matrix;

    // Right hand: always on the grip.
    _a.copy(hands.right).applyMatrix4(m);
    this.place(this.right, _a, RIGHT_ELBOW);

    // Left hand: on the front grip, or doing the reload.
    if (this.pump) this.pump.position.z = this.pumpHome + pump;
    let target = _b.copy(hands.left).setZ(hands.left.z + pump).applyMatrix4(m);
    let holding = false;
    if (reload >= 0) {
      const keys = perShell ? SHELL_KEYS : MAG_KEYS;
      target = this.keyframe(keys, reload, hands, m, _b);
      holding = perShell ? reload > 0.22 && reload < 0.7 : reload > 0.24 && reload < 0.76;
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
    this.place(this.left, this.leftPos, LEFT_ELBOW);

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
