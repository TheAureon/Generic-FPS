import * as THREE from 'three';
import type { PickupType } from '../map/MapTypes';

/**
 * Low-poly pickup models made from boxes and cylinders.
 * To use real models later, load them here and return them instead.
 */

const COLORS: Record<PickupType, number> = {
  health: 0xff4a3d,
  armor: 0x4aa3ff,
  ammo: 0xe0b33a,
};

export function pickupColor(type: PickupType): number {
  return COLORS[type];
}

function mat(color: number, emissive = 0.15): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.5,
    emissive: new THREE.Color(color).multiplyScalar(emissive),
  });
}

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = false; // small and floating: not worth a shadow
  return mesh;
}

export function createPickupModel(type: PickupType): THREE.Group {
  const g = new THREE.Group();
  if (type === 'health') {
    // White case with a red cross on both sides.
    const white = mat(0xf2f2f2, 0.25), red = mat(0xff3b30, 0.4);
    g.add(box(0.5, 0.36, 0.22, white));
    for (const z of [0.115, -0.115]) {
      g.add(box(0.28, 0.08, 0.02, red, 0, 0, z), box(0.08, 0.28, 0.02, red, 0, 0, z));
    }
  } else if (type === 'armor') {
    // A blue vest.
    const blue = mat(0x2f7fd6, 0.3), light = mat(0x9fd0ff, 0.3);
    g.add(box(0.46, 0.5, 0.16, blue), box(0.12, 0.14, 0.17, blue, -0.13, 0.31, 0), box(0.12, 0.14, 0.17, blue, 0.13, 0.31, 0));
    g.add(box(0.47, 0.06, 0.17, light, 0, 0.06, 0), box(0.47, 0.06, 0.17, light, 0, -0.12, 0));
  } else {
    // An ammo crate with bullets on top.
    const olive = mat(0x55603a, 0.1), brass = mat(0xd9a63a, 0.35);
    g.add(box(0.5, 0.3, 0.3, olive), box(0.52, 0.05, 0.32, mat(0x3a4228, 0.1), 0, 0.03, 0));
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 8), brass);
      b.position.set(-0.12 + i * 0.08, 0.23, 0);
      g.add(b);
    }
  }

  // Glowing ring on the floor so pickups are easy to spot.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.55, 32),
    new THREE.MeshBasicMaterial({ color: COLORS[type], transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.name = 'ring';
  const root = new THREE.Group();
  g.name = 'item';
  root.add(g, ring);
  return root;
}
