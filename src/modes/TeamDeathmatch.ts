import { formatTime, modeLimit, scoreRows, teamLine, teamResult, TIME_LIMIT, type GameMode, type MatchResult, type ModeContext, type ScoreRow } from './GameMode';

/**
 * Team Deathmatch: Blue (you and your bots) against Red. Every kill scores
 * for the killer's team; first team to the limit wins. Everyone respawns.
 */
export class TeamDeathmatch implements GameMode {
  readonly id = 'tdm' as const;
  readonly name = 'Team Deathmatch';
  readonly teams = true;
  readonly freeForAll = false;
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
    this.ctx.announce('Team Deathmatch', `First team to ${this.limit} kills wins`, 3);
  }

  teamScores(): [number, number] {
    const s: [number, number] = [0, 0];
    for (const c of this.ctx.combatants()) if (c.team !== null) s[c.team] += this.ctx.kills.get(c.name) ?? 0;
    return s;
  }

  update(): void {
    if (this.result) return;
    const s = this.teamScores();
    const timeUp = this.ctx.time >= TIME_LIMIT;
    if (Math.max(...s) < this.limit && !timeUp) return;
    const me = this.scoreboard().find((r) => r.isPlayer)!;
    this.result = teamResult(s, timeUp, `First to ${this.limit} kills`, [`Your kills: ${me.kills}`, `Your deaths: ${me.deaths}`, `Match time: ${formatTime(this.ctx.time)}`]);
  }

  status(): string {
    return `${teamLine(this.teamScores())}  ·  First to ${this.limit}  ·  ${formatTime(TIME_LIMIT - this.ctx.time)}`;
  }

  scoreboard(): ScoreRow[] {
    return scoreRows(this.ctx);
  }
}
