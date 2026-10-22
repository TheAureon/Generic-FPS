import type * as THREE from 'three';
import type { Bot } from '../bots/Bot';
import { MODES, TEAMS } from '../config';
import {
  formatTime, modeLimit, scoreRows, teamLine, teamResult, TIME_LIMIT,
  type BotObjective, type GameMode, type Marker, type MatchResult, type ModeContext, type ProgressInfo, type ScoreRow,
} from './GameMode';
import { inRing, placeObjectives, RingVisual } from './objectives';

const S = MODES.control;
const NEUTRAL = '#efe6c8';

interface Zone {
  name: string;
  pos: THREE.Vector3;
  /** -1 = Red owns it ... 0 = neutral ... +1 = Blue owns it. */
  cap: number;
  owner: number | null;
  /** How many of each team are in it right now. */
  count: [number, number];
  ring: RingVisual;
}

/**
 * Control: three zones (A, B, C) around the map. Stand in one with only your
 * team in it to capture it (more of you = faster; an enemy-held zone has to
 * be neutralized first). Every zone your team holds scores a point a second.
 * First team to the limit wins.
 */
export class Control implements GameMode {
  readonly id = 'control' as const;
  readonly name = 'Control';
  readonly teams = true;
  readonly freeForAll = false;
  readonly botsRespawn = true;
  readonly playerRespawns = true;
  readonly scoreLabel = 'Caps';
  result: MatchResult | null = null;

  private zones: Zone[] = [];
  private pts: [number, number] = [0, 0];
  private personal = new Map<string, number>();

  constructor(private ctx: ModeContext) {}

  get initialBots(): number {
    return this.ctx.config.botCount;
  }

  private get limit(): number {
    return modeLimit(this.ctx.config);
  }

  start(): void {
    const { zones } = placeObjectives(this.ctx.map, this.ctx.nav, this.ctx.sides);
    this.zones = zones.slice(0, 3).map((pos, i) => ({
      name: 'ABC'[i], pos, cap: 0, owner: null, count: [0, 0],
      ring: new RingVisual(this.ctx.scene, this.ctx.world, pos, S.zoneRadius),
    }));
    this.ctx.announce('Control', `Capture and hold the zones · first to ${this.limit}`, 3);
  }

  private color(z: Zone): string {
    return z.owner === null ? NEUTRAL : TEAMS.css[z.owner];
  }

  update(dt: number): void {
    if (this.result) return;
    const people = this.ctx.combatants().filter((c) => c.isAlive() && c.team !== null);
    const me = this.ctx.player;
    for (const z of this.zones) {
      const inside = people.filter((c) => inRing(c.position, z.pos, S.zoneRadius));
      z.count = [inside.filter((c) => c.team === 0).length, inside.filter((c) => c.team === 1).length];
      const [b, r] = z.count;
      if (b > 0 && r > 0) {
        // Contested: nothing changes.
      } else if (b > 0 || r > 0) {
        const team = b > 0 ? 0 : 1, n = Math.min(3, b + r);
        const dir = team === 0 ? 1 : -1;
        const before = z.cap;
        z.cap = Math.max(-1, Math.min(1, z.cap + dir * ((1 + (n - 1) * 0.5) / S.captureTime) * dt));
        // Crossing the middle: the other team loses it.
        if (z.owner !== null && z.owner !== team && Math.sign(z.cap) !== Math.sign(before) && z.cap !== 0) {
          this.ctx.announce(`${z.name} neutralized`, '', 1.5);
          z.owner = null;
        }
        if (Math.abs(z.cap) >= 1 && z.owner !== team) {
          z.owner = team;
          for (const c of inside) this.personal.set(c.name, (this.personal.get(c.name) ?? 0) + 1);
          const ours = team === me.team;
          this.ctx.announce(`${ours ? 'Your team' : `${TEAMS.names[team]} team`} captured ${z.name}`, '', 2);
          this.ctx.cue(ours ? 'good' : 'bad');
        }
      } else {
        // Empty: slowly settle back to whoever holds it (or to neutral).
        const goal = z.owner === null ? 0 : z.owner === 0 ? 1 : -1;
        const step = dt / (S.captureTime * 2);
        z.cap = Math.abs(goal - z.cap) <= step ? goal : z.cap + Math.sign(goal - z.cap) * step;
      }
      if (z.owner !== null) this.pts[z.owner] += dt;
      z.ring.setColor(b > 0 && r > 0 ? '#ffffff' : this.color(z));
    }

    const timeUp = this.ctx.time >= TIME_LIMIT;
    if (Math.max(...this.pts) >= this.limit || timeUp) {
      this.result = teamResult(this.pts, timeUp, `First to ${this.limit}`, [
        `Zones you captured: ${this.personal.get(me.name) ?? 0}`, `Your kills: ${this.ctx.kills.get(me.name) ?? 0}`, `Match time: ${formatTime(this.ctx.time)}`,
      ]);
    }
  }

  teamScores(): [number, number] {
    return this.pts;
  }

  status(): string {
    const held = this.zones.map((z) => (z.owner === null ? `${z.name}·` : `${z.name}${TEAMS.names[z.owner][0]}`)).join(' ');
    return `${teamLine(this.pts)}  ·  ${held}  ·  First to ${this.limit}  ·  ${formatTime(TIME_LIMIT - this.ctx.time)}`;
  }

  scoreboard(): ScoreRow[] {
    return scoreRows(this.ctx, (n) => this.personal.get(n) ?? 0);
  }

  markers(): Marker[] {
    return this.zones.map((z) => ({ x: z.pos.x, y: z.pos.y, z: z.pos.z, label: z.name, color: this.color(z), always: true, radius: S.zoneRadius }));
  }

  progress(): ProgressInfo | null {
    const me = this.ctx.player;
    if (!me.isAlive() || me.team === null) return null;
    const z = this.zones.find((zz) => inRing(me.position, zz.pos, S.zoneRadius));
    if (!z) return null;
    if (z.count[0] > 0 && z.count[1] > 0) return { label: `${z.name} contested`, value: null, color: '#ffffff' };
    const mine = me.team === 0 ? z.cap : -z.cap; // +1 = ours
    if (z.owner === me.team && mine >= 1) return { label: `Holding ${z.name}`, value: 1, color: TEAMS.css[me.team] };
    if (mine < 0) return { label: `Neutralizing ${z.name}`, value: 1 + mine, color: TEAMS.css[1 - me.team] };
    return { label: `Capturing ${z.name}`, value: mine, color: TEAMS.css[me.team] };
  }

  botObjective(bot: Bot): BotObjective | null {
    if (bot.team === null || !this.zones.length) return null;
    const t = bot.team;
    const enemy = 1 - t;
    const index = this.ctx.bots.bots.indexOf(bot);
    const dist = (z: Zone) => Math.hypot(z.pos.x - bot.position.x, z.pos.z - bot.position.z);
    const ours = (z: Zone) => z.owner === t && (t === 0 ? z.cap : -z.cap) >= 1;
    // Score each zone (lower is better): go for ones we don't hold, defend ones under attack, spread out a bit.
    let best = this.zones[0], bestScore = Infinity;
    this.zones.forEach((z, i) => {
      let s = dist(z) + ((index + i) % 3) * 10;
      if (ours(z)) s += z.count[enemy] > 0 ? -20 : 70;
      else if (z.owner === enemy) s -= 10;
      if (s < bestScore) { bestScore = s; best = z; }
    });
    const inside = inRing(bot.position, best.pos, S.zoneRadius);
    return { pos: best.pos, radius: S.zoneRadius * 0.6, urgent: !inside && !ours(best), run: dist(best) > 12 };
  }

  /** (For tests.) */
  get zoneStates(): { name: string; owner: number | null; cap: number }[] {
    return this.zones.map((z) => ({ name: z.name, owner: z.owner, cap: z.cap }));
  }
}

