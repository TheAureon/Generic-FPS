/**
 * Turns the downloaded gun models in scripts/weapon-sources/ into game-ready
 * models in src/assets/models/weapons/:
 *
 * - turned so the barrel points down -Z, scaled to real size (meters), and
 *   placed so the right hand lands where the game expects it;
 * - the moving parts cut out into their own pieces ('mag', 'slide', 'pump',
 *   'bolt'), so reloads and the pump/bolt/slide actions animate;
 * - marker points added (muzzle, sight, ejection port, hand grips), so
 *   aiming lines up the sights and the hands hold the gun in the right places;
 * - materials renamed to the camo roles ('metal', 'dark', 'wood'), so camos
 *   paint them, with UVs made for the camo patterns.
 *
 * Run: node scripts/bake-weapons.mjs
 *
 * All positions in GUNS below are in the SOURCE model's own coordinates
 * (as the file comes, before turning/scaling).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
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
  readAsDataURL(blob) {
    blob.arrayBuffer().then((r) => {
      this.result = `data:${blob.type};base64,${Buffer.from(r).toString('base64')}`;
      this.onloadend?.();
    });
  }
};

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, 'weapon-sources');
const OUT = path.join(here, '..', 'src', 'assets', 'models', 'weapons');

const v = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Per gun:
 * - turn: degrees around the up axis (so the barrel ends up pointing away)
 * - scale: source units → meters
 * - mats: source material name → [camo role, color, metalness, roughness]
 *   (role 'metal'/'dark'/'wood' take camos; anything else, e.g. 'trim', doesn't)
 * - parts: moving part → list of island numbers (separate pieces of the mesh,
 *   numbered in file order), plus its pivot
 * - remove: island numbers to leave out
 * - extra: boxes added to the model (a magazine the pistol's grip lacks, SMG
 *   iron sights), as [part, role, center, size, tilt° around X, color?]
 * - rear / front: rear sight and front sight; the gun is tilted so these two
 *   are level, and aiming looks along the line through them
 * - eye: how far behind the rear sight your eye is when aiming (default 0.2 m)
 * - markers: other points (muzzle, eject, grip_right, grip_left, grip_reload,
 *   grip_slide, grip_bolt)
 * - hand: where the right hand should end up in the game (meters), so the
 *   gun sits in the same place as the old models
 */
const GUNS = {
  pistol: {
    turn: 180,
    scale: 0.0425,
    mats: {
      Pistol_01_Gray: ['metal', 0x4a5058, 0.55, 0.38],
      Pistol_01_GrayScreen: ['metal', 0x565c64, 0.55, 0.38],
      Pistol_01_Metal: ['trim', 0x2b2d31, 0.4, 0.5],
      Pistol_01Black: ['dark', 0x26282c, 0.15, 0.6],
      Pistol_01BlackScreen: ['dark', 0x303236, 0.15, 0.65],
    },
    // The slide (with both sights and the barrel tip) racks back.
    parts: { slide: { islands: [1, 2, 6, 8, 9, 10, 11] } },
    // The rear sight is a solid block: swap it for two posts with a notch
    // between them, so the front sight shows through when aiming.
    remove: [0],
    // The grip is one solid piece, so the magazine is added: a body hidden
    // inside the grip and a base plate showing under it.
    extra: [
      ['mag', 'dark', v(0, -1.95, -0.86), v(0.44, 2.3, 0.62), 21],
      ['mag', 'trim', v(0, -3.03, -1.28), v(0.6, 0.16, 0.8), 0],
      ['slide', 'trim', v(0.09, 0.546, -0.868), v(0.06, 0.19, 0.2), 0],
      ['slide', 'trim', v(-0.09, 0.546, -0.868), v(0.06, 0.19, 0.2), 0],
    ],
    magPivot: v(0, -2.9, -1.28),
    rear: v(0, 0.56, -0.87),
    front: v(0, 0.554, 2.88),
    markers: {
      muzzle: v(0, 0.19, 3.23),
      eject: v(-0.27, 0.36, 0.8),
      grip_right: v(0, -1.4, -0.6),
      grip_left: v(0.7, -1.85, -0.35),
      grip_reload: v(0, -3.1, -1.3),
      grip_slide: v(0.7, 0.3, -1.1),
    },
    hand: v(0, -0.055, 0.05),
  },
  rifle: {
    turn: 0,
    scale: 0.2,
    mats: {
      Black_AssaultRIfle_02: ['dark', 0x26282c, 0.2, 0.6],
      Gray_AssaultRIfle_02: ['metal', 0x4a5058, 0.55, 0.38],
      White_AssaultRIfle_02: ['trim', 0x8a8f96, 0.6, 0.35],
    },
    parts: { mag: { islands: [8] } },
    // Rear: the middle of the aperture ring; front: the tip of the post.
    rear: v(0, 0.47, 0.48),
    front: v(0, 0.4, -1.36),
    markers: {
      muzzle: v(0, 0.065, -2.306),
      eject: v(0.09, 0.07, 0.15),
      grip_right: v(0, -0.42, 0.62),
      grip_left: v(0, -0.2, -0.85),
      grip_reload: v(0, -0.8, -0.18),
    },
    hand: v(0, -0.08, 0.1),
  },
  shotgun: {
    turn: 90,
    scale: 0.2,
    mats: {
      Brown_Shotgun01: ['wood', 0x7a4e28, 0, 0.7],
      Gray_Shotgun_01: ['metal', 0x464b52, 0.55, 0.38],
      White_Shotgun_01: ['trim', 0x1c1d20, 0.3, 0.6],
    },
    parts: { pump: { islands: [1] } },
    // A bigger brass bead on the muzzle, easier to see.
    extra: [['body', 'trim', v(2.06, 0.235, -0.015), v(0.07, 0.07, 0.07), 0, 0xc9a24a]],
    // No rear sight: you look a little over the receiver at the bead, so the
    // gun tips down a touch and the stock stays low.
    rear: v(-0.6, 0.4, -0.015),
    front: v(2.06, 0.262, -0.015),
    markers: {
      muzzle: v(2.132, 0.143, -0.015),
      eject: v(-0.6, 0.12, 0.08),
      grip_right: v(-1.3, -0.22, -0.015),
      grip_left: v(0.67, -0.2, -0.015),
      grip_reload: v(-0.5, -0.15, -0.015),
    },
    hand: v(0, -0.08, 0.1),
  },
  sniper: {
    turn: 0,
    scale: 0.137,
    mats: {
      Green_Sniper_02: ['metal', 0x4b5a35, 0.1, 0.6],
      Black_Sniper02: ['dark', 0x2a2c30, 0.3, 0.5],
      Silver_Sniper02: ['trim', 0x9aa0a6, 0.7, 0.3],
    },
    // The bolt (shroud, handle and knob) turns around the bore and slides back.
    parts: { mag: { islands: [2] }, bolt: { islands: [9, 10, 14, 15], pivot: v(-0.007, 0.094, 0.35) } },
    rear: v(-0.008, 0.54, 1.2),
    front: v(-0.008, 0.54, -2.0),
    markers: {
      muzzle: v(-0.007, 0.09, -5.85),
      eject: v(0.1, 0.15, 0.45),
      grip_right: v(0, -0.45, 0.95),
      grip_left: v(0, -0.4, -1.2),
      grip_reload: v(0, -0.72, -0.06),
      grip_bolt: v(0.31, -0.16, 0.43),
    },
    hand: v(0, -0.085, 0.12),
  },
  smg: {
    turn: 90,
    scale: 0.155,
    mats: {
      DarkMetal: ['dark', 0x2a2c30, 0.3, 0.5],
      Metal: ['metal', 0x4a5058, 0.55, 0.38],
      Black: ['trim', 0x1c1d20, 0.3, 0.6],
      Grey: ['trim', 0x5a5f66, 0.5, 0.4],
    },
    parts: { mag: { islands: [2, 14] } },
    // Iron sights: a rear notch (two posts) on the back of the rail, and a
    // post between the ears of the front sight hood.
    extra: [
      ['body', 'trim', v(-0.17, 0.94, 0.065), v(0.1, 0.09, 0.05), 0],
      ['body', 'trim', v(-0.17, 0.94, -0.065), v(0.1, 0.09, 0.05), 0],
      ['body', 'trim', v(-0.17, 0.875, 0), v(0.1, 0.05, 0.18), 0],
      ['body', 'trim', v(1.77, 0.9, 0), v(0.05, 0.12, 0.035), 0],
    ],
    rear: v(-0.17, 0.958, 0),
    front: v(1.77, 0.96, 0),
    markers: {
      muzzle: v(2.249, 0.567, 0),
      eject: v(0.5, 0.65, 0.16),
      grip_right: v(-0.06, 0.05, 0),
      grip_left: v(1.4, 0.2, 0),
      grip_reload: v(0.85, -0.86, 0),
    },
    hand: v(0, -0.075, 0.075),
  },
};

/** How big one camo tile is on the gun (meters). */
const UV_SIZE = 0.3;

async function load(file) {
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
}

/** Split each mesh into islands (connected pieces), in world coordinates. */
function islands(scene) {
  scene.updateMatrixWorld(true);
  const out = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const idx = g.index ? Array.from(g.index.array) : [...Array(pos.count).keys()];
    const key = new Map();
    const vid = new Int32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
      if (!key.has(k)) key.set(k, key.size);
      vid[i] = key.get(k);
    }
    const par = [...Array(key.size).keys()];
    const find = (x) => {
      while (par[x] !== x) x = par[x] = par[par[x]];
      return x;
    };
    for (let t = 0; t < idx.length; t += 3) {
      const a = find(vid[idx[t]]);
      par[find(vid[idx[t + 1]])] = a;
      par[find(vid[idx[t + 2]])] = a;
    }
    const groups = new Map();
    for (let t = 0; t < idx.length; t += 3) {
      const r = find(vid[idx[t]]);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(t);
    }
    for (const tris of groups.values()) {
      // Each island as its own non-indexed geometry (positions + normals).
      const p = [];
      const n = [];
      for (const t of tris) {
        for (let j = 0; j < 3; j++) {
          const i = idx[t + j];
          p.push(pos.getX(i), pos.getY(i), pos.getZ(i));
          n.push(nor.getX(i), nor.getY(i), nor.getZ(i));
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
      out.push({ mat: o.material.name, geo });
    }
  });
  return out;
}

/** Box-projected UVs (so camo patterns wrap the gun evenly). */
function boxUVs(geo) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    const x = pos.getX(i) / UV_SIZE;
    const y = pos.getY(i) / UV_SIZE;
    const z = pos.getZ(i) / UV_SIZE;
    const [a, b] = ax >= ay && ax >= az ? [z, y] : ay >= az ? [x, z] : [x, y];
    uv[i * 2] = a;
    uv[i * 2 + 1] = b;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

async function bake(id, cfg) {
  const gltf = await load(path.join(SRC, `${id}.glb`));
  const list = islands(gltf.scene);

  // Source → game: turn, scale, then tilt so the sights are level, then move
  // so the right hand lands on cfg.hand.
  const base = new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(cfg.turn)).multiply(new THREE.Matrix4().makeScale(cfg.scale, cfg.scale, cfg.scale));
  const r = cfg.rear.clone().applyMatrix4(base);
  const f = cfg.front.clone().applyMatrix4(base);
  // Pitch (around X) that brings the front sight to the rear sight's height.
  const pitch = Math.atan2(r.y - f.y, r.z - f.z);
  const xf = new THREE.Matrix4().makeRotationX(pitch).multiply(base);
  const hand = cfg.markers.grip_right.clone().applyMatrix4(xf);
  xf.premultiply(new THREE.Matrix4().makeTranslation(cfg.hand.x - hand.x, cfg.hand.y - hand.y, cfg.hand.z - hand.z));

  const role = (srcMat) => cfg.mats[srcMat] ?? ['trim', 0x808080, 0.3, 0.6];
  const mats = new Map();
  const material = (name, [kind, color, metalness, roughness]) => {
    const key = `${kind}:${name}`;
    if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ name: key, color, metalness, roughness }));
    return mats.get(key);
  };

  // Which part each island belongs to.
  const partOf = new Map();
  for (const [part, p] of Object.entries(cfg.parts ?? {})) for (const i of p.islands) partOf.set(i, part);

  // Collect geometry per part per material.
  const buckets = new Map(); // part -> matKey -> geos
  const add = (part, mat, geo) => {
    if (!buckets.has(part)) buckets.set(part, new Map());
    const b = buckets.get(part);
    if (!b.has(mat.name)) b.set(mat.name, { mat, geos: [] });
    b.get(mat.name).geos.push(geo);
  };
  list.forEach((isl, i) => {
    if (cfg.remove?.includes(i)) return;
    const geo = isl.geo.applyMatrix4(xf);
    add(partOf.get(i) ?? 'body', material(isl.mat, role(isl.mat)), geo);
  });
  for (const [part, kind, center, size, tilt, color] of cfg.extra ?? []) {
    const geo = new THREE.BoxGeometry(size.x, size.y, size.z).toNonIndexed();
    geo.deleteAttribute('uv');
    geo.rotateX(THREE.MathUtils.degToRad(tilt));
    geo.translate(center.x, center.y, center.z);
    geo.applyMatrix4(xf);
    const props = Object.values(cfg.mats).find((m) => m[0] === kind) ?? ['trim', 0x2b2d31, 0.4, 0.5];
    add(part, material(color ? `added_${color.toString(16)}` : 'added', [kind, color ?? props[1], ...props.slice(2)]), geo);
  }

  const root = new THREE.Group();
  root.name = `gun_${id}`;
  for (const [part, b] of buckets) {
    let holder = root;
    if (part !== 'body') {
      holder = new THREE.Group();
      holder.name = part;
      const p = cfg.parts?.[part]?.pivot ?? (part === 'mag' ? cfg.magPivot : null);
      let pivot;
      if (p) pivot = p.clone().applyMatrix4(xf);
      else {
        const box = new THREE.Box3();
        for (const { geos } of b.values()) for (const g of geos) box.union(new THREE.Box3().setFromBufferAttribute(g.attributes.position));
        pivot = box.getCenter(new THREE.Vector3());
      }
      holder.position.copy(pivot);
      root.add(holder);
      for (const { geos } of b.values()) for (const g of geos) g.translate(-pivot.x, -pivot.y, -pivot.z);
    }
    for (const { mat, geos } of b.values()) {
      const geo = mergeGeometries(geos.map((g) => {
        for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
        return g;
      }));
      // UVs in gun coordinates (so a moving part's camo lines up with the body at rest).
      if (holder !== root) geo.translate(holder.position.x, holder.position.y, holder.position.z);
      boxUVs(geo);
      if (holder !== root) geo.translate(-holder.position.x, -holder.position.y, -holder.position.z);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `${part}_${mat.name.replace(/[^a-z0-9]+/gi, '_')}`;
      holder.add(mesh);
    }
  }

  // Markers.
  const mark = (name, p) => {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.copy(p.clone().applyMatrix4(xf));
    root.add(o);
  };
  // The 'sight' marker is where aiming puts a point 0.2 m in front of your
  // eye (see SIGHT_DISTANCE in animations.ts); cfg.eye moves the eye closer
  // to the rear sight than that.
  const sight = cfg.rear.clone().applyMatrix4(xf);
  sight.z += (cfg.eye ?? 0.2) - 0.2;
  const sightMarker = new THREE.Object3D();
  sightMarker.name = 'sight';
  sightMarker.position.copy(sight);
  root.add(sightMarker);
  for (const [name, p] of Object.entries(cfg.markers)) mark(name, p);

  const scene = new THREE.Scene();
  scene.add(root);
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
  fs.writeFileSync(path.join(OUT, `${id}.glb`), Buffer.from(glb));
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  console.log(`${id}: ${list.length} pieces, ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} m, sights tilted ${THREE.MathUtils.radToDeg(pitch).toFixed(2)}°, ${Buffer.from(glb).length} bytes`);
}

fs.mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
for (const [id, cfg] of Object.entries(GUNS)) if (!only.length || only.includes(id)) await bake(id, cfg);
