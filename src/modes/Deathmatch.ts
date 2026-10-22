import { formatTime, modeLimit, scoreRows, TIME_LIMIT, type GameMode, type MatchResult, type ModeContext, type ScoreRow } from './GameMode';

/**
 * Free for All: everyone for themselves. First to the kill limit wins; if
 * time runs out, the most kills wins. Everyone respawns after a short delay.
 */
export class Deathmatch implements GameMode {
  readonly id = 'deathmatch' as const;
  readonly name = 'Free for All';
  readonly teams = false;
  readonly freeForAll = true;
  readonly botsRespawn = true;
  readonly playerRespawns = true;
  result: MatchResult | null = null;

  constructor(private ctx: ModeContext) {}

  get initialBots(): number {
    return this.ctx.config.botCount;
  }

  private get limit(): number {
    return modeLimit(this.ctx.config);
  }

  start(): void {
    this.ctx.announce('Free for All', `First to ${this.limit} kills wins`, 3);
  }

  update(): void {
    if (this.result) return;
    const rows = this.scoreboard();
    const leader = rows[0];
    const limitReached = leader.kills >= this.limit;
    const timeUp = this.ctx.time >= TIME_LIMIT;
    if (!limitReached && !timeUp) return;

    // The player wins ties for first place.
    const topKills = leader.kills;
    const playerRow = rows.find((r) => r.isPlayer)!;
    const winner = playerRow.kills === topKills ? playerRow : leader;
    const win = winner.isPlayer;
    this.result = {
      title: win ? 'You win!' : `${winner.name} wins`,
      subtitle: timeUp && !limitReached ? 'Time is up' : `First to ${this.limit} kills`,
      win,
      stats: [`Your kills: ${playerRow.kills}`, `Your deaths: ${playerRow.deaths}`, `Match time: ${formatTime(this.ctx.time)}`],
    };
  }

  status(): string {
    const rows = this.scoreboard();
    const me = rows.find((r) => r.isPlayer)!;
    const leader = rows[0];
    const lead = leader.isPlayer ? 'You lead' : `Leader: ${leader.name} ${leader.kills}`;
    return `You ${me.kills}  ·  ${lead}  ·  First to ${this.limit}  ·  ${formatTime(TIME_LIMIT - this.ctx.time)}`;
  }

  scoreboard(): ScoreRow[] {
    return scoreRows(this.ctx);
  }
}
