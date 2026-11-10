import { events } from '../core/events';
import { rules } from '../core/MatchRules';
import type { Bot } from '../bots/Bot';
import { formatTime, modeLimit, scoreRows, TIME_LIMIT, type Combatant, type GameMode, type MatchResult, type ModeContext, type ScoreRow } from './GameMode';

/** Seconds with an empty gun before you're given a bullet back (there's no melee). */
const EMPTY_REFILL = 10;

/**
 * One in the Chamber: everyone has a pistol with one bullet, and any hit
 * kills. A kill gives you your bullet back (plus one). You have a few lives;
 * the last one with lives left wins. No ammo pickups or grenades. If you're
 * empty for a while, a bullet comes back on its own.
 */
export class OneInTheChamber implements GameMode {
  readonly id = 'oitc' as const;
  readonly name = 'One in the Chamber';
  readonly teams = false;
  readonly freeForAll = true;
  readonly botsRespawn = false;
  readonly scoreLabel = 'Lives';
  readonly removePickups = ['ammo'] as const;
  readonly noRespawnNote = 'Out of lives';
  result: MatchResult | null = null;
  private off: () => void = () => {};
  /** How long each fighter has had an empty gun. */
  private empty = new Map<string, number>();
  private outOrder: string[] = [];

  constructor(private ctx: ModeContext) {}

  get initialBots(): number {
    return this.ctx.config.botCount;
  }

  private get lives(): number {
    return modeLimit(this.ctx.config);
  }

  private livesLeft(name: string): number {
    return Math.max(0, this.lives - (this.ctx.deaths.get(name) ?? 0));
  }

  get playerRespawns(): boolean {
    return this.livesLeft(this.ctx.player.name) > 0;
  }

  start(): void {
    for (const c of this.ctx.combatants()) this.ctx.loadout(c, ['pistol'], { ammo: 1, reserve: 0, grenades: 0 });
    rules.damage = () => 999;
    rules.grenades = () => false;
    this.off = events.on('kill', (e) => {
      if (e.killer !== e.victim) this.giveBullet(e.killer, 1);
      if (this.livesLeft(e.victim) === 0) this.outOrder.push(e.victim);
    });
    this.ctx.announce('One in the Chamber', `One bullet, every hit kills, ${this.lives} lives`, 3);
  }

  dispose(): void {
    this.off();
  }

  private ammoOf(c: Combatant): number {
    if (c === this.ctx.player) return this.ctx.weapons.weapons.find((w) => w.id === 'pistol')!.ammo;
    return (c as Bot).weapon.ammo;
  }

  private giveBullet(name: string, n: number): void {
    const c = this.ctx.combatants().find((x) => x.name === name);
    if (!c || !c.isAlive()) return;
    if (c === this.ctx.player) this.ctx.weapons.weapons.find((w) => w.id === 'pistol')!.ammo += n;
    else (c as Bot).weapon.ammo += n;
    this.empty.set(name, 0);
  }

  update(dt: number): void {
    // Bots with lives left come back once their death is over.
    for (const b of this.ctx.bots.bots) {
      if (!b.isAlive() && !b.model.root.visible && this.livesLeft(b.name) > 0) this.ctx.respawn(b);
    }
    // An empty gun refills by itself after a while.
    for (const c of this.ctx.combatants()) {
      if (!c.isAlive() || this.ammoOf(c) > 0) {
        this.empty.set(c.name, 0);
        continue;
      }
      const t = (this.empty.get(c.name) ?? 0) + dt;
      this.empty.set(c.name, t);
      if (t >= EMPTY_REFILL) this.giveBullet(c.name, 1);
    }

    if (this.result) return;
    const standing = this.ctx.combatants().filter((c) => this.livesLeft(c.name) > 0);
    const youIn = this.livesLeft(this.ctx.player.name) > 0;
    const timeUp = this.ctx.time >= TIME_LIMIT;
    if (youIn && standing.length > 1 && !timeUp) return;
    const me = this.scoreboard().find((r) => r.isPlayer)!;
    let title: string;
    let win: boolean;
    if (!youIn) {
      win = false;
      const place = standing.length + 1;
      title = `You're out: ${place}${place === 2 ? 'nd' : place === 3 ? 'rd' : 'th'} place`;
    } else if (standing.length === 1) {
      win = true;
      title = 'Last one standing!';
    } else {
      // Time up: most lives left, then most kills (you win ties).
      const rows = this.scoreboard();
      win = rows[0].isPlayer || (rows[0].score === me.score && rows[0].kills === me.kills);
      title = win ? 'You win on lives!' : `${rows[0].name} wins on lives`;
    }
    this.result = {
      title,
      subtitle: timeUp && youIn && standing.length > 1 ? 'Time is up' : 'One in the Chamber',
      win,
      stats: [`Your kills: ${me.kills}`, `Lives left: ${this.livesLeft(me.name)} of ${this.lives}`, `Match time: ${formatTime(this.ctx.time)}`],
    };
  }

  status(): string {
    const standing = this.ctx.combatants().filter((c) => this.livesLeft(c.name) > 0).length;
    const me = this.ctx.player;
    const empty = me.isAlive() && this.ammoOf(me) === 0 ? `  ·  Bullet back in ${Math.ceil(EMPTY_REFILL - (this.empty.get(me.name) ?? 0))}` : '';
    return `Lives ${this.livesLeft(me.name)}  ·  ${standing} still in${empty}  ·  ${formatTime(TIME_LIMIT - this.ctx.time)}`;
  }

  scoreboard(): ScoreRow[] {
    return scoreRows(this.ctx, (n) => this.livesLeft(n));
  }
}
