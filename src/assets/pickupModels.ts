import * as THREE from 'three';
import type { PickupType } from '../map/MapTypes';
import { makeCharacterMaterial } from '../render/shaders';
import { extrude, Parts, roundedRect } from './parts';

/**
 * Pickup models, built from simple shapes but merged into one mesh each:
 * a hard-shell med kit, a military ammo can with cartridges on top, and a
 * plate-carrier bulletproof vest. Each model is built once and shared.
 *
 * To use real models later, return a loaded model's scene from
 * `createPickupModel` instead (keep the 'item' and 'ring' names).
 */

const COLORS: Record<PickupType, number> = {
  health: 0xff4a3d,
  armor: 0x4aa3ff,
  ammo: 0xe0b33a,
};

export function pickupColor(type: PickupType): number {
  return COLORS[type];
}

/** Base glow so pickups stay readable in dark corners. */
const G = 0.14;

function medkit(): THREE.BufferGeometry {
  const p = new Parts();
  const white = 0xe9ebee, grey = 0x8d949c, dark = 0x3a3f45, red = 0xe02a22;
  p.add(extrude(roundedRect(0.5, 0.34, 0.035), 0.2, 0.012), white, { glow: G });
  p.add(extrude(roundedRect(0.512, 0.352, 0.04), 0.024, 0.004), grey, { glow: G }); // seam rim
  // Red cross on both sides (raised, glowing a little).
  for (const z of [0.102, -0.102]) {
    p.box(0.2, 0.062, 0.014, red, { z, glow: 0.7 });
    p.box(0.062, 0.2, 0.014, red, { z, glow: 0.7 });
  }
  // Rubber corner bumpers.
  for (const x of [-0.235, 0.235]) for (const y of [-0.155, 0.155]) p.box(0.05, 0.05, 0.214, dark, { x, y, glow: G * 0.5 });
  // Carry handle and latches on top.
  for (const x of [-0.085, 0.085]) p.cyl(0.012, 0.012, 0.045, dark, { x, y: 0.19 }, 8);
  p.box(0.21, 0.026, 0.038, dark, { y: 0.218 });
  for (const x of [-0.165, 0.165]) p.box(0.045, 0.03, 0.06, grey, { x, y: 0.172 });
  // Hinges along the back edge.
  for (const x of [-0.12, 0.12]) p.cyl(0.011, 0.011, 0.08, grey, { x, y: -0.17, rz: Math.PI / 2 }, 8);
  return p.build();
}

function ammoCan(): THREE.BufferGeometry {
  const p = new Parts();
  const olive = 0x4b5531, oliveDark = 0x3c4427, metal = 0x6b6f62, yellow = 0xd9b030, brass = 0xd9a63a, copper = 0xb86b3a;
  p.box(0.44, 0.24, 0.2, olive, { y: -0.01, glow: G });
  p.box(0.452, 0.045, 0.212, oliveDark, { y: 0.13, glow: G }); // lid
  p.box(0.452, 0.012, 0.212, oliveDark, { y: -0.13, glow: G }); // bottom rim
  // Stiffening ribs on the sides.
  for (const x of [-0.15, 0, 0.15]) for (const z of [-0.102, 0.102]) p.box(0.025, 0.2, 0.008, oliveDark, { x, y: -0.01, z });
  // Yellow stencil band and markings.
  for (const z of [-0.104, 0.104]) {
    p.box(0.3, 0.028, 0.004, yellow, { y: 0.05, z, glow: 0.45 });
    // Stenciled lettering (suggested by short bars).
    for (const [x, w] of [[-0.1, 0.07], [-0.02, 0.05], [0.05, 0.06], [0.11, 0.03]]) p.box(w, 0.018, 0.004, yellow, { x, y: -0.02, z, glow: 0.45 });
  }
  // Folding handle and the lid latch.
  p.box(0.17, 0.016, 0.032, metal, { y: 0.162 });
  for (const x of [-0.08, 0.08]) p.box(0.02, 0.02, 0.04, metal, { x, y: 0.158 });
  p.box(0.022, 0.13, 0.06, metal, { x: 0.232, y: 0.06 });
  // A row of cartridges lying on the lid.
  for (let i = 0; i < 5; i++) {
    const x = -0.12 + i * 0.06;
    p.cyl(0.014, 0.014, 0.075, brass, { x, y: 0.168, z: 0.01, rx: Math.PI / 2, glow: 0.35 }, 10);
    p.cyl(0.004, 0.013, 0.03, copper, { x, y: 0.168, z: -0.042, rx: -Math.PI / 2, glow: 0.3 }, 10);
  }
  return p.build();
}

function vest(): THREE.BufferGeometry {
  const p = new Parts();
  const fabric = 0x2f4b6e, webbing = 0x22374f, pouch = 0x34557d, flap = 0x3b5c85, patch = 0x7fc0ff, buckle = 0x1d2229;
  // Front and back plate panels, cut away at the neck.
  const plate = new THREE.Shape();
  plate.moveTo(-0.21, -0.25);
  plate.lineTo(0.21, -0.25);
  plate.lineTo(0.21, 0.12);
  plate.lineTo(0.12, 0.25);
  plate.lineTo(-0.12, 0.25);
  plate.lineTo(-0.21, 0.12);
  plate.closePath();
  for (const z of [0.09, -0.09]) p.add(extrude(plate, 0.055, 0.015), fabric, { z, glow: G });
  // Shoulder straps over the top, padded side panels (cummerbund) at the waist.
  for (const x of [-0.14, 0.14]) p.box(0.08, 0.035, 0.24, fabric, { x, y: 0.235, glow: G });
  for (const x of [-0.222, 0.222]) p.box(0.035, 0.2, 0.2, webbing, { x, y: -0.12, glow: G });
  // Webbing rows (MOLLE) on the front.
  for (const y of [0.02, -0.04, -0.1]) p.box(0.38, 0.016, 0.01, webbing, { y, z: 0.122 });
  // Three magazine pouches with flaps.
  for (const x of [-0.115, 0, 0.115]) {
    p.box(0.095, 0.13, 0.05, pouch, { x, y: -0.145, z: 0.14, glow: G });
    p.box(0.1, 0.035, 0.056, flap, { x, y: -0.075, z: 0.142, glow: G });
    p.box(0.03, 0.025, 0.008, buckle, { x, y: -0.088, z: 0.172 });
  }
  // Glowing ID patch (keeps armor's blue color easy to spot), drag handle at the back.
  p.box(0.15, 0.07, 0.012, patch, { y: 0.12, z: 0.124, glow: 0.8 });
  p.box(0.11, 0.022, 0.035, buckle, { y: 0.215, z: -0.13 });
  // Side release buckles.
  for (const x of [-0.24, 0.24]) p.box(0.012, 0.05, 0.04, buckle, { x, y: -0.1 });
  return p.build();
}

const BUILDERS: Record<PickupType, () => THREE.BufferGeometry> = { health: medkit, armor: vest, ammo: ammoCan };
const cache = new Map<PickupType, { geo: THREE.BufferGeometry; mat: THREE.Material }>();

export function createPickupModel(type: PickupType): THREE.Group {
  let shared = cache.get(type);
  if (!shared) {
    const geo = BUILDERS[type]();
    geo.userData.cached = true; // shared between matches: don't dispose
    cache.set(type, (shared = { geo, mat: makeCharacterMaterial() }));
  }
  const mesh = new THREE.Mesh(shared.geo, shared.mat);
  mesh.castShadow = false; // small and floating: not worth a shadow

  // Glowing ring on the floor so pickups are easy to spot.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.55, 32),
    new THREE.MeshBasicMaterial({ color: COLORS[type], transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.name = 'ring';
  const g = new THREE.Group();
  g.name = 'item';
  g.add(mesh);
  const root = new THREE.Group();
  root.add(g, ring);
  return root;
}
