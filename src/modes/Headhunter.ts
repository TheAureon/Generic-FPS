import { events } from '../core/events';
import { formatTime, modeLimit, scoreRows, TIME_LIMIT, type GameMode, type MatchResult, type ModeContext, type ScoreRow } from './GameMode';

/**
 * Headhunter: free for all where only headshot kills score. First to the
 * limit wins. The bots aim for heads too.
 */
export class Headhunter implements GameMode {
  readonly id = 'headhunter' as const;
  readonly name = 'Headhunter';
  readonly teams = false;
  readonly freeForAll = true;
  readonly botsRespawn = true;
  readonly playerRespawns = true;
  readonly scoreLabel = 'Heads';
  result: MatchResult | null = null;
  private heads = new Map<string, number>();
  private off: () => void = () => {};

  constructor(private ctx: ModeContext) {}

  get initialBots(): number {
    return this.ctx.config.botCount;
  }

  private get limit(): number {
    return modeLimit(this.ctx.config);
  }

  start(): void {
    for (const b of this.ctx.bots.bots) b.aimHeight = 0.9;
    this.off = events.on('kill', (e) => {
      if (!e.headshot || e.killer === e.victim) return;
      this.heads.set(e.killer, (this.heads.get(e.killer) ?? 0) + 1);
      if (e.killer === this.ctx.player.name) this.ctx.award('Head hunted', 50);
    });
    this.ctx.announce('Headhunter', `Only headshot kills count. First to ${this.limit}`, 3);
  }

  dispose(): void {
    this.off();
  }

  update(): void {
    if (this.result) return;
    const rows = this.scoreboard();
    const top = rows[0];
    const timeUp = this.ctx.time >= TIME_LIMIT;
    if ((top.score ?? 0) < this.limit && !timeUp) return;
    const me = rows.find((r) => r.isPlayer)!;
    const winner = (me.score ?? 0) === (top.score ?? 0) ? me : top;
    this.result = {
      title: winner.isPlayer ? 'You win!' : `${winner.name} wins`,
      subtitle: timeUp && (top.score ?? 0) < this.limit ? 'Time is up' : `First to ${this.limit} headshot kills`,
      win: winner.isPlayer,
      stats: [`Your headshot kills: ${me.score ?? 0}`, `Your kills: ${me.kills}`, `Match time: ${formatTime(this.ctx.time)}`],
    };
  }

  status(): string {
    const rows = this.scoreboard();
    const me = rows.find((r) => r.isPlayer)!;
    const lead = rows[0].isPlayer ? 'You lead' : `Leader: ${rows[0].name} ${rows[0].score}`;
    return `Heads ${me.score}  ·  ${lead}  ·  First to ${this.limit}  ·  ${formatTime(TIME_LIMIT - this.ctx.time)}`;
  }

  scoreboard(): ScoreRow[] {
    return scoreRows(this.ctx, (n) => this.heads.get(n) ?? 0);
  }
}
