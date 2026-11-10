import * as THREE from 'three';
import { PARTY_MODES } from '../config';
import { events } from '../core/events';
import { rules } from '../core/MatchRules';
import type { Bot } from '../bots/Bot';
import { formatTime, modeLimit, scoreRows, type BotObjective, type Combatant, type GameMode, type MatchResult, type ModeContext, type ScoreRow } from './GameMode';

const I = PARTY_MODES.infected;
const SURVIVORS = 0;
const INFECTED = 1;
/** Seconds before the first bot turns. */
const GRACE = 6;
/** The infected glow a sickly green. */
const GLOW = new THREE.Color(0.05, 0.28, 0.04);

/**
 * Infected: everyone starts as a survivor (Blue). A few seconds in, one bot
 * turns: the infected (Red) are faster, carry only a shotgun and no
 * grenades. Anyone they kill turns too. Survivors win if anyone is still
 * human when time runs out; the infected win if they get everyone.
 */
export class Infected implements GameMode {
  readonly id = 'infected' as const;
  readonly name = 'Infected';
  readonly teams = true;
  readonly freeForAll = false;
  readonly botsRespawn = true;
  readonly playerRespawns = true;
  readonly scoreLabel = 'Infections';
  result: MatchResult | null = null;
  private started = false;
  private infections = new Map<string, number>();
  private off: () => void = () => {};
  private youTurnedAt = -1;

  constructor(private ctx: ModeContext) {}

  get initialBots(): number {
    return this.ctx.config.botCount;
  }

  teamOf(): number {
    return SURVIVORS;
  }

  /** Seconds the survivors must last. */
  private get timeLimit(): number {
    return modeLimit(this.ctx.config) * 60;
  }

  private infected(c: Combatant): boolean {
    return c.team === INFECTED;
  }

  start(): void {
    const isInfected = (name: string) => this.ctx.combatants().find((c) => c.name === name)?.team === INFECTED;
    rules.speed = (name) => (isInfected(name) ? I.infectedSpeed : 1);
    rules.grenades = (name) => !isInfected(name);
    this.off = events.on('kill', (e) => {
      const v = this.ctx.combatants().find((c) => c.name === e.victim);
      if (!v || this.infected(v) || this.result) return;
      // A survivor went down: they come back infected.
      if (e.killer !== e.victim && isInfected(e.killer)) this.infections.set(e.killer, (this.infections.get(e.killer) ?? 0) + 1);
      this.turn(v);
    });
    this.ctx.announce('Infected', `Survive ${modeLimit(this.ctx.config)} minutes. Someone turns in ${GRACE} seconds…`, 3);
  }

  dispose(): void {
    this.off();
  }

  /** Make someone infected. */
  private turn(c: Combatant): void {
    c.team = INFECTED;
    this.ctx.loadout(c, ['shotgun'], { grenades: 0 });
    if (c === this.ctx.player) {
      this.youTurnedAt = this.ctx.time;
      this.ctx.announce("You're infected", 'Hunt down the survivors', 2.5);
      this.ctx.cue('bad');
    } else {
      (c as Bot).tint = GLOW;
    }
    this.ctx.refreshTeams();
  }

  private survivors(): Combatant[] {
    return this.ctx.combatants().filter((c) => c.team === SURVIVORS);
  }

  teamScores(): [number, number] {
    const all = this.ctx.combatants();
    return [all.filter((c) => c.team === SURVIVORS).length, all.filter((c) => c.team === INFECTED).length];
  }

  update(): void {
    if (this.result) return;
    if (!this.started && this.ctx.time >= GRACE) {
      this.started = true;
      const bots = this.ctx.bots.bots.filter((b) => b.isAlive());
      const first = bots[Math.floor(Math.random() * bots.length)];
      if (first) {
        this.turn(first);
        this.ctx.announce(`${first.name} is infected!`, 'Stay alive', 2);
        this.ctx.cue('bad');
      }
    }
    if (!this.started) return;
    const left = this.survivors();
    const timeUp = this.ctx.time >= this.timeLimit;
    if (left.length > 0 && !timeUp) return;
    const me = this.scoreboard().find((r) => r.isPlayer)!;
    const youSurvived = this.ctx.player.team === SURVIVORS;
    const survivorsWin = left.length > 0;
    if (youSurvived) this.ctx.award('Survived the infection', 500);
    this.result = {
      title: survivorsWin ? (youSurvived ? 'You survived!' : 'The survivors held out') : youSurvived ? 'Infected' : 'The infection wins!',
      subtitle: survivorsWin ? `${left.length} survivor${left.length === 1 ? '' : 's'} left when time ran out` : 'Everyone was infected',
      // You win with whichever side you were on at the end.
      win: survivorsWin === youSurvived,
      stats: [
        youSurvived ? 'You were never infected' : `You turned at ${formatTime(this.youTurnedAt)}`,
        `Your kills: ${me.kills}`,
        `Your infections: ${this.infections.get(me.name) ?? 0}`,
        `Match time: ${formatTime(this.ctx.time)}`,
      ],
    };
  }

  /** The infected chase the nearest survivor; survivors just fight. */
  botObjective(bot: Bot): BotObjective | null {
    if (!this.started || bot.team !== INFECTED) return null;
    let best: Combatant | null = null;
    let bestD = Infinity;
    for (const c of this.survivors()) {
      if (!c.isAlive()) continue;
      const d = bot.position.distanceTo(c.position);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best ? { pos: best.position.clone(), radius: 1.5, run: true, urgent: bestD > 12 } : null;
  }

  status(): string {
    const [s, i] = this.teamScores();
    const t = formatTime(Math.min(this.timeLimit, this.timeLimit - this.ctx.time));
    if (!this.started) return `Infection in ${Math.ceil(GRACE - this.ctx.time)}…  ·  ${t}`;
    const you = this.ctx.player.team === INFECTED ? 'You are infected' : 'Stay alive';
    return `Survivors ${s}  ·  Infected ${i}  ·  ${you}  ·  ${t}`;
  }

  scoreboard(): ScoreRow[] {
    return scoreRows(this.ctx, (n) => this.infections.get(n) ?? 0);
  }
}
