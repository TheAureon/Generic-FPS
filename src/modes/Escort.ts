import * as THREE from 'three';
import type { Bot } from '../bots/Bot';
import { PARTY_MODES, TEAMS } from '../config';
import type { SpawnPoint } from '../map/MapTypes';
import {
  formatTime, modeLimit, scoreRows,
  type BotObjective, type GameMode, type Marker, type MatchResult, type ModeContext, type ProgressInfo, type ScoreRow,
} from './GameMode';
import { snapToOpen } from './objectives';

const E = PARTY_MODES.escort;
/** Checkpoints along the route (fractions). */
const CHECKPOINTS = [1 / 3, 2 / 3];

/**
 * Escort (teams): your team (Blue) pushes a cart along a route from your
 * side to theirs. It rolls while your team is near it and theirs isn't
 * (faster with more of you), and slowly rolls back if nobody pushes for a
 * while. Checkpoints add time. Get it to the end before the clock runs out.
 */
export class Escort implements GameMode {
  readonly id = 'escort' as const;
  readonly name = 'Escort';
  readonly teams = true;
  readonly freeForAll = false;
  readonly botsRespawn = true;
  readonly playerRespawns = true;
  readonly scoreLabel = 'Push';
  result: MatchResult | null = null;

  private path: THREE.Vector3[] = [];
  /** Distance along the path at each point. */
  private along: number[] = [];
  private length = 1;
  /** How far the cart has gone (meters along the path). */
  private dist = 0;
  private reached = 0;
  private timeLeft = 0;
  private idle = 0;
  private count: [number, number] = [0, 0];
  private pushTime = new Map<string, number>();
  private cart = new THREE.Group();
  private ring: THREE.Mesh;
  private lamp: THREE.Mesh;
  private wheels: THREE.Mesh[] = [];
  private route: THREE.Line | null = null;
  private spin = 0;

  constructor(private ctx: ModeContext) {
    const metal = new THREE.MeshStandardMaterial({ color: 0x4a5560, metalness: 0.6, roughness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23272c, roughness: 0.7 });
    const blue = new THREE.MeshStandardMaterial({ color: TEAMS.colors[0], emissive: TEAMS.colors[0], emissiveIntensity: 0.4, roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.7, 2.0), metal);
    body.position.y = 0.75;
    const rim = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 2.1), dark);
    rim.position.y = 1.15;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.12, 2.02), blue);
    stripe.position.y = 0.72;
    const load = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.5, 10), new THREE.MeshStandardMaterial({ color: 0xb0472d, roughness: 0.6 }));
    load.rotation.x = Math.PI / 2;
    load.position.y = 1.35;
    this.lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: 0x8fd0ff }));
    this.lamp.position.set(0, 1.85, 0.6);
    this.cart.add(body, rim, stripe, load, this.lamp);
    for (const [x, z] of [[-0.7, -0.65], [0.7, -0.65], [-0.7, 0.65], [0.7, 0.65]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.16, 12), dark);
      w.rotation.z = Math.PI / 2;
      w.position.set(x, 0.32, z);
      this.wheels.push(w);
      this.cart.add(w);
    }
    this.cart.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(E.pushRadius - 0.12, E.pushRadius, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.08;
    ctx.scene.add(this.cart, this.ring);
  }

  get initialBots(): number {
    return this.ctx.config.botCount;
  }

  start(): void {
    const mid = (ps: SpawnPoint[]) => ps.reduce((c, p) => c.add(new THREE.Vector3(p.x, p.y, p.z)), new THREE.Vector3()).divideScalar(Math.max(1, ps.length));
    // From the far end of Blue's side to the far end of Red's.
    const far = (ps: SpawnPoint[], other: THREE.Vector3) => ps.reduce((m, q) => (Math.hypot(q.x - other.x, q.z - other.z) > Math.hypot(m.x - other.x, m.z - other.z) ? q : m), ps[0]);
    const a0 = far(this.ctx.sides[0], mid(this.ctx.sides[1])), b0 = far(this.ctx.sides[1], mid(this.ctx.sides[0]));
    const a = new THREE.Vector3(a0.x, a0.y, a0.z), b = new THREE.Vector3(b0.x, b0.y, b0.z);
    const from = snapToOpen(this.ctx.nav, a.x + (b.x - a.x) * 0.06, a.z + (b.z - a.z) * 0.06);
    const to = snapToOpen(this.ctx.nav, a.x + (b.x - a.x) * 0.94, a.z + (b.z - a.z) * 0.94);
    // Through a point off to the side, so the route winds through the map.
    const dx = b.x - a.x, dz = b.z - a.z;
    const side = Math.random() < 0.5 ? -1 : 1;
    const via = snapToOpen(this.ctx.nav, a.x + dx * 0.5 - dz * 0.25 * side, a.z + dz * 0.5 + dx * 0.25 * side);
    const leg1 = this.ctx.nav.findPath(from, via), leg2 = this.ctx.nav.findPath(via, to);
    this.path = leg1 && leg2 ? [...leg1, ...leg2.slice(1)] : this.ctx.nav.findPath(from, to) ?? [from, to];
    if (this.path.length < 2) this.path = [from, to];
    this.along = [0];
    for (let i = 1; i < this.path.length; i++) this.along.push(this.along[i - 1] + this.path[i].distanceTo(this.path[i - 1]));
    this.length = Math.max(1, this.along[this.along.length - 1]);
    this.timeLeft = modeLimit(this.ctx.config) * 60;
    // The route, drawn on the ground.
    const pts = this.path.map((p) => p.clone().setY(p.y + 0.06));
    this.route = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: TEAMS.colors[0], dashSize: 0.8, gapSize: 0.6, transparent: true, opacity: 0.7 }));
    this.route.computeLineDistances();
    this.ctx.scene.add(this.route);
    this.place();
    this.ctx.announce('Escort', `Push the cart to the end. ${formatTime(this.timeLeft)} on the clock`, 3);
  }

  dispose(): void {
    this.cart.removeFromParent();
    this.ring.removeFromParent();
    this.route?.removeFromParent();
  }

  /** Point and direction at a distance along the route. */
  private at(d: number, out: THREE.Vector3, dir?: THREE.Vector3): THREE.Vector3 {
    let i = 1;
    while (i < this.along.length - 1 && this.along[i] < d) i++;
    const a = this.path[i - 1], b = this.path[i];
    const seg = Math.max(1e-4, this.along[i] - this.along[i - 1]);
    const t = THREE.MathUtils.clamp((d - this.along[i - 1]) / seg, 0, 1);
    dir?.subVectors(b, a).setY(0).normalize();
    return out.lerpVectors(a, b, t);
  }

  private get pos(): THREE.Vector3 {
    return this.cart.position;
  }

  private place(): void {
    const dir = new THREE.Vector3();
    this.at(this.dist, this.cart.position, dir);
    if (dir.lengthSq() > 0) this.cart.rotation.y = Math.atan2(dir.x, dir.z);
    this.ring.position.set(this.pos.x, this.pos.y + 0.08, this.pos.z);
  }

  update(dt: number): void {
    if (this.result) return;
    this.timeLeft -= dt;
    const people = this.ctx.combatants().filter((c) => c.isAlive() && c.team !== null && Math.hypot(c.position.x - this.pos.x, c.position.z - this.pos.z) < E.pushRadius && Math.abs(c.position.y - this.pos.y) < 3);
    this.count = [people.filter((c) => c.team === 0).length, people.filter((c) => c.team === 1).length];
    const [b, r] = this.count;
    let moved = 0;
    if (b > 0 && r === 0) {
      moved = E.speed[Math.min(3, b)] * dt;
      this.idle = 0;
      for (const c of people) this.pushTime.set(c.name, (this.pushTime.get(c.name) ?? 0) + dt);
      if (people.includes(this.ctx.player)) {
        const t = this.pushTime.get(this.ctx.player.name)!;
        if (Math.floor(t / 10) > Math.floor((t - dt) / 10)) this.ctx.award('Escorting the cart', 40);
      }
    } else if (b === 0) {
      this.idle += dt;
      // Nobody pushing for a while: it rolls back (not past a checkpoint).
      if (this.idle > E.rollbackAfter) {
        const floor = this.reached > 0 ? CHECKPOINTS[this.reached - 1] * this.length : 0;
        moved = -Math.min(E.rollback * dt, Math.max(0, this.dist - floor));
      }
    }
    this.dist = Math.min(this.length, this.dist + moved);
    this.spin += moved / 0.32;
    for (const w of this.wheels) w.rotation.x = this.spin;
    this.place();
    const contested = b > 0 && r > 0;
    (this.ring.material as THREE.MeshBasicMaterial).color.set(contested ? '#ffffff' : b > 0 ? TEAMS.css[0] : r > 0 ? TEAMS.css[1] : '#d8d2bd');
    (this.lamp.material as THREE.MeshBasicMaterial).color.set(b > 0 && r === 0 ? '#8fd0ff' : contested ? '#ffffff' : '#ff8a5a');

    // Checkpoints.
    while (this.reached < CHECKPOINTS.length && this.dist >= CHECKPOINTS[this.reached] * this.length) {
      this.reached++;
      this.timeLeft += E.checkpointBonus;
      this.ctx.announce(`Checkpoint ${this.reached} reached`, `+${E.checkpointBonus} seconds`, 2);
      this.ctx.cue('good');
    }

    const done = this.dist >= this.length - 0.01;
    if (!done && this.timeLeft > 0) return;
    const me = this.ctx.player;
    const pct = Math.round((100 * this.dist) / this.length);
    this.result = {
      title: done ? 'Cart delivered!' : 'Out of time',
      subtitle: done ? `Your team got the cart through with ${formatTime(this.timeLeft)} left` : `The cart made it ${pct}% of the way`,
      win: done,
      stats: [`Your time pushing: ${Math.round(this.pushTime.get(me.name) ?? 0)} s`, `Your kills: ${this.ctx.kills.get(me.name) ?? 0}`, `Match time: ${formatTime(this.ctx.time)}`],
    };
  }

  /** For the scoreboard: how much of the route is done (Blue) and left (Red), in percent. */
  teamScores(): [number, number] {
    const pct = Math.round((100 * this.dist) / this.length);
    return [pct, 100 - pct];
  }

  status(): string {
    const pct = Math.round((100 * this.dist) / this.length);
    const you = this.ctx.player.team === 0 ? 'Push the cart' : 'Stop the cart';
    return `${you}  ·  ${pct}% of the way  ·  Checkpoints ${this.reached}/${CHECKPOINTS.length}  ·  ${formatTime(this.timeLeft)}`;
  }

  scoreboard(): ScoreRow[] {
    return scoreRows(this.ctx, (n) => this.pushTime.get(n) ?? 0);
  }

  markers(): Marker[] {
    const end = this.path[this.path.length - 1];
    return [
      { x: this.pos.x, y: this.pos.y + 2.4, z: this.pos.z, label: 'Cart', color: TEAMS.css[0], always: true, radius: E.pushRadius },
      { x: end.x, y: end.y + 1, z: end.z, label: 'End', color: '#d8d2bd' },
    ];
  }

  progress(): ProgressInfo | null {
    const me = this.ctx.player;
    if (!me.isAlive() || Math.hypot(me.position.x - this.pos.x, me.position.z - this.pos.z) >= E.pushRadius) return null;
    const [b, r] = this.count;
    if (b > 0 && r > 0) return { label: 'Cart contested', value: null, color: '#ffffff' };
    return { label: `Pushing the cart (${b} on it)`, value: this.dist / this.length, color: TEAMS.css[0] };
  }

  botObjective(bot: Bot): BotObjective | null {
    if (bot.team === null) return null;
    const d = Math.hypot(bot.position.x - this.pos.x, bot.position.z - this.pos.z);
    // Blue stays on the cart; Red comes to contest it (some wait a bit up the route).
    if (bot.team === 0) return { pos: this.pos.clone(), radius: E.pushRadius * 0.6, urgent: d > E.pushRadius, run: d > 8 };
    const i = this.ctx.bots.bots.indexOf(bot);
    if (i % 3 === 0) {
      const ahead = this.at(Math.min(this.length, this.dist + 18), new THREE.Vector3());
      return { pos: ahead, radius: 5, run: true };
    }
    return { pos: this.pos.clone(), radius: E.pushRadius * 0.7, urgent: d > 14, run: d > 8 };
  }
}
