import { BOT_DIFFICULTY, WEAPONS, type Difficulty, type WeaponId } from '../config';
import { events } from '../core/events';
import { formatTime, modeLimit, scoreRows, type GameMode, type MatchResult, type ModeContext, type ScoreRow } from './GameMode';

/** The rungs: a title, how good the bot is, and its gun. The last one is between Master and Insane. */
const RUNGS: { title: string; skill: Difficulty; gun: WeaponId; boost?: boolean }[] = [
  { title: 'Rookie', skill: 'beginner', gun: 'pistol' },
  { title: 'Brawler', skill: 'easy', gun: 'smg' },
  { title: 'Gunslinger', skill: 'medium', gun: 'shotgun' },
  { title: 'Veteran', skill: 'advanced', gun: 'rifle' },
  { title: 'Elite', skill: 'hard', gun: 'lmg' },
  { title: 'Master', skill: 'master', gun: 'sniper' },
  { title: 'Champion', skill: 'master', gun: 'rifle', boost: true },
];
/** Seconds between duels. */
const BREAK = 4;

/**
 * Arena Ladder: 1v1 duels against one bot at a time, each tougher than the
 * last (and with a different gun), up to the Champion. First to the kill
 * limit wins a duel; lose one and your run is over. You keep all your guns.
 */
export class ArenaLadder implements GameMode {
  readonly id = 'ladder' as const;
  readonly name = 'Arena Ladder';
  readonly teams = false;
  readonly freeForAll = false;
  readonly botsRespawn = true;
  readonly playerRespawns = true;
  readonly scoreLabel = 'Duel kills';
  result: MatchResult | null = null;
  private rung = 0;
  private you = 0;
  private them = 0;
  private between = 0;
  private off: () => void = () => {};

  constructor(private ctx: ModeContext) {}

  get initialBots(): number {
    return 1;
  }

  private get limit(): number {
    return modeLimit(this.ctx.config);
  }

  private get bot() {
    return this.ctx.bots.bots[0];
  }

  start(): void {
    this.off = events.on('kill', (e) => {
      if (this.between > 0 || this.result) return;
      if (e.victim === this.bot.name) this.you++;
      else if (e.victim === this.ctx.player.name) this.them++;
      if (this.you >= this.limit) this.won();
      else if (this.them >= this.limit) this.lost();
    });
    this.startDuel();
  }

  dispose(): void {
    this.off();
  }

  private startDuel(): void {
    const r = RUNGS[this.rung];
    this.you = this.them = 0;
    const b = this.bot;
    const base = BOT_DIFFICULTY[r.skill];
    b.skill = r.boost ? { ...base, aimError: base.aimError * 0.75, reactionTime: base.reactionTime * 0.8, damageMultiplier: base.damageMultiplier * 1.15 } : base;
    this.ctx.loadout(b, [r.gun]);
    this.ctx.respawn(b);
    this.ctx.respawn(this.ctx.player);
    this.ctx.announce(`Duel ${this.rung + 1} of ${RUNGS.length}: ${r.title}`, `${b.name} with the ${WEAPONS[r.gun].name}. First to ${this.limit}`, 2.6);
    this.ctx.cue('info');
  }

  private won(): void {
    this.ctx.award(`Beat the ${RUNGS[this.rung].title}`, 100 * (this.rung + 1));
    if (this.rung + 1 >= RUNGS.length) return this.finish(true);
    this.ctx.announce('Duel won!', `Next: the ${RUNGS[this.rung + 1].title}`, 2.5);
    this.ctx.cue('good');
    this.between = BREAK;
  }

  private lost(): void {
    this.finish(false);
  }

  private finish(champion: boolean): void {
    const beat = champion ? RUNGS.length : this.rung;
    const me = this.scoreboard().find((r) => r.isPlayer)!;
    this.result = {
      title: champion ? 'Arena Champion!' : `Beaten by the ${RUNGS[this.rung].title}`,
      subtitle: `You beat ${beat} of ${RUNGS.length} opponents`,
      win: champion,
      stats: [`Last duel: ${this.you}–${this.them}`, `Your kills: ${me.kills}`, `Your deaths: ${me.deaths}`, `Time: ${formatTime(this.ctx.time)}`],
    };
  }

  update(dt: number): void {
    if (this.result || this.between <= 0) return;
    this.between -= dt;
    if (this.between <= 0) {
      this.rung++;
      this.startDuel();
    }
  }

  status(): string {
    const r = RUNGS[this.rung];
    if (this.between > 0) return `Duel won  ·  Next: the ${RUNGS[this.rung + 1]?.title ?? ''} in ${Math.ceil(this.between)}`;
    return `Duel ${this.rung + 1}/${RUNGS.length}: ${r.title}  ·  You ${this.you} – ${this.them}  ·  First to ${this.limit}`;
  }

  scoreboard(): ScoreRow[] {
    return scoreRows(this.ctx);
  }
}
