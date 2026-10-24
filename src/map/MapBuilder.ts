import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getMaterial, getTileSize, type SurfaceId } from '../assets/materials';
import { CollisionWorld } from '../core/CollisionWorld';
import { currentQuality } from '../render/quality';
import { barrierCollision, BOARDS, BRICKS, CONCRETE_PANELS, crateFrame, faceSampler, jerseyBarrier, logRelief, rampDetail, relief, RUIN_STONES, skirting, stairSteps, STONE_BLOCKS } from './details';
import { buildModel, windowFrameParts, type ModelPart } from './models';
import { Sky, sunDirection } from '../render/Sky';
import type { BoxDef, LampDef, MapDef, MaterialId, PropDef, SkyDef, TerrainDef } from './MapTypes';
import { propFoliage, propGeometry, propRadius, propSolids } from './nature';
import { fbm, smoothstep, terrainRangeUnder } from './terrain';

export interface BuiltMap {
  def: MapDef;
  group: THREE.Group;
  world: CollisionWorld;
  bounds: THREE.Box3;
  /** The part players can reach (the play area, or everything). */
  playBounds: THREE.Box3;
  sky: Sky;
  /** How much lamp light reaches a point (for lighting characters). */
  sampleLampLight(p: THREE.Vector3, out: THREE.Color): THREE.Color;
  /** Keep the sun's shadows centered on the viewer (call each frame with the camera position). */
  updateShadows(p: THREE.Vector3): void;
}

/** Size of the lighting "tiles" baked onto surfaces (meters). Smaller = finer, slower to load. */
const BAKE_CELL = 1.0;
/** Big plain surfaces (rock walls, water) get coarser lighting tiles: far fewer vertices. */
const COARSE_BAKE: Partial<Record<MaterialId, number>> = { rock: 4, water: 3 };
/** Rays per tile corner used to measure how enclosed it is (ambient occlusion). */
const AO_RAYS = 12;
const AO_DISTANCE = 1.5;
const AO_STRENGTH = 0.85;
/** How far indoor-shading rays look for a ceiling or wall (meters). */
const INDOOR_DISTANCE = 18;
/** Overall brightness of baked lamp light. */
const LAMP_STRENGTH = 0.95;
/**
 * Bounced sunlight: sunlit floors and walls light up what's around them
 * (warm light spilling into rooms through windows, under roofs, onto the
 * shady side of walls). How strong, how far it reaches, rays per corner.
 */
const BOUNCE_STRENGTH = 0.32;
const BOUNCE_DISTANCE = 9;
/** The sun, for bounced light while baking (set by buildMap). */
let SUN: { dir: THREE.Vector3; color: THREE.Color } | null = null;
/** Bounce rays: every other AO direction. */
const BOUNCE_EVERY = 2;

/** Sunlight bounced onto point p (facing n) from sunlit surfaces nearby, added into `out`. */
function bounceAt(world: CollisionWorld, px: number, py: number, pz: number, n: THREE.Vector3, t1: THREE.Vector3, t2: THREE.Vector3, dirs: THREE.Vector3[], out: THREE.Color): void {
  if (!SUN) return;
  const sd = SUN.dir;
  let acc = 0, count = 0;
  for (let k = 0; k < dirs.length; k += BOUNCE_EVERY) {
    const dir = dirs[k];
    count++;
    const dx = t1.x * dir.x + t2.x * dir.y + n.x * dir.z, dy = t1.y * dir.x + t2.y * dir.y + n.y * dir.z, dz = t1.z * dir.x + t2.z * dir.y + n.z * dir.z;
    const hit = world.raycast(px, py, pz, dx, dy, dz, BOUNCE_DISTANCE);
    if (!hit) continue;
    const ndl = hit.nx * sd.x + hit.ny * sd.y + hit.nz * sd.z;
    if (ndl <= 0.05) continue;
    const hx = px + dx * hit.distance + hit.nx * 0.03, hy = py + dy * hit.distance + hit.ny * 0.03, hz = pz + dz * hit.distance + hit.nz * 0.03;
    if (world.raycast(hx, hy, hz, sd.x, sd.y, sd.z, 120)) continue; // that spot is in shadow
    acc += ndl * (1 - 0.6 * (hit.distance / BOUNCE_DISTANCE));
  }
  if (!count || acc <= 0) return;
  const k = (BOUNCE_STRENGTH * acc) / count;
  out.r += SUN.color.r * k;
  out.g += SUN.color.g * k * 0.93;
  out.b += SUN.color.b * k * 0.82;
}

/**
 * Baking takes a moment, so results are kept per map and reused (by the
 * menu background and every later match on the same map).
 */
const bakeCache = new Map<string, { geos: { mat: SurfaceId; geo: THREE.BufferGeometry }[]; bounds: THREE.Box3 }>();

/**
 * Surfaces with lots of vertices are merged per area (this many meters
 * square), so areas out of view are skipped when drawing.
 */
const CHUNKED = new Map<SurfaceId, number>([['brick', 14], ['panel', 14], ['needles', 45], ['foliage', 45], ['bark', 45], ['rock', 45]]);

/** Detail parts that are too small/thin to be worth drawing into the shadow map. */
const NO_SHADOW = new Set<SurfaceId>(['brick', 'panel', 'crateFrame', 'glass']);

type V3 = [number, number, number];
interface Quad {
  corners: [V3, V3, V3, V3];
  material: MaterialId;
}

/**
 * Turns a MapDef (plain data) into 3D meshes + collision data, with the
 * lighting (corner shading and lamp light) baked into the surfaces.
 */
/** A plain sky made from a map's skyColor (for maps without a `sky`). */
function defaultSky(def: MapDef): SkyDef {
  const horizon = new THREE.Color(def.skyColor);
  const zenith = horizon.clone().lerp(new THREE.Color(0x2d5fa8), 0.55);
  return { zenith: zenith.getHex(), horizon: def.skyColor, sunColor: 0xfff1dd, sunElevation: 55, sunAzimuth: 120, clouds: 0.3 };
}

export interface BuildOptions {
  /** Use this sky instead of the map's own (the menu background uses a dusk sky). */
  sky?: SkyDef;
  fog?: [number, number];
}

export function buildMap(def: MapDef, scene: THREE.Scene, opts: BuildOptions = {}): BuiltMap {
  const quality = currentQuality();
  const group = new THREE.Group();
  group.name = `map:${def.id}`;
  const world = new CollisionWorld();
  const bounds = new THREE.Box3();
  const quads: Quad[] = [];
  /** Extra detail models (crate frames, barriers), baked like the surfaces. */
  const props: { geo: THREE.BufferGeometry; material: SurfaceId }[] = [];
  /** Boxes drawn as detailed models (furniture, cars, statues...). */
  const modelBoxes: BoxDef[] = [];
  const detail = quality.mapDetail;

  // The arena's footprint: faces looking out of it can never be seen.
  const foot = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const b of def.boxes) {
    if (b.hidden) continue;
    foot.x0 = Math.min(foot.x0, b.x - b.w / 2);
    foot.x1 = Math.max(foot.x1, b.x + b.w / 2);
    foot.z0 = Math.min(foot.z0, b.z - b.d / 2);
    foot.z1 = Math.max(foot.z1, b.z + b.d / 2);
  }
  const terrain = def.terrain;
  if (terrain) {
    world.setTerrain(terrain);
    foot.x0 = Math.min(foot.x0, terrain.x0);
    foot.x1 = Math.max(foot.x1, terrain.x0 + terrain.cols * terrain.cell);
    foot.z0 = Math.min(foot.z0, terrain.z0);
    foot.z1 = Math.max(foot.z1, terrain.z0 + terrain.rows * terrain.cell);
  }
  if (def.playArea) {
    // Invisible walls around the play area (walking only).
    const { x0, z0, x1, z1 } = def.playArea, T = 4, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, W = x1 - x0 + 2 * T, D = z1 - z0 + 2 * T;
    for (const b of [
      { x: cx, z: z0 - T / 2, w: W, d: T }, { x: cx, z: z1 + T / 2, w: W, d: T },
      { x: x0 - T / 2, z: cz, w: T, d: D }, { x: x1 + T / 2, z: cz, w: T, d: D },
    ]) world.addBox({ ...b, y: -100, h: 400 }, true);
  }
  // Trees, rocks, logs: standing on the terrain (on its lowest point under them, so they never float).
  const placed: { p: PropDef; y: number }[] = (def.props ?? []).map((p) => {
    if (p.y !== undefined || !terrain) return { p, y: p.y ?? 0 };
    const r = p.kind === 'log' ? 1.2 * (p.size ?? 1) : Math.min(0.8, propRadius(p) * 0.4);
    return { p, y: terrainRangeUnder(terrain, p.x, p.z, r)[0] - 0.04 };
  });
  for (const { p, y } of placed) {
    for (const b of propSolids(p, y)) world.addBox(b);
    for (const [x, fy, z, r] of propFoliage(p, y)) world.addFoliage(x, fy, z, r);
  }

  // ---- Collect every surface as a 4-cornered face ---------------------------
  for (const b of def.boxes) {
    if (b.hidden) {
      world.addBox(b, true);
      continue;
    }
    if (!b.model && b.material === 'container' && b.h >= 2.2 && b.h <= 3.2 && Math.max(b.w, b.d) >= 4.5) {
      // Shipping containers get the real thing (corrugated walls, doors, frame), each in a different color.
      world.addBox(b);
      const palette = [0x8a3b2c, 0x2f5f8a, 0x3f6f3f, 0xc0782a, 0x7a7f86, 0xa8925a, 0x6a2f5a];
      modelBoxes.push({ ...b, model: 'shippingContainer', rot: b.w > b.d ? 90 : 0, tint: palette[Math.abs(Math.floor(b.x * 7 + b.z * 13)) % palette.length] });
      continue;
    }
    if (b.model) {
      // Drawn as a model; the box is still the solid part.
      if (!b.decor) world.addBox(b, b.material === 'glass');
      modelBoxes.push(b);
      continue;
    }
    if (b.material === 'trim') {
      // Yellow barriers are jersey barriers: their own shape and collision.
      for (const part of barrierCollision(b)) world.addBox(part);
      for (const g of jerseyBarrier(b)) props.push({ geo: g, material: 'trim' });
      continue;
    }
    if (!b.decor) world.addBox(b, b.material === 'glass');
    if (b.material === 'crate') for (const g of crateFrame(b)) props.push({ geo: g, material: 'crateFrame' });
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, y0 = b.y, y1 = b.y + b.h, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
    pushBoxQuads(quads, x0, x1, y0, y1, z0, z1, () => [y1, y1, y1, y1], faceMaterials(b), y0 <= 0.01);
  }
  for (const r of def.ramps) {
    if (!r.decor) world.addRamp(r);
    const ramp = r.decor ? CollisionWorld.rampShape(r) : world.ramps[world.ramps.length - 1];
    const h = (x: number, z: number) => world.rampHeightAt(ramp, x, z);
    const { minX: x0, maxX: x1, minZ: z0, maxZ: z1, minY: y0 } = ramp;
    if (r.material === 'stairs') {
      // Stairs: you walk on the smooth slope, but what you see is steps.
      for (const g of stairSteps(r)) props.push({ geo: g, material: 'stairs' });
      continue;
    }
    const m = r.material ?? 'metal';
    pushBoxQuads(quads, x0, x1, y0, 0, z0, z1, () => [h(x0, z0), h(x0, z1), h(x1, z1), h(x1, z0)], { top: m, bottom: m, '-x': m, '+x': m, '-z': m, '+z': m }, y0 <= 0.01);
    if (m === 'metal') for (const g of rampDetail(r)) props.push({ geo: g, material: 'steel' });
  }

  // ---- Window frames and sills around every pane of glass in a wall ---------------
  const frames: ModelPart[][] = [];
  for (const g of def.boxes) {
    if (g.material !== 'glass' || g.model || g.h < 0.5 || Math.min(g.w, g.d) > 0.12 || Math.max(g.w, g.d) < 0.4) continue;
    const along = g.w >= g.d;
    // The wall piece just below (for the sill, and to pick materials).
    const below = def.boxes.find((o) => o !== g && !o.decor && !o.model && o.material !== 'glass' && Math.abs(o.y + o.h - g.y) < 0.03 &&
      Math.abs(o.x - g.x) < o.w / 2 && Math.abs(o.z - g.z) < o.d / 2);
    const wm = below?.material ?? 'glass';
    const wood = wm === 'timber' || wm === 'planks' || wm === 'barnwood' || wm === 'ruin';
    const stone = wm === 'stone' || wm === 'marble';
    const frame: SurfaceId = wood ? 'planks' : stone ? 'paint' : 'chrome';
    const frameTint = wood ? 0xf2eee6 : stone ? 0x2e3236 : below ? 0x5a6068 : 0x9aa1a8;
    const sill: SurfaceId = wood ? 'planks' : stone ? 'marble' : wm === 'concrete' ? 'concrete' : 'paint';
    frames.push(windowFrameParts(g, below ? (along ? below.d : below.w) : null, frame, frameTint, sill, wood ? 0xf2eee6 : undefined));
  }

  // ---- Tessellate, bake, and group by material (or reuse an earlier bake) -----
  const lamps = def.lamps ?? [];
  const lampPos = lamps.map((l) => lightOrigin(l));
  const skyDef = opts.sky ?? def.sky ?? defaultSky(def);
  SUN = detail ? { dir: sunDirection(skyDef), color: new THREE.Color(skyDef.sunColor).multiplyScalar(skyDef.sunIntensity ?? 2.4) } : null;
  // (The sun's position changes the baked bounce light, so it's part of the key.)
  const cacheKey = `${def.id}:${detail ? 'detail' : 'plain'}:${skyDef.sunElevation}:${skyDef.sunAzimuth}`;
  let baked = bakeCache.get(cacheKey);
  if (!baked) {
    const byMaterial = new Map<SurfaceId, THREE.BufferGeometry[]>();
    const put = (mat: SurfaceId, geo: THREE.BufferGeometry) => {
      if (!geo.getAttribute('uv')) applyWorldUVs(geo, getTileSize(mat));
      if (!byMaterial.has(mat)) byMaterial.set(mat, []);
      byMaterial.get(mat)!.push(geo);
      geo.computeBoundingBox();
      bounds.union(geo.boundingBox!);
    };
    const covered = (x: number, y: number, z: number) => world.isInsideSolid(x, y, z, 0);
    const indoor = def.indoorShading ?? 0;
    const aoDirs = hemisphereDirections(AO_RAYS);
    for (const q of quads) {
      const n = faceNormal(q.corners);
      if (!n) continue; // zero-area face (e.g. the thin end of a ramp)
      if (facesOutside(q.corners, n, foot)) continue; // back of the outer walls
      const geo = tessellate(q.corners, COARSE_BAKE[q.material] ?? BAKE_CELL);
      bake(geo, world, aoDirs, lamps, lampPos, false, indoor);
      let mat: SurfaceId = q.material;
      const wall = Math.abs(n.y) < 0.1;
      // Metal floors and ramps get diamond-plate tread on top.
      if (q.material === 'metal' && n.y > 0.5) mat = 'tread';
      if (detail && q.material === 'wall') {
        // Real bricks on the sides, a concrete cap on top.
        if (wall) {
          for (const g of relief(q.corners, n, BRICKS, faceSampler(q.corners, geo, geo.userData.nu, geo.userData.nv), covered)) put('brick', g);
          mat = 'mortar';
        } else mat = 'concrete';
      } else if (detail && wall && q.material === 'stone') {
        // Raised sandstone blocks with mortar joints.
        for (const g of relief(q.corners, n, STONE_BLOCKS, faceSampler(q.corners, geo, geo.userData.nu, geo.userData.nv), covered)) put('stone', g);
        mat = 'mortar';
      } else if (detail && wall && q.material === 'ruin') {
        for (const g of relief(q.corners, n, RUIN_STONES, faceSampler(q.corners, geo, geo.userData.nu, geo.userData.nv), covered)) put('ruin', g);
        mat = 'seam';
      } else if (detail && wall && (q.material === 'barnwood' || q.material === 'planks')) {
        for (const g of relief(q.corners, n, BOARDS, faceSampler(q.corners, geo, geo.userData.nu, geo.userData.nv), covered)) put(q.material, g);
        mat = 'seam';
      } else if (detail && wall && q.material === 'timber') {
        // Round logs stacked up the wall (the flat wall behind only shows in the gaps).
        for (const g of logRelief(q.corners, n, faceSampler(q.corners, geo, geo.userData.nu, geo.userData.nv))) put('timber', g);
        mat = 'seam';
      } else if (detail && wall && q.material === 'drywall') {
        // A baseboard along the bottom, if the wall stands on a floor.
        const ys = q.corners.map((c) => c[1]), y0 = Math.min(...ys);
        const cx = (q.corners[0][0] + q.corners[2][0]) / 2 + n.x * 0.1, cz = (q.corners[0][2] + q.corners[2][2]) / 2 + n.z * 0.1;
        if (covered(cx, y0 - 0.05, cz) && !covered(cx, y0 + 0.05, cz)) {
          const sk = skirting(q.corners, n, faceSampler(q.corners, geo, geo.userData.nu, geo.userData.nv));
          if (sk) put('paint', sk);
        }
      } else if (!detail && q.material === 'concrete' && wall) {
        mat = 'concreteWall';
      } else if (detail && q.material === 'concrete' && wall) {
        for (const g of relief(q.corners, n, CONCRETE_PANELS, faceSampler(q.corners, geo, geo.userData.nu, geo.userData.nv), covered)) put('panel', g);
        // The surface behind the panels only shows in the seams.
        mat = 'seam';
      }
      put(mat, geo);
    }
    for (const p of props) {
      bake(p.geo, world, aoDirs, lamps, lampPos, true, indoor);
      put(p.material, p.geo);
    }
    for (const parts of frames) {
      bakeModelBox(parts, world, aoDirs, lamps, lampPos, indoor);
      for (const part of parts) put(part.material, part.geo);
    }
    for (const b of modelBoxes) {
      const parts = buildModel(b);
      if (!parts.length) continue;
      bakeModelBox(parts, world, aoDirs, lamps, lampPos, indoor);
      for (const part of parts) put(part.material, part.geo);
    }
    if (terrain) for (const [mat, geo] of buildTerrain(terrain, placed, world, aoDirs, lamps, lampPos, def.playArea)) put(mat, geo);
    for (const { p, y } of placed) {
      for (const part of propGeometry(p, y)) {
        if (part.prebaked) part.geo.setAttribute('aLight', new THREE.BufferAttribute(new Float32Array(part.geo.getAttribute('position').count * 3), 3));
        else bake(part.geo, world, aoDirs, lamps, lampPos, true, indoor);
        put(part.material, part.geo);
      }
    }
    // One mesh per material keeps draw calls low (good for frame rate).
    const geos: { mat: SurfaceId; geo: THREE.BufferGeometry }[] = [];
    for (const [mat, pieces] of byMaterial) {
      // Group by area (for big detail surfaces) or all together.
      const groups = new Map<string, THREE.BufferGeometry[]>();
      for (const g of pieces) {
        const c = g.boundingBox!.getCenter(new THREE.Vector3());
        const cell = CHUNKED.get(mat);
        const key = cell ? `${Math.floor(c.x / cell)},${Math.floor(c.z / cell)}` : 'all';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(g);
      }
      for (const all of groups.values()) {
        // (Merging needs all pieces to be the same kind: indexed or not.)
        const mixed = all.some((g) => !g.index) && all.some((g) => g.index);
        const list = mixed ? all.map((g) => (g.index ? g.toNonIndexed() : g)) : all;
        const merged = mergeGeometries(list, false);
        merged.userData.cached = true; // shared between matches: don't dispose
        merged.computeBoundingSphere();
        geos.push({ mat, geo: merged });
        for (const g of all) g.dispose();
        for (const g of list) g.dispose();
      }
    }
    bakeCache.set(cacheKey, (baked = { geos, bounds: bounds.clone() }));
  }
  bounds.copy(baked.bounds);

  for (const { mat, geo } of baked.geos) {
    const mesh = new THREE.Mesh(geo, getMaterial(mat, quality.materials));
    // Small surface detail doesn't need to cast shadows (less to draw into the shadow map).
    mesh.castShadow = !NO_SHADOW.has(mat);
    mesh.receiveShadow = true;
    if (mat === 'glass') mesh.renderOrder = 10; // see-through: drawn after everything solid
    mesh.name = `map-${mat}`;
    mesh.userData.mapSurface = mat;
    group.add(mesh);
  }

  if (lamps.length) group.add(buildLampFixtures(lamps));
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const sky = new Sky(skyDef, center, Math.max(size.x, size.z) * 0.6);
  group.add(sky.group);
  // The reachable part: shadows only need to cover this (sharper shadows on maps with far-off scenery).
  const playBounds = bounds.clone();
  if (def.playArea) {
    const a = def.playArea;
    playBounds.min.x = Math.max(bounds.min.x, a.x0);
    playBounds.max.x = Math.min(bounds.max.x, a.x1);
    playBounds.min.z = Math.max(bounds.min.z, a.z0);
    playBounds.max.z = Math.min(bounds.max.z, a.z1);
  }
  const updateShadows = addSunAndSky(group, playBounds, quality.shadowMapSize, skyDef, sky.sunDir);
  scene.background = new THREE.Color(skyDef.horizon);
  const [fogNear, fogFar] = opts.fog ?? [def.fogNear, def.fogFar];
  scene.fog = new THREE.Fog(skyDef.horizon, fogNear, fogFar);
  scene.userData.sky = sky;
  scene.add(group);

  const sampleLampLight = (p: THREE.Vector3, out: THREE.Color): THREE.Color => {
    out.setRGB(0, 0, 0);
    lamps.forEach((l, i) => {
      const o = lampPos[i];
      const d = Math.hypot(o[0] - p.x, o[1] - p.y, o[2] - p.z);
      if (d >= l.range || !world.hasLineOfSight(p.x, p.y, p.z, o[0], o[1], o[2])) return;
      const a = falloff(d, l.range) * l.intensity * 0.55;
      out.r += ((l.color >> 16) & 255) / 255 * a;
      out.g += ((l.color >> 8) & 255) / 255 * a;
      out.b += (l.color & 255) / 255 * a;
    });
    return out;
  };

  return { def, group, world, bounds, playBounds, sky, sampleLampLight, updateShadows };
}

/**
 * The terrain's surface, split by material: rock where it's steep, dirt on
 * paths, the ground material elsewhere. Lighting is baked once on the whole
 * grid; then the ground gets darker under tree crowns and a little color
 * variation, so it doesn't look uniform.
 */
function buildTerrain(
  t: TerrainDef, placed: { p: PropDef; y: number }[], world: CollisionWorld, dirs: THREE.Vector3[], lamps: LampDef[], lampPos: V3[],
  playArea?: MapDef['playArea'],
): [SurfaceId, THREE.BufferGeometry][] {
  const W = t.cols + 1, n = W * (t.rows + 1), C = t.cell, H = t.heights;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  const at = (i: number, j: number) => H[Math.min(t.rows, Math.max(0, j)) * W + Math.min(t.cols, Math.max(0, i))];
  for (let j = 0; j <= t.rows; j++) {
    for (let i = 0; i <= t.cols; i++) {
      const k = j * W + i;
      pos.set([t.x0 + i * C, H[k], t.z0 + j * C], k * 3);
      // Smooth normal from the slope around this point.
      const sx = (at(i + 1, j) - at(i - 1, j)) / (2 * C), sz = (at(i, j + 1) - at(i, j - 1)) / (2 * C);
      const l = Math.hypot(sx, 1, sz);
      nrm.set([-sx / l, 1 / l, -sz / l], k * 3);
    }
  }
  const grid = new THREE.BufferGeometry();
  grid.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  grid.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  // Far scenery (well outside the play area) doesn't need measured shading.
  const area = playArea;
  const far = area ? (x: number, z: number) => x < area.x0 - 15 || x > area.x1 + 15 || z < area.z0 - 15 || z > area.z1 + 15 : undefined;
  bake(grid, world, dirs, lamps, lampPos, false, 0, far, false);
  const col = grid.getAttribute('color') as THREE.BufferAttribute;
  const light = grid.getAttribute('aLight') as THREE.BufferAttribute;

  // Shade under tree crowns, and vary the color a little in patches.
  const shade = new Float32Array(n).fill(1);
  for (const { p } of placed) {
    if (p.kind !== 'pine' && p.kind !== 'tree') continue;
    const R = propRadius(p) * 1.25;
    for (let j = Math.max(0, Math.floor((p.z - R - t.z0) / C)); j <= Math.min(t.rows, Math.ceil((p.z + R - t.z0) / C)); j++) {
      for (let i = Math.max(0, Math.floor((p.x - R - t.x0) / C)); i <= Math.min(t.cols, Math.ceil((p.x + R - t.x0) / C)); i++) {
        const d = Math.hypot(t.x0 + i * C - p.x, t.z0 + j * C - p.z);
        shade[j * W + i] *= 1 - 0.28 * smoothstep(R, R * 0.3, d);
      }
    }
  }
  for (let k = 0; k < n; k++) {
    const x = pos[k * 3], z = pos[k * 3 + 2];
    const v = fbm(x / 9, z / 9, 7, 2);
    const m = shade[k];
    col.setXYZ(k, col.getX(k) * m * (1 + v * 0.1), col.getY(k) * m * (1 + v * 0.06), col.getZ(k) * m * (1 - v * 0.05));
  }

  // Pick a material per grid cell.
  const ground = t.material ?? 'forest', pathMat = t.pathMaterial ?? 'dirt';
  const segs: [number, number, number, number, number][] = [];
  for (const path of t.paths ?? []) {
    for (let i = 0; i + 1 < path.points.length; i++) segs.push([...path.points[i], ...path.points[i + 1], path.width / 2]);
  }
  const onPath = (x: number, z: number) => segs.some(([ax, az, bx, bz, hw]) => {
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    return Math.hypot(ax + dx * u - x, az + dz * u - z) < hw;
  });
  const byMat = new Map<SurfaceId, number[]>();
  for (let j = 0; j < t.rows; j++) {
    for (let i = 0; i < t.cols; i++) {
      const a = j * W + i, b = a + 1, c = a + W + 1, d = a + W;
      const cx = t.x0 + (i + 0.5) * C, cz = t.z0 + (j + 0.5) * C;
      const slope = Math.max(Math.abs(H[b] - H[a]), Math.abs(H[c] - H[d]), Math.abs(H[d] - H[a]), Math.abs(H[c] - H[b])) / C;
      const hAvg = (H[a] + H[b] + H[c] + H[d]) / 4;
      const snowy = t.snowLine !== undefined && hAvg > t.snowLine + fbm(cx / 20, cz / 20, 5, 2) * 6;
      const mat: SurfaceId = snowy ? (slope > 1.4 ? 'rock' : 'snow') : slope > 0.85 ? 'rock' : onPath(cx, cz) ? pathMat : ground;
      if (!byMat.has(mat)) byMat.set(mat, []);
      // Same split as the collision: along the (i, j) → (i+1, j+1) diagonal.
      byMat.get(mat)!.push(a, c, b, a, d, c);
    }
  }
  const out: [SurfaceId, THREE.BufferGeometry][] = [];
  for (const [mat, idx] of byMat) {
    // Only the corners this material uses.
    const remap = new Map<number, number>();
    const P: number[] = [], N: number[] = [], Co: number[] = [], L: number[] = [], UV: number[] = [];
    const tile = getTileSize(mat);
    const index = idx.map((k) => {
      let r = remap.get(k);
      if (r === undefined) {
        remap.set(k, (r = remap.size));
        P.push(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
        N.push(nrm[k * 3], nrm[k * 3 + 1], nrm[k * 3 + 2]);
        Co.push(col.getX(k), col.getY(k), col.getZ(k));
        L.push(light.getX(k), light.getY(k), light.getZ(k));
        // Rock (cliffs) is mapped around the sides (x + z along, height up), other ground from above.
        if (mat === 'rock') UV.push((pos[k * 3] + pos[k * 3 + 2]) / tile, pos[k * 3 + 1] / tile);
        else UV.push(pos[k * 3] / tile, pos[k * 3 + 2] / tile);
      }
      return r;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(Co, 3));
    g.setAttribute('aLight', new THREE.Float32BufferAttribute(L, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    g.setIndex(index);
    out.push([mat, g]);
  }
  grid.dispose();
  return out;
}

/**
 * The 6 faces of a box (or a ramp, whose top corners have different heights).
 * Bottom faces resting on the ground are skipped (nobody can see them).
 */
/** Each side's material: the box's own, or a per-side override. */
function faceMaterials(b: BoxDef): Record<'top' | 'bottom' | '-x' | '+x' | '-z' | '+z', MaterialId> {
  const m = b.material ?? 'concrete';
  const f = b.faces ?? {};
  return { top: f.top ?? m, bottom: f.bottom ?? m, '-x': f['-x'] ?? m, '+x': f['+x'] ?? m, '-z': f['-z'] ?? m, '+z': f['+z'] ?? m };
}

function pushBoxQuads(
  out: Quad[], x0: number, x1: number, y0: number, _y1: number, z0: number, z1: number,
  tops: () => [number, number, number, number], mat: Record<'top' | 'bottom' | '-x' | '+x' | '-z' | '+z', MaterialId>, skipBottom: boolean,
): void {
  // Top heights at corners (x0,z0), (x0,z1), (x1,z1), (x1,z0).
  const [t00, t01, t11, t10] = tops();
  const c = {
    b00: [x0, y0, z0] as V3, b10: [x1, y0, z0] as V3, b11: [x1, y0, z1] as V3, b01: [x0, y0, z1] as V3,
    u00: [x0, t00, z0] as V3, u10: [x1, t10, z0] as V3, u11: [x1, t11, z1] as V3, u01: [x0, t01, z1] as V3,
  };
  out.push({ corners: [c.u00, c.u01, c.u11, c.u10], material: mat.top }); // top
  if (!skipBottom) out.push({ corners: [c.b00, c.b10, c.b11, c.b01], material: mat.bottom }); // bottom
  out.push({ corners: [c.b00, c.u00, c.u10, c.b10], material: mat['-z'] }); // -z
  out.push({ corners: [c.b01, c.b11, c.u11, c.u01], material: mat['+z'] }); // +z
  out.push({ corners: [c.b00, c.b01, c.u01, c.u00], material: mat['-x'] }); // -x
  out.push({ corners: [c.b10, c.u10, c.u11, c.b11], material: mat['+x'] }); // +x
}

/** Does this face look out of the arena (e.g. the back of an outer wall)? */
function facesOutside(c: [V3, V3, V3, V3], n: THREE.Vector3, foot: { x0: number; x1: number; z0: number; z1: number }): boolean {
  if (Math.abs(n.y) > 0.5) return false;
  const cx = (c[0][0] + c[2][0]) / 2 + n.x * 0.6;
  const cz = (c[0][2] + c[2][2]) / 2 + n.z * 0.6;
  return cx < foot.x0 || cx > foot.x1 || cz < foot.z0 || cz > foot.z1;
}

/** Split a face into a grid of roughly BAKE_CELL-sized tiles. */
function tessellate([a, b, c, d]: [V3, V3, V3, V3], cell = BAKE_CELL): THREE.BufferGeometry {
  const len = (p: V3, q: V3) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
  const nu = Math.min(64, Math.max(1, Math.round(Math.max(len(a, d), len(b, c)) / cell)));
  const nv = Math.min(64, Math.max(1, Math.round(Math.max(len(a, b), len(d, c)) / cell)));
  const pos: number[] = [];
  for (let i = 0; i <= nu; i++) {
    const s = i / nu;
    for (let j = 0; j <= nv; j++) {
      const t = j / nv;
      // Bilinear blend of the 4 corners (a→b along t at s=0, d→c at s=1).
      for (let k = 0; k < 3; k++) {
        const ab = a[k] + (b[k] - a[k]) * t;
        const dc = d[k] + (c[k] - d[k]) * t;
        pos.push(ab + (dc - ab) * s);
      }
    }
  }
  const idx: number[] = [];
  const at = (i: number, j: number) => i * (nv + 1) + j;
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) idx.push(at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i + 1, j));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.userData.nu = nu;
  geo.userData.nv = nv;
  // Flat face normal (from the diagonals, which also works for faces that taper to a point).
  const n = faceNormal([a, b, c, d])!;
  const normals = new Float32Array((pos.length / 3) * 3);
  for (let i = 0; i < normals.length; i += 3) normals.set([n.x, n.y, n.z], i);
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return geo;
}

/** Normal of a 4-cornered face, or null if it has no area. */
function faceNormal([a, b, c, d]: [V3, V3, V3, V3]): THREE.Vector3 | null {
  const d1 = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const d2 = new THREE.Vector3(d[0] - b[0], d[1] - b[1], d[2] - b[2]);
  const n = d1.cross(d2);
  return n.lengthSq() < 1e-8 ? null : n.normalize();
}

/** Evenly spread directions over a hemisphere around +Z (more of them near the top). */
function hemisphereDirections(n: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n); // cosine-weighted
    const a = i * golden;
    out.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, Math.sqrt(1 - r * r)));
  }
  return out;
}

const _bounce = new THREE.Color();

const falloff = (d: number, range: number) => {
  const k = 1 - (d / range) * (d / range);
  return k * k;
};

/** Where a lamp's light comes from: a little out from the wall it's mounted on. */
function lightOrigin(l: LampDef): V3 {
  const o = 0.35;
  switch (l.facing) {
    case '+x': return [l.x + o, l.y, l.z];
    case '-x': return [l.x - o, l.y, l.z];
    case '+z': return [l.x, l.y, l.z + o];
    case '-z': return [l.x, l.y, l.z - o];
    default: return [l.x, l.y - o, l.z];
  }
}

/**
 * Bake lighting into each tile corner:
 * - color = ambient occlusion (how open the spot is: corners and contact spots get darker)
 * - aLight = light from lamps (with walls blocking it)
 */
function bake(
  geo: THREE.BufferGeometry, world: CollisionWorld, dirs: THREE.Vector3[], lamps: LampDef[], lampPos: V3[],
  /** For detail models that don't match the collision boxes exactly: step out of solid areas. */
  pushOut = false,
  /** Indoor shading strength (0 = off): darken spots that are enclosed. */
  indoor = 0,
  /** Corners to leave unlit-by-rays (fully open), e.g. far scenery nobody can get close to. */
  skip?: (x: number, z: number) => boolean,
  /** Add bounced sunlight (off for big open terrain: lots of corners, little to gain). */
  bounce = true,
): void {
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const colors = new Float32Array(pos.count * 3);
  const light = new Float32Array(pos.count * 3);
  const n = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), d = new THREE.Vector3();
  const lampColors = lamps.map((l) => new THREE.Color(l.color));

  for (let i = 0; i < pos.count; i++) {
    if (skip?.(pos.getX(i), pos.getZ(i))) {
      colors.set([0.95, 0.95, 0.95], i * 3);
      continue;
    }
    n.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    let off = 0.03;
    let px = pos.getX(i) + n.x * off, py = pos.getY(i) + n.y * off, pz = pos.getZ(i) + n.z * off;
    while (pushOut && off < 0.4 && world.isInsideSolid(px, py, pz, -0.005)) {
      off += 0.08;
      px = pos.getX(i) + n.x * off;
      py = pos.getY(i) + n.y * off;
      pz = pos.getZ(i) + n.z * off;
    }

    // A corner buried inside another box (e.g. floor under a wall) is fully
    // dark; blending toward it gives a soft contact shadow at the wall base.
    if (world.isInsideSolid(px, py, pz, -0.005)) {
      colors.set([0.28, 0.28, 0.28], i * 3);
      continue;
    }

    // Ambient occlusion: shoot short rays outward and see how many hit something.
    t1.set(Math.abs(n.y) < 0.9 ? 0 : 1, Math.abs(n.y) < 0.9 ? 1 : 0, 0).cross(n).normalize();
    t2.crossVectors(n, t1);
    let occlusion = 0;
    for (const dir of dirs) {
      d.copy(t1).multiplyScalar(dir.x).addScaledVector(t2, dir.y).addScaledVector(n, dir.z);
      const hit = world.raycast(px, py, pz, d.x, d.y, d.z, AO_DISTANCE);
      if (hit) occlusion += 1 - hit.distance / AO_DISTANCE;
    }
    let ao = Math.max(0.3, 1 - (AO_STRENGTH * occlusion) / dirs.length);
    let enclosed = 1;
    // Indoors: long rays toward the sky; the more are blocked (by ceilings,
    // walls), the darker it gets. Rooms end up lit mostly by their lamps and
    // by sunlight through the windows.
    if (indoor > 0) {
      let blocked = 0;
      for (let k = 0; k < dirs.length; k += 2) {
        const dir = dirs[k];
        d.copy(t1).multiplyScalar(dir.x).addScaledVector(t2, dir.y).addScaledVector(n, dir.z);
        if (d.y < 0) d.y = -d.y * 0.3; // aim toward the sky, not the ground
        d.normalize();
        if (world.raycast(px, py, pz, d.x, d.y, d.z, INDOOR_DISTANCE)) blocked++;
      }
      // Ceilings get light bounced up from the room below, so they darken much less.
      const facingDown = n.y < -0.5;
      enclosed = 1 - indoor * (facingDown ? 0.3 : 1) * (blocked / Math.ceil(dirs.length / 2));
      ao *= enclosed;
    }
    colors.set([ao, ao, ao], i * 3);

    // Lamp light, if the lamp can "see" this spot; plus bounced sunlight.
    let r = 0, g = 0, b = 0;
    if (bounce) {
      _bounce.setRGB(0, 0, 0);
      bounceAt(world, px, py, pz, n, t1, t2, dirs, _bounce);
      r += _bounce.r;
      g += _bounce.g;
      b += _bounce.b;
    }
    lamps.forEach((l, k) => {
      const o = lampPos[k];
      const lx = o[0] - px, ly = o[1] - py, lz = o[2] - pz;
      const dist = Math.hypot(lx, ly, lz);
      if (dist >= l.range) return;
      const ndl = (n.x * lx + n.y * ly + n.z * lz) / dist;
      if (ndl <= 0 || !world.hasLineOfSight(px, py, pz, o[0], o[1], o[2])) return;
      // A little "wrap" so walls beside a ceiling lamp still catch its light.
      const a = falloff(dist, l.range) * (0.25 + 0.75 * ndl) * l.intensity * LAMP_STRENGTH;
      r += lampColors[k].r * a;
      g += lampColors[k].g * a;
      b += lampColors[k].b * a;
    });
    // Lamp and bounced light aren't dimmed by being indoors (only the sky's light is): undo that part of the shading.
    const comp = 1 / Math.max(0.25, enclosed);
    light.set([r * comp, g * comp, b * comp], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aLight', new THREE.BufferAttribute(light, 3));
}

/**
 * Lighting for a model (much quicker than `bake`, since models have lots of
 * small parts): light is measured at the 8 corners just outside the model's
 * box (shading from nearby walls and floors, enclosure, lamps), then blended
 * across the model, darker on faces turned down.
 */
function bakeModelBox(parts: ModelPart[], world: CollisionWorld, dirs: THREE.Vector3[], lamps: LampDef[], lampPos: V3[], indoor: number): void {
  const bb = new THREE.Box3();
  for (const p of parts) {
    p.geo.computeBoundingBox();
    bb.union(p.geo.boundingBox!);
  }
  const lampColors = lamps.map((l) => new THREE.Color(l.color));
  const n = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), d = new THREE.Vector3();
  const aoDirs = dirs.filter((_, i) => i % 2 === 0), skyDirs = dirs.filter((_, i) => i % 4 === 0);
  // Corner samples: [ao, r, g, b] for each corner (x0/x1, y0/y1, z0/z1).
  const corners: number[][] = [];
  for (let k = 0; k < 8; k++) {
    const sx = k & 1 ? 1 : -1, sy = k & 2 ? 1 : -1, sz = k & 4 ? 1 : -1;
    const px = sx > 0 ? bb.max.x + 0.05 : bb.min.x - 0.05;
    const py = sy > 0 ? bb.max.y + 0.05 : bb.min.y + 0.06;
    const pz = sz > 0 ? bb.max.z + 0.05 : bb.min.z - 0.05;
    n.set(sx, sy > 0 ? 1 : 0.35, sz).normalize();
    t1.set(Math.abs(n.y) < 0.9 ? 0 : 1, Math.abs(n.y) < 0.9 ? 1 : 0, 0).cross(n).normalize();
    t2.crossVectors(n, t1);
    let occ = 0;
    for (const dir of aoDirs) {
      d.copy(t1).multiplyScalar(dir.x).addScaledVector(t2, dir.y).addScaledVector(n, dir.z);
      const hit = world.raycast(px, py, pz, d.x, d.y, d.z, AO_DISTANCE * 1.4);
      if (hit) occ += 1 - hit.distance / (AO_DISTANCE * 1.4);
    }
    let ao = Math.max(0.4, 1 - (AO_STRENGTH * 0.8 * occ) / aoDirs.length);
    let enclosed = 1;
    if (indoor > 0) {
      let blocked = 0;
      for (const dir of skyDirs) {
        d.copy(t1).multiplyScalar(dir.x).addScaledVector(t2, dir.y).addScaledVector(n, dir.z);
        if (d.y < 0) d.y = -d.y * 0.3;
        d.normalize();
        if (world.raycast(px, py, pz, d.x, d.y, d.z, INDOOR_DISTANCE)) blocked++;
      }
      enclosed = 1 - indoor * (blocked / skyDirs.length);
      ao *= enclosed;
    }
    _bounce.setRGB(0, 0, 0);
    bounceAt(world, px, py, pz, n, t1, t2, dirs, _bounce);
    let r = _bounce.r, g = _bounce.g, b = _bounce.b;
    lamps.forEach((l, i) => {
      const o = lampPos[i];
      const dist = Math.hypot(o[0] - px, o[1] - py, o[2] - pz);
      if (dist >= l.range || !world.hasLineOfSight(px, py, pz, o[0], o[1], o[2])) return;
      const a = falloff(dist, l.range) * l.intensity * LAMP_STRENGTH * 0.8;
      r += lampColors[i].r * a;
      g += lampColors[i].g * a;
      b += lampColors[i].b * a;
    });
    const comp = 1 / Math.max(0.25, enclosed);
    corners.push([ao, r * comp, g * comp, b * comp]);
  }
  const size = bb.getSize(new THREE.Vector3()).max(new THREE.Vector3(1e-3, 1e-3, 1e-3));
  for (const part of parts) {
    const geo = part.geo;
    const pos = geo.getAttribute('position'), nrm = geo.getAttribute('normal');
    const colors = new Float32Array(pos.count * 3), light = new Float32Array(pos.count * 3);
    const [tr, tg, tb] = part.tint ?? [1, 1, 1];
    for (let i = 0; i < pos.count; i++) {
      const u = (pos.getX(i) - bb.min.x) / size.x, v = (pos.getY(i) - bb.min.y) / size.y, w = (pos.getZ(i) - bb.min.z) / size.z;
      const v4 = [0, 0, 0, 0];
      for (let k = 0; k < 8; k++) {
        const f = (k & 1 ? u : 1 - u) * (k & 2 ? v : 1 - v) * (k & 4 ? w : 1 - w);
        for (let c = 0; c < 4; c++) v4[c] += corners[k][c] * f;
      }
      // Faces turned down get less light; nearer the bottom a little darker still (contact shading).
      const ny = nrm.getY(i);
      const ao = v4[0] * (0.82 + 0.18 * (ny * 0.5 + 0.5)) * (0.9 + 0.1 * Math.min(1, v * 3));
      colors[i * 3] = ao * tr;
      colors[i * 3 + 1] = ao * tg;
      colors[i * 3 + 2] = ao * tb;
      const lit = 0.55 + 0.45 * Math.max(0, ny * 0.5 + 0.5);
      light[i * 3] = v4[1] * lit;
      light[i * 3 + 1] = v4[2] * lit;
      light[i * 3 + 2] = v4[3] * lit;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aLight', new THREE.BufferAttribute(light, 3));
  }
}

/** The visible lamp fixtures: a dark housing with a glowing panel. */
function buildLampFixtures(lamps: LampDef[]): THREE.Group {
  const housings: THREE.BufferGeometry[] = [];
  const panels: THREE.BufferGeometry[] = [];
  const panelColors: number[] = [];
  for (const l of lamps) {
    const wall = l.facing === 'down';
    const along = l.facing === '+x' || l.facing === '-x';
    // Housing: flat box against the wall (or ceiling).
    const hw = wall ? 0.7 : along ? 0.14 : 0.6;
    const hh = wall ? 0.1 : 0.3;
    const hd = wall ? 0.7 : along ? 0.6 : 0.14;
    const h = new THREE.BoxGeometry(hw, hh, hd).toNonIndexed();
    h.translate(l.x, l.y, l.z);
    housings.push(h);
    // Panel: slightly in front of the housing, glowing.
    const p = new THREE.BoxGeometry(hw * 0.8 + (along ? 0.02 : 0), hh * 0.6, hd * 0.8 + (along ? 0 : 0.02)).toNonIndexed();
    const off = 0.06;
    const dx = l.facing === '+x' ? off : l.facing === '-x' ? -off : 0;
    const dz = l.facing === '+z' ? off : l.facing === '-z' ? -off : 0;
    p.translate(l.x + dx, l.y - (wall ? 0.04 : 0), l.z + dz);
    const c = new THREE.Color(l.color).multiplyScalar(2.5 + l.intensity);
    const count = p.getAttribute('position').count;
    for (let i = 0; i < count; i++) panelColors.push(c.r, c.g, c.b);
    panels.push(p);
  }
  const g = new THREE.Group();
  g.name = 'lamps';
  // A soft glow around each lamp (always facing you; brighter for stronger lamps).
  const glowPos: number[] = [], glowCol: number[] = [];
  for (const l of lamps) {
    const o = lightOrigin(l);
    glowPos.push(o[0], o[1] + (l.facing === 'down' ? 0.25 : 0), o[2]);
    const c = new THREE.Color(l.color).multiplyScalar(0.28 + 0.12 * l.intensity);
    glowCol.push(c.r, c.g, c.b);
  }
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(glowPos, 3));
  glowGeo.setAttribute('color', new THREE.Float32BufferAttribute(glowCol, 3));
  const glow = new THREE.Points(glowGeo, new THREE.PointsMaterial({ size: 2.2, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  glow.renderOrder = 12;
  glow.frustumCulled = false;
  g.add(glow);
  const housing = new THREE.Mesh(mergeGeometries(housings), new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.6, metalness: 0.4 }));
  const panelGeo = mergeGeometries(panels);
  panelGeo.setAttribute('color', new THREE.Float32BufferAttribute(panelColors, 3));
  // Bright (over 1.0) colors: on High graphics these glow (bloom).
  const panel = new THREE.Mesh(panelGeo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }));
  g.add(housing, panel);
  return g;
}

let glowTex: THREE.Texture | null = null;
/** A round soft glow (bright middle fading to nothing). */
function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

/**
 * Sky light + the sun. Shadows cover the whole map if it's small; on bigger
 * maps they cover a square around the viewer that moves along (in whole
 * shadow-map pixels, so edges don't shimmer), which keeps them sharp.
 * Returns the function that moves them.
 */
function addSunAndSky(group: THREE.Group, bounds: THREE.Box3, shadowMapSize: number, sky: SkyDef, sunDir: THREE.Vector3): (p: THREE.Vector3) => void {
  // Light from the whole sky: tinted like the sky above, and like the ground below.
  const skyTint = new THREE.Color(sky.zenith).lerp(new THREE.Color(0xffffff), 0.55);
  const groundTint = new THREE.Color(sky.ground ?? 0x4a4036).lerp(new THREE.Color(sky.sunColor), 0.2);
  group.add(new THREE.HemisphereLight(skyTint, groundTint, sky.skyLight ?? 1.0));

  // The sun: from where it is in the sky.
  const sun = new THREE.DirectionalLight(sky.sunColor, sky.sunIntensity ?? 2.4);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const mapRadius = Math.max(size.x, size.z) * 0.62;
  const FOLLOW = 48;
  const follow = mapRadius > FOLLOW * 1.15;
  const radius = follow ? FOLLOW : mapRadius;
  const height = Math.max(size.y, 30);
  const place = (c: THREE.Vector3) => {
    sun.position.copy(c).addScaledVector(sunDir, radius * 2 + height);
    sun.target.position.copy(c);
    sun.target.updateMatrixWorld();
  };
  place(center);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  const cam = sun.shadow.camera;
  cam.left = -radius; cam.right = radius; cam.top = radius; cam.bottom = -radius;
  cam.near = 1; cam.far = radius * 4 + height * 2;
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 3;
  group.add(sun, sun.target);
  if (!follow) return () => {};
  // Snap to whole shadow-map pixels (in the light's own view) so shadow edges stay still as you move.
  const texel = (radius * 2) / shadowMapSize;
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), sunDir).normalize();
  const up = new THREE.Vector3().crossVectors(sunDir, right).normalize();
  const c = new THREE.Vector3();
  return (p: THREE.Vector3) => {
    const a = Math.round(p.dot(right) / texel) * texel, b = Math.round(p.dot(up) / texel) * texel, d = p.dot(sunDir);
    c.copy(right).multiplyScalar(a).addScaledVector(up, b).addScaledVector(sunDir, d);
    place(c);
  };
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
