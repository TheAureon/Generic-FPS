import * as THREE from 'three';
import { audio } from '../audio/AudioEngine';
import type { TargetDummy } from '../entities/TargetDummy';
import type { GameMode, Marker, MatchResult, ModeContext, ProgressInfo, ScoreRow } from './GameMode';

/**
 * Training Course: a timed run around the map. Pass through the glowing
 * checkpoints in order, shooting the targets set up around each one on the
 * way. Every target still standing when you pass its checkpoint adds 3
 * seconds. Finish fast for a gold, silver or bronze medal; your best time on
 * each map is saved. No bots, so you can't die.
 */

const CHECKPOINTS = 8;
const TARGETS_PER = 2;
const PENALTY = 3;
const RADIUS = 2.4;
const KEY = 'gfps-course';

interface Checkpoint {
  pos: THREE.Vector3;
  mesh: THREE.Group;
  targets: TargetDummy[];
}

function bests(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

export class TrainingCourse implements GameMode {
  readonly id = 'course' as const;
  readonly name = 'Training Course';
  readonly teams = false;
  readonly freeForAll = false;
  readonly botsRespawn = false;
  readonly playerRespawns = true;
  readonly noKillstreaks = true;
  readonly initialBots = 0;
  result: MatchResult | null = null;
  private points: Checkpoint[] = [];
  private next = 0;
  /** Seconds on the clock (starts after the countdown), and penalties so far. */
  private clock = 0;
  private penalty = 0;
  private countdown = 3;
  /** Par time for a gold medal (seconds), from the route's length. */
  private par = 0;
  private group = new THREE.Group();

  constructor(private ctx: ModeContext) {}

  start(): void {
    this.ctx.scene.add(this.group);
    this.buildRoute();
    const best = bests()[this.ctx.map.id];
    this.ctx.announce('Training Course', `Through ${CHECKPOINTS} checkpoints, shooting the targets on the way.${best ? ` Your best: ${fmt(best)}` : ''}`, 3);
  }

  /** Checkpoints spread around the map (the same route every time on a map), each with targets nearby. */
  private buildRoute(): void {
    const nav = this.ctx.nav;
    let seed = 7;
    for (const ch of this.ctx.map.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const me = this.ctx.player.position;
    let cur = new THREE.Vector3(me.x, me.y, me.z);
    const used: THREE.Vector3[] = [cur.clone()];
    let length = 0;
    for (let k = 0; k < CHECKPOINTS; k++) {
      // A spot 14-30 m on from the last, away from the rest of the route.
      let cand = nav.nodes.filter((n) => {
        const d = Math.hypot(n.x - cur.x, n.z - cur.z);
        return d > 14 && d < 30 && used.every((u) => Math.hypot(n.x - u.x, n.z - u.z) > 11);
      });
      if (!cand.length) cand = nav.nodes.filter((n) => used.every((u) => Math.hypot(n.x - u.x, n.z - u.z) > 8));
      if (!cand.length) break;
      const n = cand[Math.floor(rand() * cand.length)];
      const pos = new THREE.Vector3(n.x, n.y, n.z);
      const path = nav.findPath(cur, pos);
      length += path ? path.reduce((a, p, i) => a + (i ? p.distanceTo(path[i - 1]) : 0), 0) : cur.distanceTo(pos) * 1.4;
      used.push(pos);
      this.points.push({ pos, mesh: this.makeGate(pos), targets: this.placeTargets(pos, rand) });
      cur = pos;
    }
    const targets = this.points.reduce((a, p) => a + p.targets.length, 0);
    // About a brisk run between gates plus a second and a half per target.
    this.par = length / 7 + targets * 1.5;
    this.highlight();
  }

  /** Targets standing near a checkpoint, in sight of it. */
  private placeTargets(at: THREE.Vector3, rand: () => number): TargetDummy[] {
    const out: TargetDummy[] = [];
    const nodes = this.ctx.nav.nodes.filter((n) => {
      const d = Math.hypot(n.x - at.x, n.z - at.z);
      return d > 6 && d < 16 && Math.abs(n.y - at.y) < 3 && this.ctx.world.hasLineOfSight(at.x, at.y + 1.6, at.z, n.x, n.y + 1.2, n.z);
    });
    for (let i = 0; i < TARGETS_PER && nodes.length; i++) {
      const n = nodes.splice(Math.floor(rand() * nodes.length), 1)[0];
      const yaw = (Math.atan2(-(at.x - n.x), -(at.z - n.z)) * 180) / Math.PI;
      out.push(this.ctx.addTarget({ x: n.x, y: n.y, z: n.z, yaw, strafe: rand() < 0.4 ? 1.5 : 0 }));
    }
    return out;
  }

  /** A glowing ring on the floor with a beam of light going up. */
  private makeGate(at: THREE.Vector3): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x40c0ff, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(RADIUS * 0.8, 0.07, 8, 40).rotateX(Math.PI / 2), mat);
    ring.position.y = 0.08;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS * 0.8, RADIUS * 0.8, 6, 32, 1, true), mat.clone());
    (beam.material as THREE.MeshBasicMaterial).opacity = 0.12;
    beam.position.y = 3;
    g.add(ring, beam);
    g.position.copy(at);
    this.group.add(g);
    return g;
  }

  /** The next checkpoint glows bright; the one after it dimly; the rest are hidden. */
  private highlight(): void {
    this.points.forEach((p, i) => {
      p.mesh.visible = i >= this.next && i <= this.next + 1;
      p.mesh.traverse((o) => {
        if (o instanceof THREE.Mesh) (o.material as THREE.MeshBasicMaterial).color.set(i === this.next ? 0x40c0ff : 0x506070);
      });
    });
  }

  update(dt: number): void {
    if (this.result) return;
    if (this.countdown > 0) {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      if (Math.ceil(this.countdown) !== before) audio.play(this.countdown <= 0 ? 'objective_good' : 'tick');
      return;
    }
    this.clock += dt;
    this.group.children.forEach((g, i) => (g.rotation.y += dt * (i === this.next ? 1.2 : 0.3)));
    const cp = this.points[this.next];
    if (!cp) return this.finish();
    const me = this.ctx.player.position;
    if (Math.hypot(me.x - cp.pos.x, me.z - cp.pos.z) > RADIUS || Math.abs(me.y - cp.pos.y) > 2.5) return;
    // Through the gate: anything left standing here costs time.
    const missed = cp.targets.filter((t) => t.isAlive()).length;
    this.penalty += missed * PENALTY;
    for (const t of cp.targets) this.ctx.removeTarget(t);
    this.next++;
    this.highlight();
    this.ctx.cue('good');
    const left = this.points.length - this.next;
    this.ctx.announce(left ? `Checkpoint ${this.next}/${this.points.length}` : 'Finish!', `${fmt(this.clock + this.penalty)}${missed ? `  ·  missed ${missed} target${missed > 1 ? 's' : ''}: +${missed * PENALTY}s` : ''}`, 1.2);
    if (!left) this.finish();
  }

  private finish(): void {
    const total = this.clock + this.penalty;
    const all = bests();
    const before = all[this.ctx.map.id];
    const best = !before || total < before;
    if (best) {
      all[this.ctx.map.id] = total;
      try {
        localStorage.setItem(KEY, JSON.stringify(all));
      } catch {
        // Couldn't save.
      }
    }
    const medal = total <= this.par ? 'Gold' : total <= this.par * 1.25 ? 'Silver' : total <= this.par * 1.6 ? 'Bronze' : null;
    if (medal) this.ctx.award(`${medal} medal`, medal === 'Gold' ? 500 : medal === 'Silver' ? 300 : 150);
    this.result = {
      title: medal ? `${medal} medal!` : 'Course complete',
      subtitle: `${fmt(total)}${best ? '  ·  New best!' : `  ·  Best: ${fmt(before!)}`}`,
      win: !!medal,
      stats: [`Run: ${fmt(this.clock)}`, `Penalties: +${this.penalty}s`, `Gold: ${fmt(this.par)}  ·  Silver: ${fmt(this.par * 1.25)}  ·  Bronze: ${fmt(this.par * 1.6)}`],
    };
  }

  status(): string {
    if (this.countdown > 0) return `Training Course  ·  Starting in ${Math.ceil(this.countdown)}`;
    const best = bests()[this.ctx.map.id];
    return `Checkpoint ${Math.min(this.next + 1, this.points.length)}/${this.points.length}  ·  ${fmt(this.clock + this.penalty)}${best ? `  ·  Best ${fmt(best)}` : ''}`;
  }

  progress(): ProgressInfo | null {
    return { label: `Gold under ${fmt(this.par)}`, value: Math.min(1, (this.clock + this.penalty) / this.par), color: this.clock + this.penalty <= this.par ? '#f2c14e' : '#c0c4c8' };
  }

  markers(): Marker[] {
    const cp = this.points[this.next];
    return cp ? [{ x: cp.pos.x, y: cp.pos.y + 1, z: cp.pos.z, label: String(this.next + 1), color: '#40c0ff' }] : [];
  }

  scoreboard(): ScoreRow[] {
    return [{ name: this.ctx.player.name, kills: this.ctx.kills.get(this.ctx.player.name) ?? 0, deaths: 0, isPlayer: true }];
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
