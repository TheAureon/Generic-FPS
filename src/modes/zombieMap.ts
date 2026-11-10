import * as THREE from 'three';
import type { NavGraph, NavNode } from '../bots/NavGraph';
import type { CollisionWorld } from '../core/CollisionWorld';

/**
 * Zombies: works out where doors and barricades go on any map, from the
 * walls themselves (no map editing needed).
 *
 * - Doorways are narrow gaps between two walls (a passage less than ~2.6 m
 *   wide with open ground on both sides). Doors go in the doorways that
 *   close off part of the map from where you start, so opening one opens
 *   up a new area. Maps without such doorways (open outdoor maps) get none.
 * - Barricades are boarded-up frames on walls, where zombies climb in.
 */

export interface DoorSpot {
  center: THREE.Vector3;
  /** Which way the gap runs across: the door spans `width` along this axis. */
  across: 'x' | 'z';
  width: number;
  height: number;
  /** Nav nodes the door blocks while it's closed. */
  nodes: number[];
}

export interface BarricadeSpot {
  /** Where the zombie appears (a step out from the wall). */
  pos: THREE.Vector3;
  /** On the wall, and which way the frame faces (away from the wall). */
  wall: THREE.Vector3;
  facing: THREE.Vector3;
}

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Distance to the nearest wall in each of the four directions (at waist height). */
function reach(world: CollisionWorld, n: NavNode, max: number): number[] {
  return DIRS.map(([dx, dz]) => world.raycast(n.x, n.y + 1.0, n.z, dx, 0, dz, max)?.distance ?? max);
}

/** Narrow gaps between two walls, merged into one spot per doorway. */
function findDoorways(world: CollisionWorld, nav: NavGraph): DoorSpot[] {
  const hits: { n: NavNode; across: 'x' | 'z'; width: number; mid: number }[] = [];
  for (const n of nav.nodes) {
    if (!n.nearWall) continue;
    const [e, w, s, nn] = reach(world, n, 6);
    // Walls close on both sides along X, open both ways along Z (or the other way round).
    if (e + w < 2.6 && s > 2.5 && nn > 2.5) hits.push({ n, across: 'x', width: e + w, mid: n.x + (e - w) / 2 });
    else if (s + nn < 2.6 && e > 2.5 && w > 2.5) hits.push({ n, across: 'z', width: s + nn, mid: n.z + (s - nn) / 2 });
  }
  // Merge hits that belong to the same doorway.
  const spots: DoorSpot[] = [];
  const used = new Set<number>();
  for (const h of hits) {
    if (used.has(h.n.id)) continue;
    const group = hits.filter((o) => !used.has(o.n.id) && o.across === h.across && Math.abs(o.n.y - h.n.y) < 0.6 && Math.hypot(o.n.x - h.n.x, o.n.z - h.n.z) < 2.6);
    for (const o of group) used.add(o.n.id);
    const c = new THREE.Vector3();
    for (const o of group) c.add(new THREE.Vector3(o.n.x, o.n.y, o.n.z));
    c.divideScalar(group.length);
    // Center across the gap exactly between the two walls.
    const mid = group.reduce((a, o) => a + o.mid, 0) / group.length;
    if (h.across === 'x') c.x = mid;
    else c.z = mid;
    const width = Math.max(...group.map((o) => o.width));
    const ceiling = world.ceilingHeight(c.x, c.z, 0.1, c.y + 0.5);
    const height = Math.min(Number.isFinite(ceiling) ? ceiling - c.y : 3, 3);
    if (height < 1.9) continue;
    // The nodes in the doorway (a door blocks these).
    const nodes = nav.nodesWithin(c, 1.6).filter((m) => Math.abs(m.y - c.y) < 0.8 && (h.across === 'x' ? Math.abs(m.z - c.z) < 1.0 : Math.abs(m.x - c.x) < 1.0)).map((m) => m.id);
    if (nodes.length) spots.push({ center: c, across: h.across, width, height, nodes });
  }
  return spots;
}

/** Nodes you can walk to from `start` without stepping on any blocked node. */
function reachable(nav: NavGraph, start: number, blocked: Set<number>): Set<number> {
  const seen = new Set<number>([start]);
  const queue = [start];
  while (queue.length) {
    const id = queue.pop()!;
    for (const e of nav.nodes[id].edges) {
      if (seen.has(e.to) || blocked.has(e.to)) continue;
      seen.add(e.to);
      queue.push(e.to);
    }
  }
  return seen;
}

/**
 * Pick up to `max` doors that each close off a decent chunk of the map from
 * the start (alone, or two doorways together when an area has two ways in).
 */
export function planDoors(world: CollisionWorld, nav: NavGraph, start: THREE.Vector3, max = 3): DoorSpot[] {
  const startNode = nav.nearestNode(start);
  if (!startNode) return [];
  // The doorways nearest the start are the ones worth checking (keeps this quick on big maps).
  const all = findDoorways(world, nav)
    .filter((d) => d.center.distanceTo(start) > 6)
    .sort((a, b) => a.center.distanceTo(start) - b.center.distanceTo(start))
    .slice(0, 24);
  const total = nav.nodes.length;
  const blockedBy = (doors: DoorSpot[]) => new Set(doors.flatMap((d) => d.nodes));
  const full = reachable(nav, startNode.id, new Set()).size;
  // Every single doorway, and every pair (an area with two ways in), that
  // closes off at least a room's worth of the map while leaving you at least
  // a third of it to start in. Biggest areas first.
  const options: { doors: DoorSpot[]; cut: number }[] = [];
  const tryDoors = (doors: DoorSpot[]) => {
    const r = reachable(nav, startNode.id, blockedBy(doors)).size;
    if (full - r >= 20 && r >= total * 0.3) options.push({ doors, cut: full - r });
  };
  for (const d of all) tryDoors([d]);
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    // A pair only counts if neither door does the job alone.
    if (options.some((o) => o.doors.length === 1 && (o.doors[0] === all[i] || o.doors[0] === all[j]))) continue;
    tryDoors([all[i], all[j]]);
  }
  options.sort((a, b) => b.cut - a.cut);
  // Take the best ones that still work together.
  const chosen: DoorSpot[] = [];
  let reach0 = full;
  for (const o of options) {
    if (chosen.length + o.doors.length > max || o.doors.some((d) => chosen.includes(d))) continue;
    const r = reachable(nav, startNode.id, blockedBy([...chosen, ...o.doors])).size;
    if (reach0 - r >= 20 && r >= total * 0.3) {
      chosen.push(...o.doors);
      reach0 = r;
    }
  }
  return chosen;
}

/** Which nodes are open to play when only these doors are closed. */
export function openArea(nav: NavGraph, start: THREE.Vector3, closed: DoorSpot[]): Set<number> {
  const s = nav.nearestNode(start);
  return s ? reachable(nav, s.id, new Set(closed.flatMap((d) => d.nodes))) : new Set();
}

/** Barricade spots on walls, spread out, inside the given area. */
export function planBarricades(world: CollisionWorld, nav: NavGraph, area: Set<number>, avoid: THREE.Vector3[], count: number): BarricadeSpot[] {
  const pool = nav.nodes.filter((n) => n.nearWall && area.has(n.id) && avoid.every((a) => Math.hypot(a.x - n.x, a.z - n.z) > 10));
  const out: BarricadeSpot[] = [];
  for (let tries = 0; tries < count * 40 && out.length < count && pool.length; tries++) {
    const n = pool[Math.floor(Math.random() * pool.length)];
    const p = new THREE.Vector3(n.x, n.y, n.z);
    if (out.some((b) => b.pos.distanceTo(p) < 12)) continue;
    // The nearest wall, and only a flat one (a frame needs a wall behind it).
    const d = reach(world, n, 2.5);
    let k = 0;
    d.forEach((v, i) => { if (v < d[k]) k = i; });
    if (d[k] >= 2.5) continue;
    const [dx, dz] = DIRS[k];
    const wall = new THREE.Vector3(n.x + dx * d[k], n.y, n.z + dz * d[k]);
    const facing = new THREE.Vector3(-dx, 0, -dz);
    out.push({ pos: wall.clone().addScaledVector(facing, 0.8), wall, facing });
  }
  return out;
}
