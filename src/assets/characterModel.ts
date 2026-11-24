import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { currentQuality } from '../render/quality';
import { makeCharacterMaterial, type CharacterMaterial } from '../render/shaders';

/**
 * Kinds of surface on the body; the shader draws each one differently
 * (see `makeCharacterMaterial`): camo fabric, woven nylon gear, skin, hard
 * plastic, rubber, metal.
 */
export const SURF = { plain: 0, cloth: 1, nylon: 2, skin: 3, hard: 4, rubber: 5, metal: 6 } as const;

/**
 * A soldier, about 1.8 m tall, facing -Z. It has a real skeleton
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
  boot: number;
  metal: number;
}

/**
 * @param teamColor accent color (shoulder pads, arm bands, helmet band, chest patch)
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
    boot: 0x2b2621,
    metal: 0x6d7175,
  };
  // Smoother, rounder parts on Medium/High graphics; fewer sides on Low.
  const seg = currentQuality().materials === 'lambert' ? 8 : 10;

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
  const add = (b: THREE.Bone, g: THREE.BufferGeometry, color: number, opts: { x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number; sx?: number; sy?: number; sz?: number; glow?: number; surf?: number } = {}) => {
    // Kept indexed (corners shared between triangles): far fewer points to move each frame.
    const geo = g;
    geo.deleteAttribute('uv');
    m4.compose(
      new THREE.Vector3(opts.x ?? 0, opts.y ?? 0, opts.z ?? 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(opts.rx ?? 0, opts.ry ?? 0, opts.rz ?? 0)),
      new THREE.Vector3(opts.sx ?? 1, opts.sy ?? 1, opts.sz ?? 1),
    );
    geo.applyMatrix4(m4);
    geo.applyMatrix4(b.matrixWorld); // into the model's rest pose
    const n = geo.getAttribute('position').count;
    const c = new THREE.Color(color);
    const col = new Float32Array(n * 3);
    const glow = new Float32Array(n);
    const surf = new Float32Array(n).fill(opts.surf ?? SURF.plain);
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
    geo.setAttribute('aSurf', new THREE.BufferAttribute(surf, 1));
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    if (!geo.index) geo.setIndex([...Array(n).keys()]);
    parts.push(geo);
  };
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const cyl = (rTop: number, rBottom: number, h: number, n = seg) => new THREE.CylinderGeometry(rTop, rBottom, h, n);
  /** A rounded rod (limbs): `len` is the straight part. */
  const rod = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 2, seg);
  /** A box with rounded edges (pouches, pads, plates). */
  const rbox = (w: number, h: number, d: number, r = 0.012) =>
    // (Tiny parts and Low graphics: plain boxes, the rounding wouldn't show.)
    Math.min(w, h, d) < 0.03 || seg <= 8 ? box(w, h, d) : new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2.2, h / 2.2, d / 2.2));
  const ball = (r: number) => new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1) + 2);
  const { cloth, nylon, skin, hard, rubber, metal } = SURF;
  const darker = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k).getHex();

  // Hips: pelvis, belt with a buckle, a pouch at the front and a dump pouch at the back.
  add(hips, cyl(0.168, 0.15, 0.2), pal.cloth, { y: -0.04, sz: 0.7, surf: cloth });
  add(hips, cyl(0.176, 0.174, 0.055), darker(pal.vest, 0.6), { y: 0.05, sz: 0.72, surf: nylon });
  add(hips, rbox(0.06, 0.042, 0.016, 0.006), pal.metal, { y: 0.05, z: -0.124, surf: metal });
  add(hips, rbox(0.075, 0.075, 0.045), pal.vest, { x: 0.12, y: 0.03, z: -0.105, ry: -0.5, surf: nylon });
  add(hips, rbox(0.13, 0.1, 0.06, 0.02), pal.vest, { x: -0.07, y: 0.0, z: 0.115, surf: nylon });

  // Legs: rounded thigh with a cargo pocket, knee pad, shin, laced boot with a sole.
  for (const [thigh, knee, side] of [[lThigh, lKnee, -1], [rThigh, rKnee, 1]] as const) {
    add(thigh, rod(0.077, 0.3), pal.cloth, { y: -0.2, sz: 0.95, surf: cloth });
    add(thigh, rbox(0.045, 0.12, 0.1, 0.015), darker(pal.cloth, 0.92), { x: side * 0.074, y: -0.24, surf: cloth });
    add(knee, rbox(0.1, 0.12, 0.05, 0.02), pal.dark, { y: -0.02, z: -0.066, surf: hard });
    add(knee, rod(0.06, 0.26), pal.cloth, { y: -0.19, surf: cloth });
    add(knee, cyl(0.064, 0.068, 0.12), pal.boot, { y: -0.39, surf: rubber });
    add(knee, rbox(0.11, 0.07, 0.25, 0.03), pal.boot, { y: -0.44, z: -0.045, surf: rubber });
    add(knee, rbox(0.116, 0.024, 0.262, 0.008), 0x151413, { y: -0.47, z: -0.045, surf: rubber });
    for (let k = 0; k < 3; k++) add(knee, box(0.05, 0.007, 0.012), 0x403a33, { y: -0.415 + k * 0.025, z: -0.07 - k * 0.006, rx: -0.3, surf: nylon }); // laces
  }
  // A pistol holster on the right thigh.
  add(rThigh, rbox(0.05, 0.16, 0.075, 0.015), pal.dark, { x: 0.105, y: -0.13, surf: nylon });
  add(rThigh, rbox(0.03, 0.06, 0.05, 0.008), 0x2c2e31, { x: 0.105, y: -0.03, surf: hard });

  // Torso: rounded chest and shoulders, collar, plate carrier with straps and pouches, pack, radio.
  add(spine, cyl(0.2, 0.155, 0.46), pal.cloth, { y: 0.24, sz: 0.62, surf: cloth });
  add(spine, ball(0.2), pal.cloth, { y: 0.45, sx: 1.08, sy: 0.42, sz: 0.62, surf: cloth });
  add(spine, cyl(0.07, 0.085, 0.07), darker(pal.cloth, 0.9), { y: 0.52, surf: cloth });
  add(spine, rbox(0.34, 0.33, 0.07, 0.025), pal.vest, { y: 0.31, z: -0.112, surf: nylon });
  add(spine, rbox(0.33, 0.31, 0.06, 0.025), pal.vest, { y: 0.31, z: 0.112, surf: nylon });
  add(spine, cyl(0.205, 0.195, 0.12), darker(pal.vest, 0.92), { y: 0.17, sz: 0.68, surf: nylon }); // cummerbund
  for (const side of [-1, 1]) add(spine, rbox(0.07, 0.035, 0.27, 0.012), pal.vest, { x: side * 0.12, y: 0.475, surf: nylon }); // shoulder straps
  for (const x of [-0.105, 0, 0.105]) {
    add(spine, rbox(0.085, 0.11, 0.05, 0.014), pal.vest, { x, y: 0.205, z: -0.158, surf: nylon }); // magazine pouch
    add(spine, rbox(0.09, 0.035, 0.056, 0.01), darker(pal.vest, 0.85), { x, y: 0.255, z: -0.16, surf: nylon }); // its flap
  }
  add(spine, rbox(0.15, 0.07, 0.03, 0.01), darker(pal.vest, 0.9), { y: 0.375, z: -0.155, surf: nylon }); // admin pouch
  add(spine, rbox(0.055, 0.04, 0.012, 0.004), pal.team, { x: 0.035, y: 0.38, z: -0.172, surf: hard, glow: 0.15 }); // team patch
  for (const side of [-1, 1]) add(spine, ball(0.032), darker(pal.vest, 0.75), { x: side * 0.19, y: 0.2, z: -0.05, sy: 1.25, surf: hard }); // grenades
  add(spine, rbox(0.27, 0.31, 0.11, 0.035), pal.dark, { y: 0.29, z: 0.2, surf: nylon }); // hydration pack
  for (const y of [0.2, 0.3, 0.4]) add(spine, box(0.272, 0.012, 0.112), darker(pal.dark, 1.5), { y, z: 0.2, surf: nylon }); // webbing
  add(spine, rbox(0.07, 0.13, 0.055, 0.015), pal.dark, { x: -0.13, y: 0.42, z: 0.19, surf: nylon }); // radio
  add(spine, cyl(0.006, 0.008, 0.26, 5), 0x222222, { x: -0.14, y: 0.6, z: 0.2, rz: 0.1, surf: rubber }); // antenna
  for (const side of [-1, 1]) add(spine, rbox(0.13, 0.05, 0.16, 0.02), pal.team, { x: side * 0.235, y: 0.465, rz: side * -0.28, surf: hard }); // shoulder pads

  // Head: neck, face, balaclava over the lower face, goggles (the glowing lenses),
  // helmet with a team band, ear defenders and a night-vision mount.
  add(neck, cyl(0.056, 0.062, 0.11), pal.dark, { y: 0.04, surf: cloth }); // neck gaiter (part of the mask)
  add(neck, ball(0.1), pal.skin, { y: 0.17, sx: 0.9, sy: 1.08, surf: skin });
  add(neck, ball(0.101), pal.dark, { y: 0.118, z: 0.004, sx: 0.93, sy: 0.62, sz: 1.03, surf: cloth }); // balaclava
  add(neck, rbox(0.18, 0.06, 0.05, 0.016), pal.dark, { y: 0.195, z: -0.085, surf: hard }); // goggle frame
  add(neck, rbox(0.16, 0.042, 0.02, 0.008), pal.visor, { y: 0.195, z: -0.11, glow: 3.5 }); // lenses (glow)
  add(neck, new THREE.SphereGeometry(0.132, seg + 4, seg >> 1, 0, Math.PI * 2, 0, Math.PI * 0.55), pal.helmet, { y: 0.215, sy: 0.92, sz: 1.08, surf: hard });
  add(neck, cyl(0.138, 0.14, 0.025, seg + 4), pal.helmet, { y: 0.2, sz: 1.08, surf: hard }); // rim
  add(neck, cyl(0.1335, 0.1335, 0.03, seg + 4), pal.team, { y: 0.245, sz: 1.08, surf: nylon }); // team band
  for (const side of [-1, 1]) {
    add(neck, cyl(0.045, 0.045, 0.04), 0x26282b, { x: side * 0.112, y: 0.16, rz: Math.PI / 2, surf: hard }); // ear defender
    add(neck, box(0.012, 0.09, 0.02), 0x26282b, { x: side * 0.124, y: 0.215, surf: hard }); // its headband
  }
  add(neck, rbox(0.05, 0.04, 0.03, 0.006), 0x2a2c2e, { y: 0.27, z: -0.14, surf: metal }); // NVG mount

  // Arms: rounded shoulder, sleeve with a team band, elbow pad, forearm, cuff, glove.
  for (const [shoulder, elbow] of [[lShoulder, lElbow], [rShoulder, rElbow]] as const) {
    add(shoulder, ball(0.066), pal.cloth, { y: -0.02, surf: cloth });
    add(shoulder, rod(0.054, 0.2), pal.cloth, { y: -0.14, surf: cloth });
    add(shoulder, cyl(0.058, 0.058, 0.04), pal.team, { y: -0.08, surf: nylon }); // arm band
    add(elbow, rbox(0.075, 0.075, 0.075, 0.022), pal.dark, { y: -0.01, z: 0.02, surf: hard }); // elbow pad
    add(elbow, rod(0.047, 0.18), pal.cloth, { y: -0.13, surf: cloth });
    add(elbow, cyl(0.05, 0.05, 0.03), darker(pal.cloth, 0.85), { y: -0.22, surf: cloth }); // cuff
    add(elbow, rbox(0.075, 0.095, 0.09, 0.025), pal.dark, { y: -0.29, surf: rubber }); // glove
    add(elbow, rbox(0.06, 0.03, 0.02, 0.008), 0x2c2e31, { y: -0.275, z: -0.045, surf: hard }); // knuckle guard
  }

  // ---- One skinned mesh ----------------------------------------------------------
  const geo = mergeParts(parts);
  const material = makeCharacterMaterial(currentQuality().materials, true);
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
  const names = ['position', 'normal', 'color', 'aGlow', 'aSurf', 'skinIndex', 'skinWeight'];
  const total = parts.reduce((n, p) => n + p.getAttribute('position').count, 0);
  const out = new THREE.BufferGeometry();
  const index: number[] = [];
  let base = 0;
  for (const p of parts) {
    for (const i of p.index!.array) index.push(i + base);
    base += p.getAttribute('position').count;
  }
  out.setIndex(index);
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
