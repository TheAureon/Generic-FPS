import * as THREE from 'three';
import { BREAKABLES, type DamageSource } from '../config';
import { audio } from '../audio/AudioEngine';
import { getMaterial } from '../assets/materials';
import type { AABB, CollisionWorld } from '../core/CollisionWorld';
import { CharacterHitbox, type Damageable, type DamageInfo } from '../core/Hitbox';
import type { NavGraph } from '../bots/NavGraph';
import type { BoxDef, MapDef } from '../map/MapTypes';

/**
 * Things in the map you can break:
 * - Glass panes (windows, glass walls and railings) shatter when shot, hit by
 *   a blast, or slashed, and are gone for the rest of the match.
 * - Red explosive barrels, placed along walls, blow up when they take enough
 *   damage (a few bullets, a grenade, the katana, or another barrel going
 *   off nearby). The blast hurts everyone close by and is credited to whoever
 *   set it off. A barrel comes back a while later.
 */

export interface Pane {
  def: BoxDef;
  box: AABB;
}

type LivePane = Pane & { broken: boolean; index: number };

interface Shard {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  life: number;
  floor: number;
}

export interface BreakablesDeps {
  scene: THREE.Scene;
  world: CollisionWorld;
  map: MapDef;
  panes: Pane[];
  nav: NavGraph;
  quality: 'standard' | 'lambert';
  /** Set off an explosion (barrels): damages everyone (and other barrels) nearby. */
  explode: (at: THREE.Vector3, radius: number, damage: number, attacker: string, weapon: DamageSource) => void;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** A red explosive barrel: shootable like a person (same kind of hit shape). */
export class Barrel implements Damageable {
  readonly isProp = true;
  readonly hitbox = new CharacterHitbox(BREAKABLES.barrel.height, BREAKABLES.barrel.radius, 0.05);
  readonly position: THREE.Vector3;
  readonly mesh: THREE.Group;
  health: number = BREAKABLES.barrel.health;
  /** Seconds until it blows (once it's been set off), or -1. */
  fuse = -1;
  /** Seconds until it comes back (after blowing up), or -1. */
  respawn = -1;
  lastAttacker = '';
  box: AABB | null = null;

  constructor(
    readonly name: string,
    position: THREE.Vector3,
    readonly navNode: number,
    mesh: THREE.Group,
  ) {
    this.position = position.clone();
    this.hitbox.setPosition(this.position);
    this.mesh = mesh;
  }

  isAlive(): boolean {
    return this.respawn < 0;
  }

  takeDamage(info: DamageInfo): boolean {
    if (!this.isAlive()) return false;
    this.health -= info.amount;
    if (info.attacker) this.lastAttacker = info.attacker;
    // Set off: it goes up a moment later (so chains of barrels ripple).
    if (this.health <= 0 && this.fuse < 0) this.fuse = info.weapon === 'barrel' || info.weapon === 'grenade' ? BREAKABLES.barrel.chainDelay : 0.05;
    return false;
  }
}

export class Breakables {
  readonly barrels: Barrel[] = [];
  private panes: LivePane[] = [];
  private paneMesh: THREE.InstancedMesh | null = null;
  private shards: Shard[] = [];
  private shardMesh: THREE.InstancedMesh;
  private nextShard = 0;
  private group = new THREE.Group();

  constructor(private d: BreakablesDeps) {
    d.scene.add(this.group);

    // ---- Glass: one instanced mesh, a box per pane (hidden when it breaks).
    if (d.panes.length) {
      const mat = getMaterial('glass', d.quality);
      this.paneMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, d.panes.length);
      this.paneMesh.renderOrder = 10;
      d.panes.forEach((p, i) => {
        const b = p.def;
        this.paneMesh!.setMatrixAt(i, _m.compose(_p.set(b.x, b.y + b.h / 2, b.z), _q.identity(), _s.set(b.w, b.h, b.d)));
        this.panes.push({ ...p, broken: false, index: i });
      });
      this.paneMesh.instanceMatrix.needsUpdate = true;
      this.paneMesh.computeBoundingSphere();
      this.group.add(this.paneMesh);
    }

    // Flying shards of glass.
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-0.04, -0.03, 0, 0.05, -0.02, 0, -0.01, 0.06, 0], 3));
    tri.computeVertexNormals();
    this.shardMesh = new THREE.InstancedMesh(
      tri,
      new THREE.MeshStandardMaterial({ color: 0xcfe6f0, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
      BREAKABLES.glass.maxShards,
    );
    for (let i = 0; i < BREAKABLES.glass.maxShards; i++) this.shardMesh.setMatrixAt(i, ZERO);
    this.shardMesh.frustumCulled = false;
    this.group.add(this.shardMesh);

    this.placeBarrels();
  }

  /** Barrels along walls, spread out and away from spawns and pickups (the same spots every match on a map). */
  private placeBarrels(): void {
    const { map, nav, world } = this.d;
    let seed = 0;
    for (const ch of map.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const spots = [...map.playerSpawns, ...map.botSpawns];
    const pickups = map.pickups ?? [];
    const cand = nav.nodes.filter((n) => n.nearWall);
    // Shuffle (seeded).
    for (let i = cand.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [cand[i], cand[j]] = [cand[j], cand[i]];
    }
    const B = BREAKABLES.barrel;
    const want = Math.min(B.maxPerMap, Math.round(nav.nodes.length / B.nodesPerBarrel));
    for (const n of cand) {
      if (this.barrels.length >= want) break;
      const far = (x: number, z: number, r: number) => Math.hypot(n.x - x, n.z - z) >= r;
      if (!spots.every((s) => far(s.x, s.z, B.minFromSpawn))) continue;
      if (!pickups.every((p) => far(p.x, p.z, 3))) continue;
      if (!this.barrels.every((b) => far(b.position.x, b.position.z, B.minApart))) continue;
      // Nudge it right up against the wall it's next to.
      const pos = new THREE.Vector3(n.x, n.y, n.z);
      let best = Infinity, dx = 0, dz = 0;
      for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const hit = world.raycast(n.x, n.y + 0.5, n.z, ax, 0, az, 1.5);
        if (hit && hit.distance < best) [best, dx, dz] = [hit.distance, ax, az];
      }
      if (best === Infinity) continue;
      pos.x += dx * Math.max(0, best - B.radius - 0.05);
      pos.z += dz * Math.max(0, best - B.radius - 0.05);
      // Standing on solid ground, with room for it.
      const ground = world.groundHeight(pos.x, pos.z, B.radius, n.y + 0.3);
      if (Math.abs(ground - n.y) > 0.1) continue;
      if (world.ceilingHeight(pos.x, pos.z, B.radius, n.y + 0.05) < n.y + B.height + 0.1) continue;
      pos.y = ground;
      const barrel = new Barrel(`Barrel ${this.barrels.length + 1}`, pos, n.id, makeBarrel());
      barrel.mesh.position.copy(pos);
      barrel.mesh.rotation.y = rand() * Math.PI * 2;
      this.group.add(barrel.mesh);
      this.barrels.push(barrel);
      this.standUp(barrel);
    }
  }

  private standUp(b: Barrel): void {
    const B = BREAKABLES.barrel;
    b.health = B.health;
    b.fuse = -1;
    b.respawn = -1;
    b.mesh.visible = true;
    b.box = this.d.world.addBox({ x: b.position.x, y: b.position.y, z: b.position.z, w: B.radius * 2, h: B.height, d: B.radius * 2 });
    // Bots path around it.
    this.d.nav.blocked.add(b.navNode);
  }

  /** A bullet went from `origin` along `dir` for `dist` meters: break any glass on the way. */
  shot(origin: THREE.Vector3, dir: THREE.Vector3, dist: number): void {
    for (const p of this.panes) {
      if (p.broken) continue;
      const t = rayBox(origin, dir, p.box);
      if (t !== null && t <= dist) this.breakPane(p, _p.copy(origin).addScaledVector(dir, t), dir);
    }
  }

  /** A blast at `at`: shatters glass within `radius`. */
  blast(at: THREE.Vector3, radius: number): void {
    for (const p of this.panes) {
      if (p.broken) continue;
      const b = p.box;
      const cx = Math.max(b.minX, Math.min(at.x, b.maxX));
      const cy = Math.max(b.minY, Math.min(at.y, b.maxY));
      const cz = Math.max(b.minZ, Math.min(at.z, b.maxZ));
      if (Math.hypot(cx - at.x, cy - at.y, cz - at.z) < radius) this.breakPane(p, _p.set(cx, cy, cz), null, at);
    }
  }

  private breakPane(p: LivePane, at: THREE.Vector3, dir: THREE.Vector3 | null, blastFrom?: THREE.Vector3): void {
    p.broken = true;
    this.d.world.removeBox(p.box);
    this.paneMesh!.setMatrixAt(p.index, ZERO);
    this.paneMesh!.instanceMatrix.needsUpdate = true;
    audio.play('glass_break', { position: at });
    // Shards: spread over the pane, flying away from the hit (or the blast).
    const b = p.box;
    const area = (b.maxX - b.minX + b.maxZ - b.minZ) * (b.maxY - b.minY);
    const n = Math.min(BREAKABLES.glass.shardsPerPane, Math.round(8 + area * 6));
    for (let i = 0; i < n; i++) {
      const s = this.allocShard();
      s.pos.set(b.minX + Math.random() * (b.maxX - b.minX), b.minY + Math.random() * (b.maxY - b.minY), b.minZ + Math.random() * (b.maxZ - b.minZ));
      if (dir) s.vel.copy(dir).multiplyScalar(1.5 + Math.random() * 2.5);
      else if (blastFrom) s.vel.copy(s.pos).sub(blastFrom).normalize().multiplyScalar(3 + Math.random() * 4);
      else s.vel.set(0, 0, 0);
      s.vel.x += (Math.random() - 0.5) * 1.5;
      s.vel.y += Math.random() * 1.5;
      s.vel.z += (Math.random() - 0.5) * 1.5;
      s.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      s.spin.set((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20);
      s.life = 1.2 + Math.random() * 0.8;
      s.floor = this.d.world.groundHeight(s.pos.x, s.pos.z, 0.01, s.pos.y) + 0.01;
    }
  }

  private allocShard(): Shard {
    let s = this.shards[this.nextShard];
    if (!s) {
      s = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), life: 0, floor: 0 };
      this.shards[this.nextShard] = s;
    }
    this.nextShard = (this.nextShard + 1) % BREAKABLES.glass.maxShards;
    return s;
  }

  update(dt: number): void {
    // Barrels: count down fuses, blow up, and come back later.
    for (const b of this.barrels) {
      if (b.respawn >= 0) {
        b.respawn -= dt;
        if (b.respawn <= 0) this.standUp(b);
        continue;
      }
      if (b.fuse < 0) continue;
      b.fuse -= dt;
      if (b.fuse > 0) continue;
      this.blowUp(b);
    }

    // Shards.
    let any = false;
    for (let i = 0; i < this.shards.length; i++) {
      const s = this.shards[i];
      if (s.life <= 0) continue;
      any = true;
      s.life -= dt;
      if (s.pos.y > s.floor) {
        s.vel.y -= 14 * dt;
        s.pos.addScaledVector(s.vel, dt);
        s.rot.x += s.spin.x * dt;
        s.rot.y += s.spin.y * dt;
        s.rot.z += s.spin.z * dt;
        if (s.pos.y <= s.floor) {
          // Lies flat on the floor.
          s.pos.y = s.floor;
          s.rot.set(-Math.PI / 2, 0, s.rot.z);
        }
      }
      if (s.life <= 0) this.shardMesh.setMatrixAt(i, ZERO);
      else this.shardMesh.setMatrixAt(i, _m.compose(s.pos, _q.setFromEuler(s.rot), _s.setScalar(Math.min(1, s.life * 2))));
    }
    if (any) this.shardMesh.instanceMatrix.needsUpdate = true;
  }

  private blowUp(b: Barrel): void {
    const B = BREAKABLES.barrel;
    b.fuse = -1;
    b.respawn = B.respawnTime;
    b.mesh.visible = false;
    if (b.box) this.d.world.removeBox(b.box);
    b.box = null;
    this.d.nav.blocked.delete(b.navNode);
    const at = b.position.clone().setY(b.position.y + B.height * 0.5);
    this.d.explode(at, B.blastRadius, B.blastDamage, b.lastAttacker || b.name, 'barrel');
  }

  dispose(): void {
    this.group.removeFromParent();
    this.shardMesh.geometry.dispose();
    (this.shardMesh.material as THREE.Material).dispose();
    this.paneMesh?.geometry.dispose();
    for (const b of this.barrels) b.mesh.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
  }
}

/** Distance along a ray to a box, or null if it misses. */
function rayBox(o: THREE.Vector3, d: THREE.Vector3, b: AABB): number | null {
  let t0 = 0, t1 = Infinity;
  for (const [oo, dd, lo, hi] of [[o.x, d.x, b.minX, b.maxX], [o.y, d.y, b.minY, b.maxY], [o.z, d.z, b.minZ, b.maxZ]]) {
    if (Math.abs(dd) < 1e-9) {
      if (oo < lo || oo > hi) return null;
      continue;
    }
    let a = (lo - oo) / dd, c = (hi - oo) / dd;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
    if (t0 > t1) return null;
  }
  return t0;
}

/** A red oil drum with a yellow hazard band, ribs and a lid. Feet at the origin. */
function makeBarrel(): THREE.Group {
  const B = BREAKABLES.barrel;
  const g = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: 0xb02a1e, roughness: 0.55, metalness: 0.4 });
  const band = new THREE.MeshStandardMaterial({ color: 0xe0b020, roughness: 0.6, metalness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a1410, roughness: 0.6, metalness: 0.5 });
  const r = B.radius, h = B.height;
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  add(new THREE.CylinderGeometry(r, r, h, 20), red, h / 2);
  add(new THREE.CylinderGeometry(r * 1.005, r * 1.005, h * 0.16, 20), band, h * 0.55);
  for (const y of [h * 0.3, h * 0.78]) add(new THREE.TorusGeometry(r, 0.012, 6, 24).rotateX(Math.PI / 2), red, y);
  add(new THREE.CylinderGeometry(r * 0.96, r * 0.96, 0.01, 20), dark, h + 0.004);
  add(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 10), band, h + 0.012).position.x = r * 0.55;
  return g;
}
