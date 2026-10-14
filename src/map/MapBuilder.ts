import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getMaterial, getTileSize } from '../assets/materials';
import { CollisionWorld } from '../core/CollisionWorld';
import { CONFIG } from '../config';
import type { MapDef, MaterialId } from './MapTypes';

export interface BuiltMap {
  def: MapDef;
  group: THREE.Group;
  world: CollisionWorld;
  bounds: THREE.Box3;
}

/** Turns a MapDef (plain data) into 3D meshes + collision data. */
export function buildMap(def: MapDef, scene: THREE.Scene): BuiltMap {
  const group = new THREE.Group();
  group.name = `map:${def.id}`;
  const world = new CollisionWorld();
  const byMaterial = new Map<MaterialId, THREE.BufferGeometry[]>();
  const bounds = new THREE.Box3();

  const add = (mat: MaterialId, geo: THREE.BufferGeometry) => {
    applyWorldUVs(geo, getTileSize(mat));
    if (!byMaterial.has(mat)) byMaterial.set(mat, []);
    byMaterial.get(mat)!.push(geo);
    geo.computeBoundingBox();
    bounds.union(geo.boundingBox!);
  };

  for (const b of def.boxes) {
    world.addBox(b);
    const geo = new THREE.BoxGeometry(b.w, b.h, b.d).toNonIndexed();
    geo.translate(b.x, b.y + b.h / 2, b.z);
    add(b.material ?? 'concrete', geo);
  }

  for (const r of def.ramps) {
    world.addRamp(r);
    add(r.material ?? 'metal', rampGeometry(world));
  }

  // One mesh per material keeps draw calls low (good for frame rate).
  for (const [mat, geos] of byMaterial) {
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    const mesh = new THREE.Mesh(merged, getMaterial(mat));
    mesh.castShadow = CONFIG.render.shadows;
    mesh.receiveShadow = CONFIG.render.shadows;
    mesh.name = `map-${mat}`;
    group.add(mesh);
  }

  addLighting(group, bounds);
  scene.background = new THREE.Color(def.skyColor);
  scene.fog = new THREE.Fog(def.skyColor, def.fogNear, def.fogFar);
  scene.add(group);

  return { def, group, world, bounds };
}

/** A ramp is a box whose top is sloped. */
function rampGeometry(world: CollisionWorld): THREE.BufferGeometry {
  const ramp = world.ramps[world.ramps.length - 1];
  const { minX: x0, maxX: x1, minZ: z0, maxZ: z1, minY: y0 } = ramp;
  const h = (x: number, z: number) => world.rampHeightAt(ramp, x, z);

  // 8 corners: bottom (b) and top (t).
  const b00 = [x0, y0, z0], b10 = [x1, y0, z0], b11 = [x1, y0, z1], b01 = [x0, y0, z1];
  const t00 = [x0, h(x0, z0), z0], t10 = [x1, h(x1, z0), z0], t11 = [x1, h(x1, z1), z1], t01 = [x0, h(x0, z1), z1];

  const quads: number[][][] = [
    [t00, t01, t11, t10], // top
    [b00, b10, b11, b01], // bottom
    [b00, t00, t10, b10], // -z side
    [b01, b11, t11, t01], // +z side
    [b00, b01, t01, t00], // -x side
    [b10, t10, t11, b11], // +x side
  ];
  const pos: number[] = [];
  for (const [a, b, c, d] of quads) pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Sets texture coordinates from world position so textures tile evenly
 * regardless of how big each box is.
 */
function applyWorldUVs(geo: THREE.BufferGeometry, tile: number): void {
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i));
    let u: number, v: number;
    if (ny >= nx && ny >= nz) { u = x; v = z; }
    else if (nx >= nz) { u = z; v = y; }
    else { u = x; v = y; }
    uv[i * 2] = u / tile;
    uv[i * 2 + 1] = v / tile;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function addLighting(group: THREE.Group, bounds: THREE.Box3): void {
  group.add(new THREE.HemisphereLight(0xdde8ff, 0x4a4036, 1.1));

  const sun = new THREE.DirectionalLight(0xfff1dd, 2.0);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.z) * 0.75;
  sun.position.set(center.x + radius * 0.5, center.y + radius, center.z + radius * 0.35);
  sun.target.position.copy(center);
  if (CONFIG.render.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const cam = sun.shadow.camera;
    cam.left = -radius; cam.right = radius; cam.top = radius; cam.bottom = -radius;
    cam.near = 1; cam.far = radius * 4;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
  }
  group.add(sun, sun.target);
}
