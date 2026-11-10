import type * as THREE from 'three';
import type { Bot } from '../bots/Bot';
import { PARTY_MODES, TEAMS } from '../config';
import {
  formatTime, modeLimit, scoreRows, teamLine, teamResult, TIME_LIMIT,
  type BotObjective, type GameMode, type Marker, type MatchResult, type ModeContext, type ProgressInfo, type ScoreRow,
} from './GameMode';
import { inRing, placeObjectives, RingVisual } from './objectives';

const H = PARTY_MODES.hardpoint;
const NEUTRAL = '#efe6c8';

/**
 * Hardpoint (teams): one zone is live at a time and it moves every minute
 * (the next spot shows a few seconds early). Stand in it with only your team
 * to capture it; after that your team scores a point a second as long as no
 * enemy is standing in it. Enemies have to neutralize it first, then capture.
 */
export class Hardpoint implements GameMode {
  readonly id = 'hardpoint' as const;
  readonly name = 'Hardpoint';
  readonly teams = true;
  readonly freeForAll = false;
  readonly botsRespawn = true;
  readonly playerRespawns = true;
  readonly scoreLabel = 'Caps';
  result: MatchResult | null = null;

  private spots: THREE.Vector3[] = [];
  private rings: RingVisual[] = [];
  private active = 0;
  private movedAt = 0;
  /** -1 = Red owns ... +1 = Blue owns. */
  private cap = 0;
  private owner: number | null = null;
  private count: [number, number] = [0, 0];
  private pts: [number, number] = [0, 0];
  private personal = new Map<string, number>();
  private yourTime = 0;

  constructor(private ctx: ModeContext) {}

  get initialBots(): number {
    return this.ctx.config.botCount;
  }

  private get limit(): number {
    return modeLimit(this.ctx.config);
  }

  start(): void {
    this.spots = placeObjectives(this.ctx.map, this.ctx.nav, this.ctx.sides).hills;
    this.rings = this.spots.map((p) => new RingVisual(this.ctx.scene, this.ctx.world, p, H.zoneRadius));
    this.rings.forEach((r, i) => (r.visible = i === 0));
    this.ctx.announce('Hardpoint', `Capture and hold the hardpoint · first to ${this.limit}`, 3);
  }

  private get pos(): THREE.Vector3 {
    return this.spots[this.active];
  }

  private get next(): number {
    return (this.active + 1) % this.spots.length;
  }

  private get moveIn(): number {
    return H.moveEvery - (this.ctx.time - this.movedAt);
  }

  private color(): string {
    return this.owner === null ? NEUTRAL : TEAMS.css[this.owner];
  }

  update(dt: number): void {
    if (this.result) return;
    // Time to move on.
    if (this.moveIn <= 0) {
      this.rings[this.active].visible = false;
      this.active = this.next;
      this.movedAt = this.ctx.time;
      this.cap = 0;
      this.owner = null;
      this.ctx.announce('Hardpoint moved', 'A new hardpoint is live', 1.8);
      this.ctx.cue('info');
    }
    // The next spot shows up a little early (dimmed).
    const warn = this.moveIn <= H.warn;
    this.rings.forEach((r, i) => (r.visible = i === this.active || (warn && i === this.next)));
    if (warn) this.rings[this.next].setColor('#7d7a70');

    const people = this.ctx.combatants().filter((c) => c.isAlive() && c.team !== null);
    const inside = people.filter((c) => inRing(c.position, this.pos, H.zoneRadius));
    this.count = [inside.filter((c) => c.team === 0).length, inside.filter((c) => c.team === 1).length];
    const [b, r] = this.count;
    if ((b > 0) !== (r > 0)) {
      const team = b > 0 ? 0 : 1;
      const dir = team === 0 ? 1 : -1;
      const n = Math.min(3, b + r);
      const before = this.cap;
      this.cap = Math.max(-1, Math.min(1, this.cap + dir * ((1 + (n - 1) * 0.5) / H.captureTime) * dt));
      if (this.owner !== null && this.owner !== team && Math.sign(this.cap) !== Math.sign(before) && this.cap !== 0) {
        this.owner = null;
        this.ctx.announce('Hardpoint neutralized', '', 1.4);
      }
      if (Math.abs(this.cap) >= 1 && this.owner !== team) {
        this.owner = team;
        for (const c of inside) this.personal.set(c.name, (this.personal.get(c.name) ?? 0) + 1);
        const ours = team === this.ctx.player.team;
        this.ctx.announce(ours ? 'Hardpoint captured' : 'Hardpoint lost', '', 1.6);
        this.ctx.cue(ours ? 'good' : 'bad');
        if (inside.includes(this.ctx.player)) this.ctx.award('Hardpoint captured', 100);
      }
    }
    // The owners score while no enemy stands in it.
    if (this.owner !== null && this.count[1 - this.owner] === 0) {
      this.pts[this.owner] += dt;
      if (this.owner === this.ctx.player.team && inside.includes(this.ctx.player)) {
        this.yourTime += dt;
        // A few points for every 10 seconds you hold it yourself.
        if (Math.floor(this.yourTime / 10) > Math.floor((this.yourTime - dt) / 10)) this.ctx.award('Holding the hardpoint', 50);
      }
    }
    this.rings[this.active].setColor(b > 0 && r > 0 ? '#ffffff' : this.color());

    const timeUp = this.ctx.time >= TIME_LIMIT;
    if (Math.max(...this.pts) >= this.limit || timeUp) {
      const me = this.ctx.player;
      this.result = teamResult(this.pts, timeUp, `First to ${this.limit}`, [
        `Hardpoints you captured: ${this.personal.get(me.name) ?? 0}`,
        `Your time on the hardpoint: ${Math.round(this.yourTime)} s`,
        `Your kills: ${this.ctx.kills.get(me.name) ?? 0}`,
        `Match time: ${formatTime(this.ctx.time)}`,
      ]);
    }
  }

  teamScores(): [number, number] {
    return this.pts;
  }

  status(): string {
    return `${teamLine(this.pts)}  ·  Moves in ${formatTime(this.moveIn)}  ·  First to ${this.limit}  ·  ${formatTime(TIME_LIMIT - this.ctx.time)}`;
  }

  scoreboard(): ScoreRow[] {
    return scoreRows(this.ctx, (n) => this.personal.get(n) ?? 0);
  }

  markers(): Marker[] {
    const out: Marker[] = [{ x: this.pos.x, y: this.pos.y, z: this.pos.z, label: 'HP', color: this.color(), always: true, radius: H.zoneRadius }];
    if (this.moveIn <= H.warn) {
      const n = this.spots[this.next];
      out.push({ x: n.x, y: n.y, z: n.z, label: 'Next', color: '#9a978c', always: true, radius: H.zoneRadius });
    }
    return out;
  }

  progress(): ProgressInfo | null {
    const me = this.ctx.player;
    if (!me.isAlive() || me.team === null || !inRing(me.position, this.pos, H.zoneRadius)) return null;
    if (this.count[0] > 0 && this.count[1] > 0) return { label: 'Contested', value: null, color: '#ffffff' };
    const mine = me.team === 0 ? this.cap : -this.cap;
    if (this.owner === me.team && mine >= 1) return { label: 'Holding the hardpoint', value: 1, color: TEAMS.css[me.team] };
    if (mine < 0) return { label: 'Neutralizing', value: 1 + mine, color: TEAMS.css[1 - me.team] };
    return { label: 'Capturing', value: mine, color: TEAMS.css[me.team] };
  }

  botObjective(bot: Bot): BotObjective | null {
    if (bot.team === null) return null;
    // Heading for the next spot just before it goes live.
    const target = this.moveIn <= 6 ? this.spots[this.next] : this.pos;
    const d = Math.hypot(target.x - bot.position.x, target.z - bot.position.z);
    const inside = d < H.zoneRadius;
    const ours = this.owner === bot.team;
    return { pos: target, radius: H.zoneRadius * 0.6, urgent: !inside && !ours, run: d > 10 };
  }
}
