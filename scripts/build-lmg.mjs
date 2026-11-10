/**
 * Builds the LMG model (src/assets/models/weapons/lmg.glb) from simple
 * shapes, traced from a side-view reference picture of a low-poly belt-fed
 * machine gun. Moving parts: 'mag' (the ammo box with its belt of rounds)
 * and 'cover' (the feed cover, which flips open during reloads).
 *
 * Run: node scripts/build-lmg.mjs
 *
 * Positions are written in PIXELS of the reference picture (px across, py
 * down; the gun points right in the picture), converted to meters below,
 * so each piece can be checked against the picture. Widths (x, across the
 * gun) are in meters, + is the gun's right side.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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
const OUT = path.join(here, '..', 'src', 'assets', 'models', 'weapons', 'lmg.glb');

// ---- Picture pixels → gun meters ----------------------------------------------------
/** Meters per pixel (the gun is 1.2 m from butt to muzzle in the picture). */
const K = 0.000828;
/**
 * Picture px → z (the muzzle, at px 1895, points down -Z). The gun is placed
 * so it sits low and forward in your hands: its rear sight is right above
 * the grip, so it has to sit further out than the other guns to not fill
 * the screen.
 */
const Z = (px) => -0.78 + (1895 - px) * K - 0.07;
/** Picture py → y (the bore line is at py 220). */
const Y = (py) => (220 - py) * K - 0.035;

// ---- Materials (the name before ':' is the camo role) -------------------------------
const M = {
  body: new THREE.MeshStandardMaterial({ name: 'metal:receiver', color: 0x34465a, metalness: 0.45, roughness: 0.45 }),
  dark: new THREE.MeshStandardMaterial({ name: 'dark:furniture', color: 0x1d2631, metalness: 0.2, roughness: 0.6 }),
  steel: new THREE.MeshStandardMaterial({ name: 'trim:steel', color: 0x8b9fb8, metalness: 0.6, roughness: 0.35 }),
  ammo: new THREE.MeshStandardMaterial({ name: 'trim:ammobox', color: 0x5aa548, metalness: 0.05, roughness: 0.7 }),
  brass: new THREE.MeshStandardMaterial({ name: 'trim:brass', color: 0xe0b040, metalness: 0.8, roughness: 0.3 }),
  hole: new THREE.MeshStandardMaterial({ name: 'trim:hole', color: 0x0c0f13, metalness: 0.1, roughness: 0.8 }),
};

// ---- Shapes -------------------------------------------------------------------------
const pieces = []; // [part, material, geometry]
const put = (part, mat, geo) => {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  pieces.push([part, mat, g]);
};

/** Box between two px and two py, from x0 to x1 (meters). */
function box(px0, px1, py0, py1, x0, x1, mat, part = 'body') {
  const z0 = Z(px1), z1 = Z(px0), y0 = Y(py1), y1 = Y(py0);
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  put(part, mat, g);
}
/** Centered box (x from -w/2 to w/2). */
const cbox = (px0, px1, py0, py1, w, mat, part) => box(px0, px1, py0, py1, -w / 2, w / 2, mat, part);

/** Tube along the gun (hexagonal by default) from px0 to px1 at height py. */
function tube(px0, px1, py, r, mat, sides = 6, part = 'body', x = 0, r2 = r) {
  const len = (px1 - px0) * K;
  const g = new THREE.CylinderGeometry(r2, r, len, sides);
  g.rotateY(Math.PI / sides); // flat side up
  g.rotateX(-Math.PI / 2); // along -Z, radius r at the back
  g.translate(x, Y(py), (Z(px0) + Z(px1)) / 2);
  put(part, mat, g);
}

/** Tube across the gun (knobs, drums, nuts) at px/py, from x0 to x1. */
function across(px, py, r, x0, x1, mat, sides = 6, part = 'body') {
  const g = new THREE.CylinderGeometry(r, r, x1 - x0, sides);
  g.rotateZ(Math.PI / 2);
  g.translate((x0 + x1) / 2, Y(py), Z(px));
  put(part, mat, g);
}

/** A flat shape traced in the picture ([px, py] corners), x0..x1 thick. */
function side(points, x0, x1, mat, part = 'body') {
  const s = new THREE.Shape(points.map(([px, py]) => new THREE.Vector2(-Z(px), Y(py))));
  const g = new THREE.ExtrudeGeometry(s, { depth: x1 - x0, bevelEnabled: false });
  g.rotateY(Math.PI / 2); // shape x → -z, extrusion → +x
  g.translate(x0, 0, 0);
  put(part, mat, g);
}
const cside = (points, w, mat, part) => side(points, -w / 2, w / 2, mat, part);

/** A shape in the cross-section ([x, y] meters), from px0 to px1 along the gun. */
function section(points, px0, px1, mat, part = 'body') {
  const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: (px1 - px0) * K, bevelEnabled: false });
  g.translate(0, 0, Z(px1));
  put(part, mat, g);
}

// ---- The gun ---------------------------------------------------------------------
// Stock: butt pad, two rods with sleeves, and the buffer tube between them.
cside([[445, 182], [470, 175], [478, 180], [478, 332], [470, 338], [448, 336]], 0.046, M.dark);
tube(470, 815, 205, 0.0075, M.steel);
tube(700, 815, 205, 0.0095, M.steel);
tube(470, 815, 297, 0.0075, M.steel);
tube(560, 815, 297, 0.0095, M.steel);
tube(720, 815, 245, 0.02, M.steel, 8);
tube(690, 720, 245, 0.012, M.steel, 8, 'body', 0, 0.02); // tapered cap

// Receiver: rear block, upper and lower halves with a groove between, front block.
cbox(805, 882, 185, 302, 0.068, M.body);
cbox(880, 1340, 184, 221, 0.062, M.body);
cbox(880, 1340, 221, 300, 0.058, M.body);
cbox(882, 1290, 219, 225, 0.063, M.dark);
cbox(1250, 1340, 168, 184, 0.062, M.body);
// Feed cover (flips open on reloads), with the top rail and its slots.
cbox(882, 1250, 162, 184, 0.06, M.body, 'cover');
cbox(965, 1245, 152, 162, 0.026, M.body, 'cover');
for (let px = 975; px < 1240; px += 30) cbox(px, px + 14, 145, 152, 0.026, M.body, 'cover');

// Rear sight: an aperture (ring with a hole in the middle), side guards and two drums.
const AP = 118; // aperture center (py), level with the front sight tip
const apZ0 = 864, apZ1 = 874;
box(apZ0, apZ1, AP - 22, AP - 7, -0.017, 0.017, M.steel); // top bar
box(apZ0, apZ1, AP + 7, AP + 26, -0.017, 0.017, M.steel); // bottom bar
box(apZ0, apZ1, AP - 7, AP + 7, -0.017, -0.0065, M.steel); // left bar
box(apZ0, apZ1, AP - 7, AP + 7, 0.0065, 0.017, M.steel); // right bar
for (const x of [-0.022, 0.018]) side([[850, 163], [860, 100], [893, 100], [945, 152], [945, 163]], x, x + 0.004, M.steel);
cbox(848, 948, 152, 163, 0.04, M.steel);
across(872, 145, 0.016, -0.028, 0.028, M.steel);
across(926, 145, 0.016, -0.028, 0.028, M.steel);

// Right side: ejection window (a round showing) and the charging handle.
box(1133, 1237, 163, 207, 0.031, 0.0335, M.steel);
box(1143, 1227, 171, 199, 0.0335, 0.0345, M.hole);
box(1150, 1222, 180, 190, 0.0335, 0.036, M.brass);
box(1128, 1242, 210, 238, 0.0295, 0.036, M.steel);
across(1205, 228, 0.01, 0.036, 0.068, M.steel);
across(1275, 180, 0.008, 0.03, 0.04, M.steel);
// Left side: the feed tray window the belt goes into.
box(1150, 1235, 170, 222, -0.0335, -0.031, M.steel);
box(1158, 1227, 176, 218, -0.0345, -0.0335, M.hole);

// Pistol grip, trigger guard and trigger.
cside([[1032, 298], [960, 298], [952, 330], [886, 420], [872, 442], [952, 447], [988, 372], [1032, 340]], 0.032, M.dark);
cbox(1012, 1102, 358, 368, 0.016, M.steel);
cbox(1092, 1102, 298, 368, 0.016, M.steel);
cbox(1012, 1024, 325, 368, 0.016, M.steel);
cside([[1040, 300], [1052, 300], [1062, 335], [1052, 358], [1044, 352], [1050, 332]], 0.008, M.steel);

// Handguard (wide, with a step at the back) and the bipod pivot nut.
cside([[1280, 206], [1340, 193], [1608, 193], [1616, 202], [1616, 330], [1600, 340], [1292, 340], [1280, 330]], 0.074, M.dark);
across(1540, 298, 0.012, 0.037, 0.047, M.steel);
across(1540, 298, 0.012, -0.047, -0.037, M.steel);

// Front: barrel, flash hider, gas tube and nut, gas block, brace, front sight.
tube(1600, 1850, 222, 0.0095, M.dark);
tube(1845, 1895, 222, 0.013, M.steel);
tube(1600, 1760, 252, 0.011, M.dark);
tube(1740, 1768, 252, 0.015, M.steel);
cbox(1690, 1762, 205, 262, 0.032, M.steel);
cside([[1600, 193], [1705, 205], [1705, 222], [1612, 214]], 0.024, M.steel);
cbox(1710, 1750, 168, 206, 0.028, M.steel); // front sight base
cbox(1725, 1735, AP, 170, 0.006, M.steel); // post (its tip is the aiming point)
for (const x of [-0.016, 0.01]) box(1714, 1746, AP - 8, 172, x, x + 0.006, M.steel); // protective ears

// Ammo box (comes off on reloads): chamfered on the top left, with a latch,
// and the belt of rounds running up into the left side.
const boxX0 = -0.098, boxX1 = 0.034, top = Y(290), bot = Y(600);
section([[boxX0, bot], [boxX1, bot], [boxX1, top], [boxX0 + 0.034, top], [boxX0, top - 0.034]], 1108, 1236, M.ammo, 'mag');
box(1148, 1200, 281, 291, -0.012, 0.022, M.steel, 'mag');
for (let i = 0; i < 6; i++) {
  const py = 286 - i * 15;
  tube(1150, 1205, py, 0.0055, M.brass, 6, 'mag', -0.038);
  tube(1205, 1222, py, 0.0055, M.brass, 6, 'mag', -0.038, 0.0012); // pointed tip
}

// ---- Assemble ------------------------------------------------------------------
/** Box-projected UVs (so camo patterns wrap the gun evenly). */
function boxUVs(geo) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
    const x = pos.getX(i) / 0.3, y = pos.getY(i) / 0.3, z = pos.getZ(i) / 0.3;
    const [a, b] = ax >= ay && ax >= az ? [z, y] : ay >= az ? [x, z] : [x, y];
    uv[i * 2] = a;
    uv[i * 2 + 1] = b;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

const PIVOTS = {
  mag: new THREE.Vector3((boxX0 + boxX1) / 2, top, Z(1172)),
  // The cover hinges at its front edge.
  cover: new THREE.Vector3(0, Y(162), Z(1250)),
};

const root = new THREE.Group();
root.name = 'gun_lmg';
const parts = new Map();
for (const [part, mat, geo] of pieces) {
  if (!parts.has(part)) parts.set(part, new Map());
  const byMat = parts.get(part);
  if (!byMat.has(mat)) byMat.set(mat, []);
  byMat.get(mat).push(geo);
}
for (const [part, byMat] of parts) {
  let holder = root;
  const pivot = PIVOTS[part];
  if (pivot) {
    holder = new THREE.Group();
    holder.name = part;
    holder.position.copy(pivot);
    root.add(holder);
  }
  for (const [mat, geos] of byMat) {
    const geo = mergeGeometries(geos.map((g) => {
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      return g;
    }));
    boxUVs(geo); // in gun coordinates, so moving parts' camo lines up at rest
    if (pivot) geo.translate(-pivot.x, -pivot.y, -pivot.z);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `${part}_${mat.name.replace(/[^a-z0-9]+/gi, '_')}`;
    holder.add(mesh);
  }
}

// Markers (see src/assets/models/README.md).
const mark = (name, x, py, px) => {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(x, Y(py), Z(px));
  root.add(o);
};
mark('sight', 0, AP, (apZ0 + apZ1) / 2);
mark('muzzle', 0, 222, 1895);
mark('eject', 0.036, 185, 1186);
mark('grip_right', 0, 330, 992);
mark('grip_left', 0, 352, 1470);
mark('grip_reload', -0.03, 600, 1172);
mark('grip_cover', 0, 150, 1100); // 0.124 m behind the hinge (see SPOT_OFFSETS.coverUp)

const scene = new THREE.Scene();
scene.add(root);
const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
fs.writeFileSync(OUT, Buffer.from(glb));
const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
console.log(`lmg: ${pieces.length} pieces, ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} m, ${glb.byteLength} bytes`);
