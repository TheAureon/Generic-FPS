import * as THREE from 'three';
import { currentQuality } from '../render/quality';
import { makeCharacterMaterial, type CharacterMaterial } from '../render/shaders';

/**
 * A low-poly soldier, about 1.8 m tall, facing -Z. It has a real skeleton
 * (hips, knees, spine, neck, shoulders, elbows) so it can be animated
 * naturally, and the whole body is ONE skinned mesh: drawn in a single draw
 * call, which keeps many bots cheap.
 *
 * To use a real character model later, load a rigged model here and return
 * bones with the same names (or map yours onto these).
 */

export interface CharacterBones {
  hips: THREE.Bone;
  spine: THREE.Bone;
  neck: THREE.Bone;
  lShoulder: THREE.Bone;
  lElbow: THREE.Bone;
  rShoulder: THREE.Bone;
  rElbow: THREE.Bone;
  lThigh: THREE.Bone;
  lKnee: THREE.Bone;
  rThigh: THREE.Bone;
  rKnee: THREE.Bone;
  /** Where the held gun is attached (moves with the upper body). */
  gunMount: THREE.Bone;
}

export interface CharacterModel {
  root: THREE.Group;
  mesh: THREE.SkinnedMesh;
  bones: CharacterBones;
  /** The body's one material (flashes when hit, tinted by lamps). */
  material: CharacterMaterial;
  /** Shortcuts: upper body, head, and where to attach a gun. */
  upper: THREE.Bone;
  head: THREE.Bone;
  hand: THREE.Bone;
}

/** Bone lengths (meters), used by the animator for arm reaching. */
export const SKELETON = {
  hipsHeight: 0.95,
  thigh: 0.44,
  upperArm: 0.29,
  forearm: 0.3,
  shoulderL: new THREE.Vector3(-0.23, 0.44, 0),
  shoulderR: new THREE.Vector3(0.23, 0.44, 0),
};

interface Palette {
  team: number;
  cloth: number;
  vest: number;
  dark: number;
  skin: number;
  helmet: number;
  visor: number;
}

/**
 * @param teamColor accent color (shoulder pads, arm bands, helmet stripe)
 * @param clothColor base uniform color
 */
export function createCharacterModel(teamColor: number, clothColor = 0x34383e): CharacterModel {
  const pal: Palette = {
    team: teamColor,
    cloth: clothColor,
    vest: 0x4d523f,
    dark: 0x1d1f22,
    skin: 0xc69c7a,
    helmet: 0x3b4047,
    visor: 0xff5a2a,
  };

  // ---- Skeleton -------------------------------------------------------------
  const bone = (name: string, x: number, y: number, z: number, parent?: THREE.Bone) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    b.rotation.order = 'YXZ';
    parent?.add(b);
    return b;
  };
  const hips = bone('hips', 0, SKELETON.hipsHeight, 0);
  const lThigh = bone('lThigh', -0.1, -0.03, 0, hips);
  const lKnee = bone('lKnee', 0, -SKELETON.thigh, 0, lThigh);
  const rThigh = bone('rThigh', 0.1, -0.03, 0, hips);
  const rKnee = bone('rKnee', 0, -SKELETON.thigh, 0, rThigh);
  const spine = bone('spine', 0, 0.06, 0, hips);
  const neck = bone('neck', 0, 0.52, 0, spine);
  const lShoulder = bone('lShoulder', SKELETON.shoulderL.x, SKELETON.shoulderL.y, 0, spine);
  const lElbow = bone('lElbow', 0, -SKELETON.upperArm, 0, lShoulder);
  const rShoulder = bone('rShoulder', SKELETON.shoulderR.x, SKELETON.shoulderR.y, 0, spine);
  const rElbow = bone('rElbow', 0, -SKELETON.upperArm, 0, rShoulder);
  const gunMount = bone('gunMount', 0.11, 0.37, -0.3, spine);
  const bones: CharacterBones = { hips, spine, neck, lShoulder, lElbow, rShoulder, rElbow, lThigh, lKnee, rThigh, rKnee, gunMount };
  const boneList = [hips, lThigh, lKnee, rThigh, rKnee, spine, neck, lShoulder, lElbow, rShoulder, rElbow, gunMount];
  hips.updateMatrixWorld(true);

  // ---- Body parts (each rigidly attached to one bone) --------------------------
  const parts: THREE.BufferGeometry[] = [];
  const m4 = new THREE.Matrix4();
  const add = (b: THREE.Bone, g: THREE.BufferGeometry, color: number, opts: { x?: number; y?: number; z?: number; rx?: number; rz?: number; sx?: number; sy?: number; sz?: number; glow?: number } = {}) => {
    let geo = g.index ? g.toNonIndexed() : g;
    geo.deleteAttribute('uv');
    m4.compose(
      new THREE.Vector3(opts.x ?? 0, opts.y ?? 0, opts.z ?? 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(opts.rx ?? 0, 0, opts.rz ?? 0)),
      new THREE.Vector3(opts.sx ?? 1, opts.sy ?? 1, opts.sz ?? 1),
    );
    geo.applyMatrix4(m4);
    geo.applyMatrix4(b.matrixWorld); // into the model's rest pose
    const n = geo.getAttribute('position').count;
    const c = new THREE.Color(color);
    const col = new Float32Array(n * 3);
    const glow = new Float32Array(n);
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    const idx = boneList.indexOf(b);
    for (let i = 0; i < n; i++) {
      col.set([c.r, c.g, c.b], i * 3);
      glow[i] = opts.glow ?? 0;
      si[i * 4] = idx;
      sw[i * 4] = 1;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    if (geo !== g) g.dispose();
    geo = geo.index ? geo.toNonIndexed() : geo;
    parts.push(geo);
  };
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const cyl = (rTop: number, rBottom: number, h: number, seg = 8) => new THREE.CylinderGeometry(rTop, rBottom, h, seg);

  // Hips: pelvis + belt.
  add(hips, cyl(0.17, 0.15, 0.2, 8), pal.cloth, { y: -0.04, sz: 0.68 });
  add(hips, cyl(0.175, 0.175, 0.06, 8), pal.dark, { y: 0.05, sz: 0.7 });
  add(hips, box(0.07, 0.07, 0.04), pal.vest, { x: 0.12, y: 0.03, z: -0.11 }); // belt pouch

  // Legs: thigh, knee pad, shin, boot.
  for (const [thigh, knee, side] of [[lThigh, lKnee, -1], [rThigh, rKnee, 1]] as const) {
    add(thigh, cyl(0.085, 0.066, 0.42, 8), pal.cloth, { y: -0.21 });
    add(thigh, box(0.05, 0.1, 0.06), pal.vest, { x: side * 0.08, y: -0.2 }); // side pocket
    add(knee, box(0.11, 0.12, 0.05), pal.dark, { y: -0.02, z: -0.07 }); // knee pad
    add(knee, cyl(0.066, 0.052, 0.36, 8), pal.cloth, { y: -0.2 });
    add(knee, cyl(0.062, 0.066, 0.09, 8), pal.dark, { y: -0.41 }); // boot top
    add(knee, box(0.12, 0.08, 0.25), pal.dark, { y: -0.445, z: -0.045 }); // boot
  }

  // Torso: tapered body, armored vest front/back, pouches, backpack, shoulder pads.
  add(spine, cyl(0.21, 0.155, 0.52, 8), pal.cloth, { y: 0.26, sz: 0.62 });
  add(spine, box(0.36, 0.32, 0.07), pal.vest, { y: 0.3, z: -0.115 });
  add(spine, box(0.34, 0.3, 0.06), pal.vest, { y: 0.3, z: 0.115 });
  add(spine, box(0.4, 0.05, 0.25), pal.vest, { y: 0.15 }); // vest band
  for (const x of [-0.11, 0, 0.11]) add(spine, box(0.085, 0.1, 0.05), pal.vest, { x, y: 0.2, z: -0.155 });
  add(spine, box(0.05, 0.05, 0.02), pal.team, { x: 0.09, y: 0.4, z: -0.152 }); // patch
  add(spine, box(0.28, 0.32, 0.13), pal.dark, { y: 0.28, z: 0.205 }); // backpack
  add(spine, cyl(0.06, 0.06, 0.28, 8), pal.vest, { y: 0.47, z: 0.2, rz: Math.PI / 2 }); // bedroll
  for (const side of [-1, 1]) add(spine, box(0.13, 0.06, 0.16), pal.team, { x: side * 0.23, y: 0.47, rz: side * -0.25 }); // shoulder pads

  // Head: neck, face, mask, helmet, glowing visor, helmet stripe.
  add(neck, cyl(0.055, 0.06, 0.1, 8), pal.skin, { y: 0.04 });
  add(neck, box(0.18, 0.2, 0.2), pal.skin, { y: 0.17 });
  add(neck, box(0.186, 0.09, 0.13), pal.dark, { y: 0.11, z: -0.045 }); // face mask
  add(neck, new THREE.SphereGeometry(0.135, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), pal.helmet, { y: 0.215, sy: 0.92, sz: 1.08 });
  add(neck, cyl(0.142, 0.142, 0.03, 12), pal.helmet, { y: 0.2, sz: 1.08 }); // helmet rim
  add(neck, box(0.17, 0.045, 0.03), pal.visor, { y: 0.19, z: -0.135, glow: 3.5 }); // visor (glows)
  add(neck, box(0.03, 0.02, 0.26), pal.team, { y: 0.335 }); // helmet stripe

  // Arms: upper arm with band, elbow pad, forearm, glove.
  for (const [shoulder, elbow] of [[lShoulder, lElbow], [rShoulder, rElbow]] as const) {
    add(shoulder, cyl(0.058, 0.05, 0.27, 8), pal.cloth, { y: -0.14 });
    add(shoulder, cyl(0.062, 0.062, 0.045, 8), pal.team, { y: -0.08 }); // arm band
    add(elbow, box(0.075, 0.07, 0.075), pal.dark, { y: -0.01, z: 0.02 }); // elbow pad
    add(elbow, cyl(0.05, 0.042, 0.25, 8), pal.cloth, { y: -0.135 });
    add(elbow, box(0.075, 0.09, 0.09), pal.dark, { y: -0.29 }); // glove
  }

  // ---- One skinned mesh ----------------------------------------------------------
  const geo = mergeParts(parts);
  const material = makeCharacterMaterial(currentQuality().materials);
  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.add(hips);
  mesh.bind(new THREE.Skeleton(boneList));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // The rest-pose bounds don't cover falling over etc., so use a generous sphere.
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 2.2);

  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  root.add(mesh);
  return { root, mesh, bones, material, upper: spine, head: neck, hand: gunMount };
}

function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = ['position', 'normal', 'color', 'aGlow', 'skinIndex', 'skinWeight'];
  const total = parts.reduce((n, p) => n + p.getAttribute('position').count, 0);
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const first = parts[0].getAttribute(name) as THREE.BufferAttribute;
    const size = first.itemSize;
    const arr = name === 'skinIndex' ? new Uint16Array(total * size) : new Float32Array(total * size);
    let offset = 0;
    for (const p of parts) {
      const a = p.getAttribute(name) as THREE.BufferAttribute;
      arr.set(a.array as ArrayLike<number>, offset);
      offset += a.array.length;
      p.dispose();
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}
