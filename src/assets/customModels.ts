import * as THREE from 'three';
import { WEAPON_MODELS, WEAPONS, type WeaponId } from '../config';

/**
 * Loads optional 3D model files before the game starts.
 *
 * Put a .glb file named after a gun (pistol.glb, rifle.glb, shotgun.glb,
 * sniper.glb) in src/assets/models/weapons/ and it replaces the built-in
 * blocky gun everywhere (in your hands and the bots' hands). The files are
 * packed into the game when it's built, so index.html still works on its own.
 * See src/assets/models/README.md for how to prepare a model.
 */

// Every .glb in the folder, as a URL (inlined into the single-file build).
const weaponFiles = import.meta.glob('./models/weapons/*.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

const weaponScenes = new Map<WeaponId, THREE.Object3D>();

/** Load all model files. Missing or broken files just keep the built-in model. */
export async function loadCustomModels(): Promise<void> {
  const entries = Object.entries(weaponFiles);
  if (!entries.length) return;
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  await Promise.all(
    entries.map(async ([path, url]) => {
      const id = path.split('/').pop()!.replace(/\.glb$/i, '') as WeaponId;
      if (!(id in WEAPONS)) {
        console.warn(`Model file "${path}" isn't named after a gun (pistol, rifle, shotgun, sniper); ignoring it.`);
        return;
      }
      try {
        const gltf = await loader.loadAsync(url);
        weaponScenes.set(id, gltf.scene);
      } catch (e) {
        console.warn(`Couldn't load the model for ${id}; using the built-in one.`, e);
      }
    }),
  );
}

/**
 * A fresh copy of a gun's custom model, fitted with the WEAPON_MODELS
 * settings, or null if this gun has no model file.
 */
export function customWeaponModel(id: WeaponId): THREE.Group | null {
  const scene = weaponScenes.get(id);
  if (!scene) return null;
  const fit = WEAPON_MODELS[id];
  const inner = scene.clone(true);
  inner.scale.multiplyScalar(fit.scale);
  inner.position.set(...fit.position);
  inner.rotation.set(...(fit.rotation.map((d) => THREE.MathUtils.degToRad(d)) as [number, number, number]));
  inner.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  const g = new THREE.Group();
  g.add(inner);
  g.userData.custom = true;

  // Every gun needs a 'muzzle' marker (flash and tracers start there): if the
  // model doesn't have one, put it at the front of the model.
  if (!g.getObjectByName('muzzle')) {
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g);
    const muzzle = new THREE.Object3D();
    muzzle.name = 'muzzle';
    muzzle.position.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.min.z);
    g.add(muzzle);
  }
  return g;
}
