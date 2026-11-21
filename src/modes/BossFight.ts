import * as THREE from 'three';
import { BOT_DIFFICULTY, PARTY_MODES } from '../config';
import { events } from '../core/events';
import { rules } from '../core/MatchRules';
import type { Bot } from '../bots/Bot';
import { formatTime, scoreRows, type BotObjective, type GameMode, type MatchResult, type ModeContext, type ProgressInfo, type ScoreRow } from './GameMode';

const B = PARTY_MODES.boss;
const NAME = 'The Titan';
/** A deep red glow on the Titan, and a faint one on its minions. */
const GLOW = new THREE.Color(0x3a0606);
const MINION_GLOW = new THREE.Color(0x200404);

/**
 * Boss Fight: one giant armored bot, the Titan, with a health bar at the
 * top of the screen. It has three phases: at two thirds of its health it
 * calls in minions and switches to a minigun; at one third it calls more
 * and gets angry (faster, more accurate). You have a few lives.
 */
export class BossFight implements GameMode {
  readonly id = 'boss' as const;
  readonly name = 'Boss Fight';
  readonly teams = false;
  readonly freeForAll = false;
  readonly botsRespawn = false;
  readonly noKillstreaks = false;
  result: MatchResult | null = null;
  private phase = 1;
  private lives = B.lives;
  private off: () => void = () => {};

  constructor(private ctx: ModeContext) {}

  get initialBots(): number {
    return 1;
  }

  get playerRespawns(): boolean {
    return this.lives > 0;
  }

  get noRespawnNote(): string {
    return 'Out of lives';
  }

  private get boss(): Bot {
    return this.ctx.bots.bots[0];
  }

  start(): void {
    const t = this.boss;
    (t as { name: string }).name = NAME;
    // Twice as tall, with a hit shape to match.
    t.model.root.scale.setScalar(B.scale);
    t.hitbox.height = 1.8 * B.scale;
    t.hitbox.radius = 0.3 * B.scale;
    t.hitbox.headRadius = 0.16 * B.scale;
    t.tint = GLOW;
    t.grenadesPerLife = 3;
    t.skill = { ...BOT_DIFFICULTY[this.ctx.config.difficulty], aggression: 0.8, damageMultiplier: B.damage, burstSize: [8, 16] };
    this.ctx.loadout(t, ['lmg'], { ammo: 999, reserve: 999, grenades: 3 });
    // It shrugs off most of each hit (its health is worth `toughness` normal ones).
    rules.damage = (_a, victim, amount) => (victim === NAME ? amount / B.toughness : amount);
    rules.speed = (name) => (name === NAME ? (this.phase === 3 ? 1.15 : 0.8) : 1);
    this.off = events.on('kill', (e) => {
      if (e.victim === this.ctx.player.name) {
        this.lives--;
        if (this.lives > 0) this.ctx.announce(`${this.lives} ${this.lives === 1 ? 'life' : 'lives'} left`, '', 1.8);
      }
    });
    this.ctx.announce('The Titan', 'Bring it down. It gets nastier as it weakens.', 3);
    this.ctx.cue('bad');
  }

  dispose(): void {
    this.off();
  }

  /** Two more phases: minions, a bigger gun, and (at the end) rage. */
  private nextPhase(): void {
    this.phase++;
    const t = this.boss;
    const diff = this.ctx.config.difficulty;
    const before = this.ctx.bots.bots.length;
    this.ctx.bots.spawnBots(this.phase === 2 ? B.minions[0] : B.minions[1], diff);
    for (const m of this.ctx.bots.bots.slice(before)) {
      m.tint = MINION_GLOW;
      m.grenadesPerLife = 0;
    }
    if (this.phase === 2) {
      this.ctx.loadout(t, ['minigun'], { ammo: 999, reserve: 999, grenades: 3 });
      this.ctx.announce('Phase 2', 'The Titan calls for backup and brings out the minigun', 2.5);
    } else {
      const base = BOT_DIFFICULTY[diff];
      t.skill = { ...t.skill, aimError: base.aimError * 0.7, reactionTime: base.reactionTime * 0.7, burstPause: [0.1, 0.25] };
      this.ctx.announce('Phase 3: Enraged', 'More backup, and the Titan is faster and deadlier', 2.5);
    }
    this.ctx.cue('bad');
  }

  update(): void {
    if (this.result) return;
    const t = this.boss;
    if (!t.isAlive()) {
      const me = this.scoreboard().find((r) => r.isPlayer)!;
      this.ctx.award('Brought down the Titan', 1000);
      this.result = { title: 'The Titan falls!', subtitle: `Beaten in ${formatTime(this.ctx.time)}`, win: true, stats: [`Lives left: ${this.lives}`, `Your kills: ${me.kills}`, `Time: ${formatTime(this.ctx.time)}`] };
      return;
    }
    if ((this.phase === 1 && t.health < 66) || (this.phase === 2 && t.health < 33)) this.nextPhase();
    if (this.lives <= 0 && !this.ctx.player.isAlive()) {
      this.result = { title: 'Crushed by the Titan', subtitle: `It had ${Math.ceil(t.health)}% of its health left`, win: false, stats: [`Phase reached: ${this.phase} of 3`, `Time: ${formatTime(this.ctx.time)}`] };
    }
  }

  status(): string {
    return `Boss Fight  ·  Phase ${this.phase}/3  ·  Lives ${this.lives}  ·  ${formatTime(this.ctx.time)}`;
  }

  /** The Titan's health bar. */
  progress(): ProgressInfo | null {
    const t = this.boss;
    return { label: `The Titan  ·  ${Math.ceil(Math.max(0, t.health))}%`, value: Math.max(0, t.health) / 100, color: this.phase === 3 ? '#ff4a3a' : '#e0703a' };
  }

  botObjective(bot: Bot): BotObjective | null {
    const me = this.ctx.player;
    if (!me.isAlive()) return null;
    // The Titan stomps toward you; minions rush.
    return bot === this.boss ? { pos: me.position.clone(), radius: 10 } : { pos: me.position.clone(), radius: 4, run: true, urgent: me.position.distanceTo(bot.position) > 15 };
  }

  scoreboard(): ScoreRow[] {
    return scoreRows(this.ctx);
  }
}
