/**
 * Turns the downloaded soldier model (scripts/soldier-source/soldier.glb)
 * into the game's soldier (src/assets/models/soldier.glb):
 *
 * - turned to face -Z, scaled to real size (meters), and the legs stretched a
 *   little so the knees and hips sit where the game's skeleton bends;
 * - fitted with the game's skeleton (hips, thighs, knees, spine, neck,
 *   shoulders, elbows): every point of the model follows the bone it's
 *   nearest to, blending between two bones near the joints so they bend
 *   smoothly;
 * - re-posed from the A-pose it comes in (arms out, legs apart) to the
 *   pose the game's animations start from (arms and legs hanging straight);
 * - smooth shading instead of flat facets (sharp edges stay sharp);
 * - split into named parts by what they are ('cloth', 'gear', 'plate',
 *   'helmet', 'crest', 'mask', 'glove', 'boot', 'scarf'), so the game can
 *   color them for each team and draw each kind of surface differently.
 *
 * Run: node scripts/bake-soldier.mjs
 *
 * Positions in SOURCE below are in the source model's own coordinates (as
 * the file comes: about 4.4 units tall, facing +Z, arms out).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// GLTFExporter (binary) needs FileReader, which Node doesn't have.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((r) => {
      this.result = r;
      this.onloadend?.();
    });
  }
};

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, 'soldier-source', 'soldier.glb');
const OUT = path.join(here, '..', 'src', 'assets', 'models', 'soldier.glb');

/** Source → meters. The head and torso keep this scale; the legs are stretched to fit (see LEG_MAP). */
const SCALE = 0.445;
/** Source height → game height for the legs (piecewise straight): ground, knee, hip. */
const LEG_MAP = [[0, 0], [1.15, 0.48], [2.05, 0.92]];

/** Joints in the source (x for the soldier's right side; mirrored for the left). */
const SOURCE = {
  hip: [0.27, 2.05],
  knee: [0.4, 1.15],
  ankle: [0.64, 0.2],
  shoulder: [0.52, 3.12],
  elbow: [0.92, 2.64],
  hand: [1.28, 2.15],
};

/** Degrees to tip the head back (it comes looking down). */
const HEAD_TILT = 18;

/** Where things are in the game skeleton (meters). */
const GAME = {
  hipsHeight: 0.95,
  spineY: 0.06, // above the hips bone
  neckY: 1.59, // world height of the neck joint
};

/** Which material is which, plus a few places that are something else. */
function roleOf(mat, x, y) {
  const head = y > 3.55;
  const hand = Math.abs(x) > 1.13 && y < 2.45;
  switch (mat) {
    case 'Material.002': // the suit (also the face and boots)
      if (hand) return 'glove';
      if (head) return 'mask';
      if (y < 0.5) return 'boot';
      return 'cloth';
    case 'Material.001': // trousers (and part of the hands)
      return hand ? 'glove' : 'cloth';
    case 'Material.000': // gear: vest, belt, pack, pad frames, helmet
      return head ? 'helmet' : 'gear';
    case 'Material.003': // armor plates (and the top of the helmet)
      return head ? 'crest' : 'plate';
    case 'Material.004':
    case 'Material.005':
      return 'gear';
    case 'Material.006':
    case 'Material.007':
      return 'glove';
    case 'Material':
      return 'scarf';
    default:
      return 'gear';
  }
}

const legY = (y) => {
  for (let i = 1; i < LEG_MAP.length; i++) {
    const [s0, g0] = LEG_MAP[i - 1], [s1, g1] = LEG_MAP[i];
    if (y <= s1) return g0 + ((y - s0) / (s1 - s0)) * (g1 - g0);
  }
  return null;
};
/** Source point → game point (A-pose still): turned to face -Z, scaled, legs stretched. */
function toGame(x, y, z) {
  const gy = y < LEG_MAP[2][0] ? legY(y) : LEG_MAP[2][1] + (y - LEG_MAP[2][0]) * SCALE;
  return new THREE.Vector3(-x * SCALE, gy, -z * SCALE);
}
/** A joint on one side: side +1 is the soldier's right (game -x after turning... see below). */
const joint = (name, side) => {
  const [x, y] = SOURCE[name];
  return toGame(x * side, y, 0);
};

// ---- Load the source and gather the triangles by part ------------------------------
const buf = fs.readFileSync(SRC);
const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
gltf.scene.updateMatrixWorld(true);
const byRole = new Map();
gltf.scene.traverse((o) => {
  if (!o.isMesh) return;
  const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
  const p = g.getAttribute('position');
  for (let t = 0; t < p.count; t += 3) {
    // One role per triangle (by its middle), so a triangle never straddles two parts.
    const cx = (p.getX(t) + p.getX(t + 1) + p.getX(t + 2)) / 3;
    const cy = (p.getY(t) + p.getY(t + 1) + p.getY(t + 2)) / 3;
    const role = roleOf(o.material.name, cx, cy);
    if (!byRole.has(role)) byRole.set(role, []);
    const list = byRole.get(role);
    for (let k = 0; k < 3; k++) {
      const v = toGame(p.getX(t + k), p.getY(t + k), p.getZ(t + k));
      list.push(v.x, v.y, v.z);
    }
  }
});

// ---- Skeleton (A-pose, as the model comes) ----------------------------------------
// Turning to face -Z swaps sides: the source's +x side ends up at game -x,
// which is the soldier's LEFT in the game (the game's left bones sit at -x).
const L = 1, R = -1; // source side that becomes the game's left / right
const J = {
  hips: new THREE.Vector3(0, GAME.hipsHeight, 0),
  spine: new THREE.Vector3(0, GAME.hipsHeight + GAME.spineY, 0),
  neck: new THREE.Vector3(0, GAME.neckY, 0),
};
for (const [s, side] of [['l', L], ['r', R]]) {
  J[s + 'Thigh'] = joint('hip', side);
  J[s + 'Knee'] = joint('knee', side);
  J[s + 'Ankle'] = joint('ankle', side);
  J[s + 'Shoulder'] = joint('shoulder', side);
  J[s + 'Elbow'] = joint('elbow', side);
  J[s + 'Hand'] = joint('hand', side);
}

/** Bones, in the order the game uses (src/assets/characterModel.ts). */
const BONES = ['hips', 'lThigh', 'lKnee', 'rThigh', 'rKnee', 'spine', 'neck', 'lShoulder', 'lElbow', 'rShoulder', 'rElbow'];
const PARENT = { lThigh: 'hips', rThigh: 'hips', lKnee: 'lThigh', rKnee: 'rThigh', spine: 'hips', neck: 'spine', lShoulder: 'spine', rShoulder: 'spine', lElbow: 'lShoulder', rElbow: 'rShoulder' };

/**
 * What each bone moves: a line segment (start, end) and a thickness. A point
 * belongs to the bone whose surface it's closest to (distance to the line
 * minus the thickness), so the wide torso keeps the vest and pack, and thin
 * arms only get the arms.
 */
const toe = (s) => J[s + 'Ankle'].clone().add(new THREE.Vector3(0, -0.06, -0.12));
const SEGMENTS = {
  hips: [[new THREE.Vector3(0, 0.82, 0), new THREE.Vector3(0, 1.0, 0)], 0.15],
  spine: [[new THREE.Vector3(0, 1.04, 0), new THREE.Vector3(0, 1.45, 0)], 0.17],
  neck: [[new THREE.Vector3(0, 1.57, 0), new THREE.Vector3(0, 1.82, 0)], 0.1],
};
for (const s of ['l', 'r']) {
  SEGMENTS[s + 'Thigh'] = [[J[s + 'Thigh'], J[s + 'Knee']], 0.08];
  SEGMENTS[s + 'Knee'] = [[J[s + 'Knee'], J[s + 'Ankle'], toe(s)], 0.065];
  SEGMENTS[s + 'Shoulder'] = [[J[s + 'Shoulder'], J[s + 'Elbow']], 0.055];
  SEGMENTS[s + 'Elbow'] = [[J[s + 'Elbow'], J[s + 'Hand'], J[s + 'Hand'].clone().lerp(J[s + 'Elbow'], -0.35)], 0.045];
}
/** Limits so a point can't be grabbed by an obviously wrong bone. */
const HEAD_ROLES = new Set(['helmet', 'crest', 'mask']);
function allowed(bone, p, role) {
  // The head gear only follows the head; the scarf only the body and head.
  if (HEAD_ROLES.has(role)) return bone === 'neck';
  if (role === 'scarf') return bone === 'spine' || bone === 'neck';
  const side = bone[0] === 'l' ? Math.sign(J.lShoulder.x) : Math.sign(J.rShoulder.x);
  if (bone.endsWith('Thigh') || bone.endsWith('Knee')) return p.y < 0.98 && Math.sign(p.x) === side;
  if (bone.endsWith('Shoulder') || bone.endsWith('Elbow')) return Math.sign(p.x) === side && Math.abs(p.x) > 0.16 && p.y > 0.75;
  if (bone === 'neck') return p.y > 1.5;
  return true;
}
const _seg = new THREE.Line3(), _c = new THREE.Vector3();
function distTo(bone, p) {
  const [pts, r] = SEGMENTS[bone];
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    _seg.set(pts[i], pts[i + 1]).closestPointToPoint(p, true, _c);
    best = Math.min(best, _c.distanceTo(p));
  }
  return best - r;
}
/** Two nearest bones and their weights (smoothly blended within a couple of centimeters). */
function weigh(p, role) {
  const d = BONES.map((b) => (allowed(b, p, role) ? distTo(b, p) : Infinity));
  const order = d.map((v, i) => i).sort((a, b) => d[a] - d[b]);
  const [a, b] = order;
  const blend = 0.025;
  const wb = Number.isFinite(d[b]) ? 1 / (1 + Math.exp((d[b] - d[a]) / blend * 2.5)) : 0;
  // Only blend between bones that are joined (thigh-knee, spine-neck...), so arms don't pull the vest.
  const joined = PARENT[BONES[a]] === BONES[b] || PARENT[BONES[b]] === BONES[a];
  const w = joined ? wb : 0;
  return [a, b, 1 - w, w];
}

// ---- Re-pose: arms and legs straight down ----------------------------------------
const DOWN = new THREE.Vector3(0, -1, 0);
/** World rotation for each bone, A-pose → game rest pose. */
const rot = {};
for (const b of BONES) rot[b] = new THREE.Quaternion();
for (const s of ['l', 'r']) {
  for (const [upper, lower, a, mid, c] of [
    [s + 'Shoulder', s + 'Elbow', J[s + 'Shoulder'], J[s + 'Elbow'], J[s + 'Hand']],
    [s + 'Thigh', s + 'Knee', J[s + 'Thigh'], J[s + 'Knee'], J[s + 'Ankle']],
  ]) {
    rot[upper].setFromUnitVectors(mid.clone().sub(a).normalize(), DOWN);
    const lowerDir = c.clone().sub(mid).normalize().applyQuaternion(rot[upper]);
    rot[lower].setFromUnitVectors(lowerDir, DOWN).multiply(rot[upper]);
  }
}
// The head comes tipped forward (looking at the ground): tip it back up.
rot.neck.setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(HEAD_TILT));

/** Where each joint ends up after the re-pose. */
const rest = {};
for (const b of BONES) rest[b] = J[b].clone();
for (const s of ['l', 'r']) {
  rest[s + 'Elbow'] = J[s + 'Shoulder'].clone().add(new THREE.Vector3(0, -J[s + 'Elbow'].distanceTo(J[s + 'Shoulder']), 0));
  rest[s + 'Knee'] = J[s + 'Thigh'].clone().add(new THREE.Vector3(0, -J[s + 'Knee'].distanceTo(J[s + 'Thigh']), 0));
}
/** Moves a point with bone `b`: rotate about the bone's joint, then follow where the joint went. */
function moveWith(b, p) {
  return p.clone().sub(J[b]).applyQuaternion(rot[b]).add(rest[b]);
}

// ---- Build each part ---------------------------------------------------------------
const skeletonBones = {};
for (const b of BONES) {
  const bone = new THREE.Bone();
  bone.name = b;
  skeletonBones[b] = bone;
}
for (const b of BONES) {
  const parent = PARENT[b];
  const bone = skeletonBones[b];
  if (parent) {
    skeletonBones[parent].add(bone);
    bone.position.copy(rest[b]).sub(rest[parent]);
  } else bone.position.copy(rest[b]);
}
const skeleton = new THREE.Skeleton(BONES.map((b) => skeletonBones[b]));
const scene = new THREE.Scene();
const root = new THREE.Group();
root.name = 'soldier';
root.add(skeletonBones.hips);
scene.add(root);

let totalVerts = 0, totalTris = 0;
const counts = {}, bounds = {};
for (const [role, list] of byRole) {
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(list, 3));
  geo = mergeVertices(geo, 1e-5); // shared corners: one weight per corner, no cracks
  const pos = geo.getAttribute('position');
  const si = new Uint16Array(pos.count * 4), sw = new Float32Array(pos.count * 4);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const [a, b, wa, wb] = weigh(p, role);
    si[i * 4] = a;
    si[i * 4 + 1] = b;
    sw[i * 4] = wa;
    sw[i * 4 + 1] = wb;
    // Re-pose: blend where each of the two bones would take the point.
    const pa = moveWith(BONES[a], p), pb = moveWith(BONES[b], p);
    pa.multiplyScalar(wa).addScaledVector(pb, wb);
    pos.setXYZ(i, pa.x, pa.y, pa.z);
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  // Smooth shading, but edges sharper than 40° stay sharp (pouches, plates, boots).
  geo = mergeVertices(toCreasedNormals(geo, THREE.MathUtils.degToRad(40)), 1e-5);
  const mat = new THREE.MeshStandardMaterial({ name: role });
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.name = role;
  mesh.bind(skeleton);
  root.add(mesh);
  counts[role] = geo.getAttribute('position').count;
  geo.computeBoundingBox();
  bounds[role] = [geo.boundingBox.min, geo.boundingBox.max].map((v) => v.toArray().map((n) => +n.toFixed(3)));
  totalVerts += geo.getAttribute('position').count;
  totalTris += geo.index.count / 3;
}

// The skeleton's lengths, for the game's animation (arm reach etc.).
root.userData.skeleton = {
  hipsHeight: GAME.hipsHeight,
  upperArm: +rest.lShoulder.distanceTo(rest.lElbow).toFixed(3),
  forearm: +J.lElbow.distanceTo(J.lHand).toFixed(3),
  thigh: +rest.lThigh.distanceTo(rest.lKnee).toFixed(3),
};

const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
fs.writeFileSync(OUT, Buffer.from(glb));
console.log(`soldier.glb: ${totalVerts} points, ${totalTris} triangles, ${(glb.byteLength / 1024).toFixed(0)} KB`);
console.log('parts', JSON.stringify(counts));
console.log('bounds', JSON.stringify(bounds));
console.log('joints', JSON.stringify(Object.fromEntries(BONES.map((b) => [b, rest[b].toArray().map((v) => +v.toFixed(3))]))));
console.log('skeleton', JSON.stringify(root.userData.skeleton));

// Where the face is (for the goggles the game adds): mask points facing forward, near the eyes.
{
  const mask = root.children.find((c) => c.name === 'mask').geometry;
  const p = mask.getAttribute('position'), n = mask.getAttribute('normal');
  const front = [];
  for (let i = 0; i < p.count; i++) if (n.getZ(i) < -0.7) front.push([p.getX(i), p.getY(i) - rest.neck.y, p.getZ(i)]);
  front.sort((a, b) => a[1] - b[1]);
  console.log('face (x, y above neck, z) facing forward:', front.length, JSON.stringify(front.map((v) => v.map((n) => +n.toFixed(3)))));
}
