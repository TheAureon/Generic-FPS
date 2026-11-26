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

// The soldier model (made by scripts/bake-soldier.mjs), if there is one.
const soldierFiles = import.meta.glob('./models/soldier.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

/** A rigged soldier model: its parts (by what they are) and where its joints are. */
export interface SoldierModel {
  /** One geometry per kind of part ('cloth', 'gear', 'helmet'...), skinned to the game's bones by name. */
  parts: { role: string; geo: THREE.BufferGeometry }[];
  /** Each bone's position in the model (meters, standing pose). */
  joints: Record<string, THREE.Vector3>;
  /** Arm and leg lengths, for the animation. */
  lengths: { hipsHeight: number; upperArm: number; forearm: number; thigh: number };
}
let soldier: SoldierModel | null = null;

/** The soldier model, or null to use the one built from simple shapes. */
export function customSoldier(): SoldierModel | null {
  return soldier;
}

/** The game's bone order (the same as in characterModel.ts). */
const BONE_ORDER = ['hips', 'lThigh', 'lKnee', 'rThigh', 'rKnee', 'spine', 'neck', 'lShoulder', 'lElbow', 'rShoulder', 'rElbow', 'gunMount'];

function readSoldier(scene: THREE.Object3D): SoldierModel {
  scene.updateMatrixWorld(true);
  const joints: Record<string, THREE.Vector3> = {};
  scene.traverse((o) => {
    if ((o as THREE.Bone).isBone) joints[o.name] = o.getWorldPosition(new THREE.Vector3());
  });
  const parts: SoldierModel['parts'] = [];
  let lengths: SoldierModel['lengths'] | null = null;
  scene.traverse((o) => {
    if (o.userData.skeleton) lengths = o.userData.skeleton;
    if (!(o as THREE.SkinnedMesh).isSkinnedMesh) return;
    const mesh = o as THREE.SkinnedMesh;
    const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    // The file's bone numbers → the game's.
    const map = mesh.skeleton.bones.map((b) => BONE_ORDER.indexOf(b.name));
    if (map.some((i) => i < 0)) throw new Error('The soldier model has a bone the game doesn\'t know.');
    const si = geo.getAttribute('skinIndex');
    const out = new Uint16Array(si.count * 4);
    for (let i = 0; i < si.count; i++) for (let k = 0; k < 4; k++) out[i * 4 + k] = map[si.getComponent(i, k)];
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(out, 4));
    parts.push({ role: (mesh.material as THREE.Material).name || mesh.name, geo });
  });
  if (!lengths || !parts.length || BONE_ORDER.slice(0, -1).some((b) => !joints[b])) throw new Error('The soldier model is missing its skeleton.');
  return { parts, joints, lengths };
}

/** Load all model files. Missing or broken files just keep the built-in model. */
export async function loadCustomModels(): Promise<void> {
  const entries = Object.entries(weaponFiles);
  const soldierUrl = Object.values(soldierFiles)[0];
  if (!entries.length && !soldierUrl) return;
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  if (soldierUrl) {
    try {
      soldier = readSoldier((await loader.loadAsync(soldierUrl)).scene);
    } catch (e) {
      console.warn("Couldn't load the soldier model; using the built-in one.", e);
    }
  }
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
