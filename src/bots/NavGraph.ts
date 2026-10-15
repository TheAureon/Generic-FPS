import * as THREE from 'three';
import type { CollisionWorld } from '../core/CollisionWorld';

/**
 * Navigation graph ("waypoint graph") built automatically from the map.
 *
 * The map is sampled on a grid. Every spot where a bot can stand becomes a
 * node (several per spot if there are multiple levels, like a floor under a
 * roof). Neighboring nodes are linked if a bot can walk directly between
 * them, which includes walking up ramps and steps. Ledges get one-way links
 * so bots can drop down. Bots find routes with A* over these links, so they
 * walk around walls instead of into them.
 */

export interface NavNode {
  id: number;
  x: number;
  y: number;
  z: number;
  edges: { to: number; cost: number }[];
  /** Right next to a solid obstacle (good spots to take cover). */
  nearWall: boolean;
}

export interface NavOptions {
  /** Distance between grid samples (meters). */
  spacing: number;
  /** Bot radius plus a little margin, so paths keep clear of walls. */
  radius: number;
  height: number;
  stepHeight: number;
  /** Highest ledge bots will drop down from. */
  maxDrop: number;
}

const DEFAULTS: NavOptions = { spacing: 1.25, radius: 0.36, height: 1.8, stepHeight: 0.45, maxDrop: 3.2 };

export class NavGraph {
  nodes: NavNode[] = [];
  readonly opts: NavOptions;
  private cells = new Map<number, number[]>();
  private originX = 0;
  private originZ = 0;

  constructor(
    private world: CollisionWorld,
    opts: Partial<NavOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  /**
   * Builds the graph over `bounds`. Only nodes connected to the `seeds`
   * (spawn points) are kept, so unreachable spots (tops of walls, inside
   * crates) are thrown away.
   */
  static build(world: CollisionWorld, bounds: THREE.Box3, seeds: THREE.Vector3[], opts: Partial<NavOptions> = {}): NavGraph {
    const g = new NavGraph(world, opts);
    g.generate(bounds, seeds);
    return g;
  }

  private cellKey(ix: number, iz: number): number {
    return (ix + 1024) * 2048 + (iz + 1024);
  }
  private cellOf(x: number, z: number): [number, number] {
    const s = this.opts.spacing;
    return [Math.round((x - this.originX) / s), Math.round((z - this.originZ) / s)];
  }

  private generate(bounds: THREE.Box3, seeds: THREE.Vector3[]): void {
    const { spacing, radius, height, stepHeight } = this.opts;
    const w = this.world;
    this.originX = bounds.min.x;
    this.originZ = bounds.min.z;
    const nx = Math.ceil((bounds.max.x - bounds.min.x) / spacing);
    const nz = Math.ceil((bounds.max.z - bounds.min.z) / spacing);
    let nodes: NavNode[] = [];
    const cellNodes = new Map<number, number[]>();

    // 1) Find standable spots, on every level.
    for (let ix = 0; ix <= nx; ix++) {
      for (let iz = 0; iz <= nz; iz++) {
        const x = this.originX + ix * spacing;
        const z = this.originZ + iz * spacing;
        let maxY = bounds.max.y + 1;
        for (let level = 0; level < 6; level++) {
          const y = w.groundHeight(x, z, radius, maxY);
          if (!Number.isFinite(y)) break;
          const free = !w.findBlocker({ x, z, feet: y, height, radius }, stepHeight);
          const headroom = w.ceilingHeight(x, z, radius, y + stepHeight) - y >= height;
          if (free && headroom) {
            const id = nodes.length;
            nodes.push({ id, x, y, z, edges: [], nearWall: false });
            const k = this.cellKey(ix, iz);
            if (!cellNodes.has(k)) cellNodes.set(k, []);
            cellNodes.get(k)!.push(id);
          }
          // Look for the next level down (must be at least a body height lower).
          maxY = y - 1.0;
        }
      }
    }

    // 2) Link neighbors (8 directions) that a bot can walk or drop between.
    for (let ix = 0; ix <= nx; ix++) {
      for (let iz = 0; iz <= nz; iz++) {
        for (const a of cellNodes.get(this.cellKey(ix, iz)) ?? []) {
          for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
              if (dx === 0 && dz === 0) continue;
              for (const b of cellNodes.get(this.cellKey(ix + dx, iz + dz)) ?? []) {
                const A = nodes[a], B = nodes[b];
                const flat = Math.hypot(B.x - A.x, B.z - A.z);
                if (this.canWalk(A.x, A.y, A.z, B.x, B.y, B.z)) {
                  A.edges.push({ to: b, cost: Math.hypot(flat, B.y - A.y) });
                } else if (this.canDrop(A, B)) {
                  A.edges.push({ to: b, cost: flat + 1 });
                }
              }
            }
          }
        }
      }
    }

    // 3) Keep only nodes reachable from a spawn AND able to get back to one.
    const seedIds = new Set<number>();
    for (const s of seeds) {
      let best = -1, bestD = Infinity;
      for (const n of nodes) {
        const d = Math.hypot(n.x - s.x, n.z - s.z) + Math.abs(n.y - s.y) * 2;
        if (d < bestD) { bestD = d; best = n.id; }
      }
      if (best >= 0) seedIds.add(best);
    }
    const forward = bfs(nodes, [...seedIds], (n) => n.edges.map((e) => e.to));
    const reverseAdj: number[][] = nodes.map(() => []);
    for (const n of nodes) for (const e of n.edges) reverseAdj[e.to].push(n.id);
    const backward = bfs(nodes, [...seedIds], (n) => reverseAdj[n.id]);
    const remap = new Map<number, number>();
    const kept: NavNode[] = [];
    for (const n of nodes) {
      if (forward.has(n.id) && backward.has(n.id)) {
        remap.set(n.id, kept.length);
        kept.push(n);
      }
    }
    for (const n of kept) {
      n.edges = n.edges.filter((e) => remap.has(e.to)).map((e) => ({ to: remap.get(e.to)!, cost: e.cost }));
      n.id = remap.get(n.id)!;
    }
    nodes = kept;

    // 4) Index by grid cell for fast lookups; mark spots next to walls.
    this.nodes = nodes;
    for (const n of nodes) {
      const [cx, cz] = this.cellOf(n.x, n.z);
      const k = this.cellKey(cx, cz);
      if (!this.cells.has(k)) this.cells.set(k, []);
      this.cells.get(k)!.push(n.id);
      n.nearWall = !!w.findBlocker({ x: n.x, z: n.z, feet: n.y + 0.5, height: 1.2, radius: radius + 0.7 }, 0);
    }
  }

  /** Can a bot walk in a straight line from A to B (no walls, no gaps, no big steps)? */
  canWalk(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const { radius, height, stepHeight } = this.opts;
    const dist = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(dist / 0.3));
    let y = ay;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
      const g = this.world.groundHeight(px, pz, radius, y + stepHeight);
      if (!Number.isFinite(g) || g < y - stepHeight) return false; // a gap or a ledge
      if (this.world.findBlocker({ x: px, z: pz, feet: g, height, radius }, stepHeight)) return false;
      y = g;
    }
    return Math.abs(y - by) <= stepHeight;
  }

  /** Can a bot walk off a ledge at A and land at B (lower)? */
  private canDrop(a: NavNode, b: NavNode): boolean {
    const { radius, height, stepHeight, maxDrop } = this.opts;
    const drop = a.y - b.y;
    if (drop <= stepHeight || drop > maxDrop) return false;
    // Nothing in the way at the upper level...
    const steps = 4;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const px = a.x + (b.x - a.x) * t, pz = a.z + (b.z - a.z) * t;
      if (this.world.findBlocker({ x: px, z: pz, feet: a.y, height, radius }, stepHeight)) return false;
    }
    // ...and a clear fall down to B.
    return !this.world.findBlocker({ x: b.x, z: b.z, feet: b.y, height: drop + height, radius }, stepHeight);
  }

  /** Nodes within `r` meters (flat distance) of a point. */
  nodesWithin(p: THREE.Vector3, r: number): NavNode[] {
    const out: NavNode[] = [];
    const [cx, cz] = this.cellOf(p.x, p.z);
    const cr = Math.ceil(r / this.opts.spacing);
    for (let ix = cx - cr; ix <= cx + cr; ix++) {
      for (let iz = cz - cr; iz <= cz + cr; iz++) {
        for (const id of this.cells.get(this.cellKey(ix, iz)) ?? []) {
          const n = this.nodes[id];
          if (Math.hypot(n.x - p.x, n.z - p.z) <= r) out.push(n);
        }
      }
    }
    return out;
  }

  /** The closest node a bot at `p` can walk straight to (falls back to just the closest). */
  nearestNode(p: THREE.Vector3): NavNode | null {
    let candidates = this.nodesWithin(p, 3);
    if (candidates.length === 0) candidates = this.nodes;
    const score = (n: NavNode) => Math.hypot(n.x - p.x, n.z - p.z) + Math.abs(n.y - p.y) * 2;
    candidates = [...candidates].sort((a, b) => score(a) - score(b));
    for (const n of candidates.slice(0, 6)) {
      if (Math.abs(n.y - p.y) < 1 && this.canWalk(p.x, p.y, p.z, n.x, n.y, n.z)) return n;
    }
    return candidates[0] ?? null;
  }

  randomNode(): NavNode {
    return this.nodes[Math.floor(Math.random() * this.nodes.length)];
  }

  /**
   * A* search. Returns a list of points from `from` to `to` (smoothed so the
   * bot walks straight where it can), or null if there's no route.
   */
  findPath(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] | null {
    const start = this.nearestNode(from);
    const goal = this.nearestNode(to);
    if (!start || !goal) return null;

    const N = this.nodes.length;
    const g = new Float64Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const open = new MinHeap();
    const h = (n: NavNode) => Math.hypot(n.x - goal.x, n.y - goal.y, n.z - goal.z);
    g[start.id] = 0;
    open.push(start.id, h(start));
    let found = false;
    while (open.size > 0) {
      const cur = open.pop();
      if (cur === goal.id) { found = true; break; }
      if (closed[cur]) continue;
      closed[cur] = 1;
      for (const e of this.nodes[cur].edges) {
        const ng = g[cur] + e.cost;
        if (ng < g[e.to]) {
          g[e.to] = ng;
          came[e.to] = cur;
          open.push(e.to, ng + h(this.nodes[e.to]));
        }
      }
    }
    if (!found) return null;

    const ids: number[] = [];
    for (let c = goal.id; c !== -1; c = came[c]) ids.push(c);
    ids.reverse();
    const pts = [from.clone(), ...ids.map((id) => new THREE.Vector3(this.nodes[id].x, this.nodes[id].y, this.nodes[id].z))];
    // Finish exactly at the destination if it can be reached from the last node.
    const last = pts[pts.length - 1];
    if (last.distanceTo(to) > 0.3 && this.canWalk(last.x, last.y, last.z, to.x, to.y, to.z)) pts.push(to.clone());
    return this.smooth(pts);
  }

  /** Skip waypoints where a straight walk is possible ("string pulling"). */
  private smooth(pts: THREE.Vector3[]): THREE.Vector3[] {
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = Math.min(pts.length - 1, i + 10);
      while (j > i + 1 && !this.canWalk(pts[i].x, pts[i].y, pts[i].z, pts[j].x, pts[j].y, pts[j].z)) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }
}

function bfs(nodes: NavNode[], start: number[], next: (n: NavNode) => number[]): Set<number> {
  const seen = new Set<number>(start);
  const queue = [...start];
  while (queue.length) {
    const id = queue.pop()!;
    for (const m of next(nodes[id])) {
      if (!seen.has(m)) {
        seen.add(m);
        queue.push(m);
      }
    }
  }
  return seen;
}

/** Small binary heap for A* (lowest priority first). */
class MinHeap {
  private ids: number[] = [];
  private pri: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  push(id: number, p: number): void {
    this.ids.push(id);
    this.pri.push(p);
    let i = this.ids.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.pri[parent] <= this.pri[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids.pop()!, lastP = this.pri.pop()!;
    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.pri[0] = lastP;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.ids.length && this.pri[l] < this.pri[m]) m = l;
        if (r < this.ids.length && this.pri[r] < this.pri[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]];
    [this.pri[a], this.pri[b]] = [this.pri[b], this.pri[a]];
  }
}
