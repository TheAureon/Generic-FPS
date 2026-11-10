import * as THREE from 'three';
import { PARTY_MODES, type WeaponId } from '../config';
import { events } from '../core/events';
import { rules } from '../core/MatchRules';
import type { Bot } from '../bots/Bot';
import {
  formatTime, modeLimit, scoreRows, TIME_LIMIT,
  type BotObjective, type Combatant, type GameMode, type Marker, type MatchResult, type ModeContext, type ProgressInfo, type ScoreRow,
} from './GameMode';

const J = PARTY_MODES.juggernaut;
/** Seconds before the first Juggernaut is picked. */
const GRACE = 5;
const GLOW = new THREE.Color(0.08, 0.03, 0.0);
/** Points per second as the Juggernaut (given when your reign ends). */
const POINTS_PER_SECOND = 10;

/**
 * Juggernaut: one fighter is the Juggernaut: heavily armored, slower, with an
 * LMG and plenty of ammo. Everyone else hunts them. Whoever kills the
 * Juggernaut becomes the next one. Every second as the Juggernaut scores a
 * point; first to the limit wins.
 */
export class Juggernaut implements GameMode {
  readonly id = 'juggernaut' as const;
  readonly name = 'Juggernaut';
  readonly teams = false;
  readonly freeForAll = true;
  readonly botsRespawn = true;
  readonly playerRespawns = true;
  readonly scoreLabel = 'Seconds';
  result: MatchResult | null = null;
  private jugg: Combatant | null = null;
  private since = 0;
  private time = new Map<string, number>();
  private originalGun = new Map<string, WeaponId>();
  private off: () => void = () => {};

  constructor(private ctx: ModeContext) {}

  get initialBots(): number {
    return this.ctx.config.botCount;
  }

  private get limit(): number {
    return modeLimit(this.ctx.config);
  }

  start(): void {
    for (const b of this.ctx.bots.bots) this.originalGun.set(b.name, b.weapon.id);
    rules.damage = (_a, victim, amount) => (this.jugg && victim === this.jugg.name ? amount * J.armor : amount);
    rules.speed = (name) => (this.jugg && name === this.jugg.name ? J.speed : 1);
    rules.grenades = (name) => !this.jugg || name !== this.jugg.name;
    this.off = events.on('kill', (e) => {
      if (!this.jugg || e.victim !== this.jugg.name || this.result) return;
      const killer = this.ctx.combatants().find((c) => c.name === e.killer && c.name !== e.victim);
      this.crown(killer ?? null);
    });
    this.ctx.announce('Juggernaut', `Kill the Juggernaut to become it. ${this.limit} seconds as it wins`, 3);
  }

  dispose(): void {
    this.off();
  }

  /** Make someone the Juggernaut (null: a random fighter). */
  private crown(next: Combatant | null): void {
    const prev = this.jugg;
    if (prev) {
      const held = this.ctx.time - this.since;
      if (prev === this.ctx.player) this.ctx.award(`Juggernaut for ${Math.round(held)} s`, Math.round(held * POINTS_PER_SECOND));
      if (prev === this.ctx.player) this.ctx.loadout(prev, null);
      else {
        (prev as Bot).tint = null;
        this.ctx.loadout(prev, [this.originalGun.get(prev.name) ?? 'rifle']);
      }
    }
    if (!next) {
      const pool = this.ctx.combatants().filter((c) => c.isAlive() && c !== prev);
      next = pool[Math.floor(Math.random() * pool.length)] ?? null;
    }
    this.jugg = next;
    this.since = this.ctx.time;
    if (!next) return;
    this.ctx.loadout(next, ['lmg'], { ammo: 100, reserve: 400, grenades: 0 });
    if (next === this.ctx.player) {
      this.ctx.announce("You're the Juggernaut", 'Heavy armor. Survive as long as you can', 2.2);
      this.ctx.cue('good');
    } else {
      (next as Bot).tint = GLOW;
      this.ctx.announce(`${next.name} is the Juggernaut`, 'Take them down', 1.8);
      this.ctx.cue('info');
    }
  }

  update(dt: number): void {
    if (this.result) return;
    if (!this.jugg && this.ctx.time >= GRACE) {
      const bots = this.ctx.bots.bots.filter((b) => b.isAlive());
      this.crown(bots[Math.floor(Math.random() * bots.length)] ?? null);
    }
    const j = this.jugg;
    if (j && j.isAlive()) this.time.set(j.name, (this.time.get(j.name) ?? 0) + dt);
    // A Juggernaut who died some other way (fell...) passes the role on.
    if (j && !j.isAlive() && this.ctx.time - this.since > 1) this.crown(null);

    const rows = this.scoreboard();
    const top = rows[0];
    const timeUp = this.ctx.time >= TIME_LIMIT;
    if ((top.score ?? 0) < this.limit && !timeUp) return;
    if (this.jugg === this.ctx.player) this.ctx.award(`Juggernaut for ${Math.round(this.ctx.time - this.since)} s`, Math.round((this.ctx.time - this.since) * POINTS_PER_SECOND));
    const me = rows.find((r) => r.isPlayer)!;
    const winner = (me.score ?? 0) >= (top.score ?? 0) ? me : top;
    this.result = {
      title: winner.isPlayer ? 'You win!' : `${winner.name} wins`,
      subtitle: timeUp && (top.score ?? 0) < this.limit ? 'Time is up' : `First to ${this.limit} seconds as the Juggernaut`,
      win: winner.isPlayer,
      stats: [`Your time as the Juggernaut: ${me.score ?? 0} s`, `Your kills: ${me.kills}`, `Match time: ${formatTime(this.ctx.time)}`],
    };
  }

  markers(): Marker[] {
    const j = this.jugg;
    if (!j || !j.isAlive() || j === this.ctx.player) return [];
    return [{ x: j.position.x, y: j.position.y + 2.3, z: j.position.z, label: 'J', color: '#ff8a30', always: true }];
  }

  progress(): ProgressInfo | null {
    if (this.jugg !== this.ctx.player) return null;
    return { label: 'You are the Juggernaut', value: Math.min(1, (this.time.get(this.ctx.player.name) ?? 0) / this.limit), color: '#ff8a30' };
  }

  /** Everyone else hunts the Juggernaut. */
  botObjective(bot: Bot): BotObjective | null {
    const j = this.jugg;
    if (!j || j === bot || !j.isAlive()) return null;
    return { pos: j.position.clone(), radius: 6, run: true };
  }

  status(): string {
    const j = this.jugg;
    const me = Math.floor(this.time.get(this.ctx.player.name) ?? 0);
    const who = !j ? `Juggernaut in ${Math.max(0, Math.ceil(GRACE - this.ctx.time))}…` : j === this.ctx.player ? 'You are the Juggernaut!' : `Juggernaut: ${j.name}`;
    return `${who}  ·  You ${me}/${this.limit} s  ·  ${formatTime(TIME_LIMIT - this.ctx.time)}`;
  }

  scoreboard(): ScoreRow[] {
    return scoreRows(this.ctx, (n) => this.time.get(n) ?? 0);
  }
}
