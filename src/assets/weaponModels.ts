import * as THREE from 'three';
import type { WeaponId } from '../config';

/**
 * Low-poly gun models built from boxes and cylinders.
 * Convention: the gun points down -Z, and has a child object named 'muzzle'
 * at the tip of the barrel (used for muzzle flash and tracers).
 *
 * To use a real 3D model later, load it with GLTFLoader in `createWeaponModel`
 * and add an empty object named 'muzzle' at its barrel tip.
 */

const mats = {
  metal: new THREE.MeshStandardMaterial({ color: 0x4a5058, metalness: 0.55, roughness: 0.38 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.15, roughness: 0.6 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x7a4e28, metalness: 0, roughness: 0.7 }),
  accent: new THREE.MeshStandardMaterial({ color: 0x8a6a2a, metalness: 0.5, roughness: 0.5 }),
  lens: new THREE.MeshStandardMaterial({ color: 0x223355, metalness: 0.9, roughness: 0.1, emissive: 0x0a1428 }),
};

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
}

/** Cylinder lying along Z. */
function tube(r: number, len: number, m: THREE.Material, x = 0, y = 0, z = 0, sides = 10): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, sides), m);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  return mesh;
}

function muzzle(z: number, y = 0): THREE.Object3D {
  const o = new THREE.Object3D();
  o.name = 'muzzle';
  o.position.set(0, y, z);
  return o;
}

const builders: Record<WeaponId, () => THREE.Group> = {
  pistol: () => {
    const g = new THREE.Group();
    // The slide (with its sights) is racked back at the end of a reload.
    const slide = new THREE.Group();
    slide.name = 'slide';
    slide.add(
      box(0.034, 0.038, 0.19, mats.metal, 0, 0.03, -0.03), // slide
      box(0.006, 0.01, 0.006, mats.dark, 0, 0.053, -0.115), // front sight
      box(0.016, 0.01, 0.006, mats.dark, 0, 0.053, 0.055), // rear sight
    );
    g.add(
      slide,
      box(0.03, 0.025, 0.15, mats.dark, 0, 0.002, -0.015), // frame
      tube(0.008, 0.03, mats.metal, 0, 0.03, -0.13), // barrel tip
    );
    const grip = box(0.03, 0.1, 0.048, mats.dark, 0, -0.045, 0.04);
    grip.rotation.x = -0.25;
    // Magazine base sticking out of the grip (comes out when reloading).
    const mag = box(0.026, 0.03, 0.042, mats.metal, 0, -0.098, 0.055);
    mag.rotation.x = -0.25;
    mag.name = 'mag';
    g.add(grip, mag, muzzle(-0.15, 0.03));
    return g;
  },
  rifle: () => {
    const g = new THREE.Group();
    g.add(
      box(0.048, 0.07, 0.34, mats.metal, 0, 0.0, 0), // receiver
      box(0.056, 0.056, 0.2, mats.dark, 0, 0.0, -0.26), // handguard
      tube(0.011, 0.2, mats.metal, 0, 0.005, -0.44), // barrel
      tube(0.016, 0.05, mats.dark, 0, 0.005, -0.55), // muzzle brake
      box(0.04, 0.065, 0.22, mats.dark, 0, -0.012, 0.27), // stock
      box(0.012, 0.03, 0.18, mats.dark, 0, 0.05, -0.02), // top rail
      // Rear sight: two posts with a gap to look through.
      box(0.008, 0.024, 0.012, mats.metal, -0.011, 0.077, 0.05),
      box(0.008, 0.024, 0.012, mats.metal, 0.011, 0.077, 0.05),
      box(0.012, 0.012, 0.03, mats.metal, 0, 0.034, -0.32), // front sight base
      box(0.004, 0.038, 0.004, mats.dark, 0, 0.0585, -0.32), // front sight post
    );
    const mag = box(0.03, 0.13, 0.055, mats.dark, 0, -0.09, -0.06);
    mag.rotation.x = 0.25;
    mag.name = 'mag';
    const grip = box(0.03, 0.09, 0.045, mats.dark, 0, -0.07, 0.09);
    grip.rotation.x = -0.3;
    g.add(mag, grip, muzzle(-0.58, 0.005));
    return g;
  },
  shotgun: () => {
    const g = new THREE.Group();
    g.add(
      box(0.05, 0.065, 0.24, mats.metal, 0, 0, 0), // receiver
      tube(0.016, 0.5, mats.metal, 0, 0.012, -0.36), // barrel
      tube(0.013, 0.4, mats.metal, 0, -0.022, -0.31), // magazine tube
      box(0.045, 0.075, 0.28, mats.wood, 0, -0.02, 0.24), // stock
      box(0.008, 0.012, 0.008, mats.accent, 0, 0.033, -0.6), // bead sight
    );
    const pump = box(0.05, 0.05, 0.16, mats.wood, 0, -0.022, -0.3); // slides back after each shot
    pump.name = 'pump';
    const grip = box(0.032, 0.08, 0.05, mats.wood, 0, -0.065, 0.1);
    grip.rotation.x = -0.35;
    g.add(pump, grip, muzzle(-0.62, 0.012));
    return g;
  },
  sniper: () => {
    const g = new THREE.Group();
    g.add(
      box(0.05, 0.06, 0.32, mats.metal, 0, 0, 0), // receiver
      tube(0.012, 0.62, mats.metal, 0, 0.008, -0.47), // barrel
      tube(0.018, 0.06, mats.dark, 0, 0.008, -0.79), // suppressor-ish tip
      box(0.05, 0.07, 0.36, mats.wood, 0, -0.025, 0.3), // stock
      box(0.04, 0.04, 0.12, mats.wood, 0, 0.03, 0.27), // cheek rest
      tube(0.026, 0.28, mats.dark, 0, 0.085, -0.02), // scope body
      tube(0.033, 0.05, mats.dark, 0, 0.085, -0.17), // scope front bell
      tube(0.03, 0.04, mats.dark, 0, 0.085, 0.13), // scope eyepiece
      box(0.015, 0.04, 0.015, mats.metal, 0, 0.05, -0.08), // scope mount
      box(0.015, 0.04, 0.015, mats.metal, 0, 0.05, 0.06), // scope mount
    );
    // Bolt: turns up, slides back and forward again after each shot.
    // Its pivot is on the bore line, so turning it swings the handle up.
    const bolt = new THREE.Group();
    bolt.name = 'bolt';
    bolt.position.set(0, 0.015, 0.08);
    bolt.add(
      box(0.03, 0.022, 0.06, mats.metal, 0, 0.0, 0.0), // bolt body (shows when pulled back)
      box(0.04, 0.012, 0.012, mats.metal, 0.035, 0, 0), // handle
      box(0.02, 0.02, 0.02, mats.dark, 0.06, 0, 0), // knob
    );
    g.add(bolt);
    const lens = tube(0.03, 0.002, mats.lens, 0, 0.085, -0.196);
    const mag = box(0.03, 0.06, 0.07, mats.dark, 0, -0.055, -0.03);
    mag.name = 'mag';
    const grip = box(0.032, 0.08, 0.05, mats.wood, 0, -0.07, 0.12);
    grip.rotation.x = -0.35;
    g.add(lens, mag, grip, muzzle(-0.83, 0.008));
    return g;
  },
};

export function createWeaponModel(id: WeaponId): THREE.Group {
  const g = builders[id]();
  g.name = `weapon:${id}`;
  return g;
}
