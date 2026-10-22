import type * as THREE from 'three';
import type { Bot } from '../bots/Bot';
import { MODES, TEAMS } from '../config';
import {
  formatTime, modeLimit, scoreRows, teamLine, teamResult, TIME_LIMIT,
  type BotObjective, type Combatant, type GameMode, type Marker, type MatchResult, type ModeContext, type ProgressInfo, type ScoreRow,
} from './GameMode';
import { inRing, placeObjectives, RingVisual } from './objectives';

const NEUTRAL = '#efe6c8';
const GOLD = '#e8b93a';
const ENEMY = '#ff6152';

/**
 * King of the Hill (free for all) and Court of the Hill (teams).
 *
 * A ring (the hill) sits somewhere on the map. While you're the only one in
 * it (KOH), or only your team is (COH), you score a point every second. If
 * anyone else is in it too, it's contested: nobody scores. The hill moves to
 * a new spot every minute. First to the limit wins.
 */
export class KingOfTheHill implements GameMode {
  readonly id: 'koh' | 'coh';
  readonly name: string;
  readonly freeForAll: boolean;
  readonly botsRespawn = true;
  readonly playerRespawns = true;
  readonly scoreLabel = 'Hill';
  result: MatchResult | null = null;

  private settings: (typeof MODES)['koh'];
  private hills: THREE.Vector3[] = [];
  private current = 0;
  private moveTimer = 0;
  private ring: RingVisual | null = null;
  /** Seconds each person has held the hill (alone, or for their team). */
  private points = new Map<string, number>();
  private teamPts: [number, number] = [0, 0];
  /** Who's in the hill right now. */
  private occupants: Combatant[] = [];
  private holder: string | number | null = null;

  constructor(private ctx: ModeContext, readonly teams: boolean) {
    this.id = teams ? 'coh' : 'koh';
    this.name = teams ? 'Court of the Hill' : 'King of the Hill';
    this.freeForAll = !teams;
    this.settings = teams ? MODES.coh : MODES.koh;
  }

  get initialBots(): number {
    return this.ctx.config.botCount;
  }

  private get limit(): number {
    return modeLimit(this.ctx.config);
  }

  private get hill(): THREE.Vector3 {
    return this.hills[this.current];
  }

  start(): void {
    this.hills = placeObjectives(this.ctx.map, this.ctx.nav, this.ctx.sides).hills;
    this.placeHill(0);
    this.ctx.announce(this.name, this.teams ? `Hold the hill with your team · first to ${this.limit}` : `Hold the hill alone · first to ${this.limit} seconds`, 3);
  }

  private placeHill(i: number): void {
    this.current = i % this.hills.length;
    this.moveTimer = this.settings.moveEvery;
    if (this.ring) this.ring.group.removeFromParent();
    this.ring = new RingVisual(this.ctx.scene, this.ctx.world, this.hill, this.settings.hillRadius);
  }

  update(dt: number): void {
    if (this.result) return;
    this.moveTimer -= dt;
    if (this.moveTimer <= 0) {
      this.placeHill(this.current + 1);
      this.ctx.announce('The hill has moved', '', 2);
      this.ctx.cue('info');
    }

    this.occupants = this.ctx.combatants().filter((c) => c.isAlive() && inRing(c.position, this.hill, this.settings.hillRadius));
    this.holder = null;
    if (this.teams) {
      const teams = new Set(this.occupants.map((c) => c.team!));
      if (teams.size === 1) {
        const t = [...teams][0];
        this.teamPts[t] += dt;
        this.holder = t;
        for (const c of this.occupants) this.points.set(c.name, (this.points.get(c.name) ?? 0) + dt);
      }
    } else if (this.occupants.length === 1) {
      const c = this.occupants[0];
      this.points.set(c.name, (this.points.get(c.name) ?? 0) + dt);
      this.holder = c.name;
    }
    this.ring?.setColor(this.color());

    const timeUp = this.ctx.time >= TIME_LIMIT;
    if (this.teams) {
      if (Math.max(...this.teamPts) >= this.limit || timeUp) {
        this.result = teamResult(this.teamPts, timeUp, `First to ${this.limit}`, this.stats());
      }
      return;
    }
    const rows = this.scoreboard();
    const leader = rows[0];
    if ((leader.score ?? 0) < this.limit && !timeUp) return;
    const me = rows.find((r) => r.isPlayer)!;
    const win = me.score === leader.score;
    this.result = {
      title: win ? 'You win!' : `${leader.name} wins`,
      subtitle: timeUp && (leader.score ?? 0) < this.limit ? 'Time is up' : `First to ${this.limit} seconds on the hill`,
      win,
      stats: this.stats(),
    };
  }

  private stats(): string[] {
    const me = this.ctx.player.name;
    return [`Your time on the hill: ${formatTime(this.points.get(me) ?? 0)}`, `Your kills: ${this.ctx.kills.get(me) ?? 0}`, `Match time: ${formatTime(this.ctx.time)}`];
  }

  /** The ring's color: who holds it (or white when empty or contested). */
  private color(): string {
    if (this.holder === null) return NEUTRAL;
    if (this.teams) return TEAMS.css[this.holder as number];
    return this.holder === this.ctx.player.name ? GOLD : ENEMY;
  }

  teamScores(): [number, number] {
    return this.teamPts;
  }

  status(): string {
    const move = `Hill moves ${formatTime(this.moveTimer)}`;
    if (this.teams) return `${teamLine(this.teamPts)}  ·  First to ${this.limit}  ·  ${move}  ·  ${formatTime(TIME_LIMIT - this.ctx.time)}`;
    const rows = this.scoreboard();
    const me = rows.find((r) => r.isPlayer)!;
    const leader = rows[0];
    const lead = leader.isPlayer ? 'You lead' : `Leader: ${leader.name} ${leader.score}`;
    return `You ${me.score}  ·  ${lead}  ·  First to ${this.limit}  ·  ${move}  ·  ${formatTime(TIME_LIMIT - this.ctx.time)}`;
  }

  scoreboard(): ScoreRow[] {
    return scoreRows(this.ctx, (n) => this.points.get(n) ?? 0);
  }

  markers(): Marker[] {
    const h = this.hill;
    return [{ x: h.x, y: h.y, z: h.z, label: 'Hill', color: this.color(), always: true, radius: this.settings.hillRadius }];
  }

  progress(): ProgressInfo | null {
    const pl = this.ctx.player;
    if (!pl.isAlive() || !this.occupants.includes(pl)) return null;
    const mine = this.teams ? this.holder === pl.team : this.holder === pl.name;
    if (!mine) return { label: 'Contested — clear the hill!', value: null, color: ENEMY };
    const value = this.teams ? this.teamPts[pl.team!] / this.limit : (this.points.get(pl.name) ?? 0) / this.limit;
    return { label: this.teams ? 'Your team holds the hill' : 'You hold the hill', value, color: this.teams ? TEAMS.css[pl.team!] : GOLD };
  }

  botObjective(bot: Bot): BotObjective {
    const inside = inRing(bot.position, this.hill, this.settings.hillRadius);
    const far = Math.hypot(bot.position.x - this.hill.x, bot.position.z - this.hill.z);
    return { pos: this.hill, radius: this.settings.hillRadius * 0.7, urgent: !inside, run: far > 12 };
  }
}
