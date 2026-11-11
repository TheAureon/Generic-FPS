import { PARTY_MODES, WEAPONS, type WeaponId } from '../config';
import { events } from '../core/events';
import { formatTime, modeLimit, scoreRows, TIME_LIMIT, type Combatant, type GameMode, type MatchResult, type ModeContext, type ScoreRow } from './GameMode';

const G = PARTY_MODES.gungame;

/**
 * Gun Game: everyone starts with the first gun on the ladder. Every kill
 * (or every few, from the menu) moves you up to the next gun; a kill with
 * the last gun wins. Getting killed by a grenade or the katana (or blowing
 * yourself up) knocks you back one gun. Free for all, everyone respawns.
 */
export class GunGame implements GameMode {
  readonly id = 'gungame' as const;
  readonly name = 'Gun Game';
  readonly teams = false;
  readonly freeForAll = true;
  readonly botsRespawn = true;
  readonly playerRespawns = true;
  readonly scoreLabel = 'Gun';
  result: MatchResult | null = null;
  /** Each fighter's place on the ladder, and kills with the current gun. */
  private level = new Map<string, number>();
  private atLevel = new Map<string, number>();
  private off: () => void = () => {};

  constructor(private ctx: ModeContext) {}

  get initialBots(): number {
    return this.ctx.config.botCount;
  }

  /** Kills needed with each gun. */
  private get perGun(): number {
    return modeLimit(this.ctx.config);
  }

  private gunName(level: number): string {
    return WEAPONS[G.ladder[Math.min(level, G.ladder.length - 1)]].name;
  }

  start(): void {
    for (const c of this.ctx.combatants()) this.setLevel(c, 0);
    this.off = events.on('kill', (e) => this.onKill(e.killer, e.victim, e.weapon === 'grenade' || e.weapon === 'katana'));
    this.ctx.announce('Gun Game', `${G.ladder.length} guns. A kill with the last one wins`, 3);
  }

  dispose(): void {
    this.off();
  }

  private find(name: string): Combatant | undefined {
    return this.ctx.combatants().find((c) => c.name === name);
  }

  private setLevel(c: Combatant, level: number): void {
    this.level.set(c.name, level);
    this.atLevel.set(c.name, 0);
    const gun: WeaponId = G.ladder[level];
    this.ctx.loadout(c, [gun], { grenades: 1 });
  }

  private onKill(killer: string, victim: string, humiliating: boolean): void {
    if (this.result) return;
    // Killed by a grenade or the katana, or your own grenade: back one gun.
    const v = this.find(victim);
    if (v && (humiliating || killer === victim)) {
      const lv = this.level.get(victim) ?? 0;
      if (lv > 0) {
        this.setLevel(v, lv - 1);
        if (v === this.ctx.player) this.ctx.announce('Demoted', `Back to the ${this.gunName(lv - 1)}`, 1.6);
      }
    }
    if (killer === victim) return;
    const k = this.find(killer);
    if (!k) return;
    const lv = this.level.get(killer) ?? 0;
    const n = (this.atLevel.get(killer) ?? 0) + 1;
    if (n < this.perGun) {
      this.atLevel.set(killer, n);
      return;
    }
    if (lv + 1 >= G.ladder.length) {
      this.finish(k, false);
      return;
    }
    this.setLevel(k, lv + 1);
    if (k === this.ctx.player) {
      const last = lv + 2 === G.ladder.length;
      this.ctx.announce(last ? 'Final gun!' : this.gunName(lv + 1), last ? `One kill with the ${this.gunName(lv + 1)} wins` : `Gun ${lv + 2} of ${G.ladder.length}`, 1.6);
      this.ctx.cue('good');
    } else if (lv + 2 === G.ladder.length) {
      this.ctx.announce(`${killer} is on the final gun`, '', 1.6);
      this.ctx.cue('bad');
    }
  }

  private finish(winner: Combatant, timeUp: boolean): void {
    const me = this.scoreboard().find((r) => r.isPlayer)!;
    const win = winner === this.ctx.player;
    this.result = {
      title: win ? 'You win!' : `${winner.name} wins`,
      subtitle: timeUp ? 'Time is up: furthest up the ladder' : `First through all ${G.ladder.length} guns`,
      win,
      stats: [`Your gun: ${this.gunName(this.level.get(me.name) ?? 0)} (${(this.level.get(me.name) ?? 0) + 1} of ${G.ladder.length})`, `Your kills: ${me.kills}`, `Match time: ${formatTime(this.ctx.time)}`],
    };
  }

  /** Ladder position with progress toward the next gun (for sorting). */
  private rank(name: string): number {
    return (this.level.get(name) ?? 0) + (this.atLevel.get(name) ?? 0) / (this.perGun + 1);
  }

  update(): void {
    if (this.result || this.ctx.time < TIME_LIMIT) return;
    // Time up: furthest along wins (the player wins ties).
    const all = this.ctx.combatants();
    const best = Math.max(...all.map((c) => this.rank(c.name)));
    const winner = this.rank(this.ctx.player.name) >= best ? this.ctx.player : all.find((c) => this.rank(c.name) === best)!;
    this.finish(winner, true);
  }

  status(): string {
    const me = this.ctx.player.name;
    const lv = this.level.get(me) ?? 0;
    const all = this.ctx.combatants().filter((c) => c !== this.ctx.player);
    const leader = all.reduce((a, b) => (this.rank(b.name) > this.rank(a.name) ? b : a), all[0]);
    const lead = leader && this.rank(leader.name) > this.rank(me) ? `Leader: ${leader.name} (gun ${(this.level.get(leader.name) ?? 0) + 1})` : 'You lead';
    const kills = this.perGun > 1 ? `  ${this.atLevel.get(me) ?? 0}/${this.perGun}` : '';
    return `${this.gunName(lv)} (${lv + 1}/${G.ladder.length})${kills}  ·  ${lead}  ·  ${formatTime(TIME_LIMIT - this.ctx.time)}`;
  }

  scoreboard(): ScoreRow[] {
    return scoreRows(this.ctx, (n) => (this.level.get(n) ?? 0) + 1).sort((a, b) => this.rank(b.name) - this.rank(a.name) || b.kills - a.kills);
  }
}
