import { BOT_DIFFICULTY, SURVIVAL } from '../config';
import { audio } from '../audio/AudioEngine';
import { formatTime, scoreRows, type GameMode, type MatchResult, type ModeContext, type ScoreRow } from './GameMode';

type Skill = (typeof BOT_DIFFICULTY)['normal'];

/**
 * Survival: waves of bots, each bigger and tougher than the last. All bots
 * hunt you. You have one life; clear a wave to get some health back.
 */
export class Survival implements GameMode {
  readonly id = 'survival' as const;
  readonly name = 'Survival';
  readonly freeForAll = false;
  readonly botsRespawn = false;
  readonly playerRespawns = false;
  result: MatchResult | null = null;

  private wave = 0;
  private waveActive = false;
  private intermission = 3;
  private deadTimer = 0;

  constructor(private ctx: ModeContext) {}

  /** Bots are created for the first wave in start(). */
  get initialBots(): number {
    return 0;
  }

  private waveSize(wave: number): number {
    return Math.min(SURVIVAL.maxBots, this.ctx.config.botCount + (wave - 1) * SURVIVAL.extraBotsPerWave);
  }

  start(): void {
    this.ctx.announce('Survival', 'Survive as many waves as you can', 3);
  }

  update(dt: number): void {
    if (this.result) return;
    const { player, bots } = this.ctx;

    // Game over a moment after the player dies (so the death is visible).
    if (!player.isAlive()) {
      this.deadTimer += dt;
      if (this.deadTimer > 2.5) {
        const kills = this.ctx.kills.get(player.name) ?? 0;
        const cleared = this.waveActive ? this.wave - 1 : this.wave;
        this.result = {
          title: 'Game over',
          subtitle: `You survived ${cleared} wave${cleared === 1 ? '' : 's'}`,
          win: false,
          stats: [`Reached wave ${this.wave}`, `Kills: ${kills}`, `Time: ${formatTime(this.ctx.time)}`],
        };
      }
      return;
    }

    if (this.waveActive) {
      if (bots.aliveCount === 0) {
        this.waveActive = false;
        this.intermission = SURVIVAL.intermission;
        player.heal(SURVIVAL.healOnWaveClear);
        this.ctx.announce(`Wave ${this.wave} cleared`, `+${SURVIVAL.healOnWaveClear} health`, 3);
      }
      return;
    }

    this.intermission -= dt;
    if (this.intermission <= 0) this.startWave(this.wave + 1);
  }

  private startWave(n: number): void {
    const { bots, config } = this.ctx;
    this.wave = n;
    this.waveActive = true;
    const size = this.waveSize(n);
    const skill = this.waveSkill(n);

    // Create more bots if needed, then bring `size` of them into the fight.
    if (bots.bots.length < size) bots.spawnBots(size - bots.bots.length, config.difficulty);
    for (let i = 0; i < bots.bots.length; i++) {
      if (i < size) bots.revive(i, skill);
    }
    audio.play('wave_start');
    this.ctx.announce(`Wave ${n}`, `${size} enem${size === 1 ? 'y' : 'ies'} incoming`, 2.5);
  }

  /**
   * Bot skill for a wave: starts at the chosen difficulty and moves toward
   * "harder than Hard" over the first few waves.
   */
  private waveSkill(n: number): Skill {
    const base = BOT_DIFFICULTY[this.ctx.config.difficulty];
    const hard = BOT_DIFFICULTY.hard;
    const top: Skill = { ...hard, aimError: hard.aimError * 0.85, reactionTime: hard.reactionTime * 0.85, damageMultiplier: 1.1 };
    const f = Math.min(1, (n - 1) / Math.max(1, SURVIVAL.wavesToFullStrength - 1));
    const lerp = (a: number, b: number) => a + (b - a) * f;
    return {
      reactionTime: lerp(base.reactionTime, top.reactionTime),
      aimError: lerp(base.aimError, top.aimError),
      turnSpeed: lerp(base.turnSpeed, top.turnSpeed),
      movingTargetPenalty: lerp(base.movingTargetPenalty, top.movingTargetPenalty),
      selfMovingPenalty: lerp(base.selfMovingPenalty, top.selfMovingPenalty),
      burstSize: [Math.round(lerp(base.burstSize[0], top.burstSize[0])), Math.round(lerp(base.burstSize[1], top.burstSize[1]))],
      burstPause: [lerp(base.burstPause[0], top.burstPause[0]), lerp(base.burstPause[1], top.burstPause[1])],
      aggression: lerp(base.aggression, top.aggression),
      damageMultiplier: lerp(base.damageMultiplier, top.damageMultiplier),
    };
  }

  status(): string {
    const kills = this.ctx.kills.get(this.ctx.player.name) ?? 0;
    if (!this.waveActive) {
      return this.wave === 0
        ? `Get ready  ·  First wave in ${Math.ceil(this.intermission)}`
        : `Next wave in ${Math.ceil(this.intermission)}  ·  Kills ${kills}`;
    }
    return `Wave ${this.wave}  ·  Enemies left ${this.ctx.bots.aliveCount}  ·  Kills ${kills}`;
  }

  scoreboard(): ScoreRow[] {
    return scoreRows(this.ctx);
  }
}
