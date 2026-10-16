import type { BotManager } from '../bots/BotManager';
import type { Difficulty } from '../config';
import type { Player } from '../player/Player';

export type ModeId = 'deathmatch' | 'survival';

/** Everything chosen in the match menu. */
export interface MatchConfig {
  mode: ModeId;
  map: string;
  difficulty: Difficulty;
  botCount: number;
  /** Deathmatch only. */
  killLimit: number;
}

export interface ScoreRow {
  name: string;
  kills: number;
  deaths: number;
  isPlayer: boolean;
}

export interface MatchResult {
  title: string;
  subtitle: string;
  /** Did the player win (for the sound and colors)? */
  win: boolean;
  /** Extra lines for the end screen (e.g. "Waves survived: 4"). */
  stats: string[];
}

/** What a mode can see and do in the match. */
export interface ModeContext {
  config: MatchConfig;
  bots: BotManager;
  player: Player;
  /** Kills and deaths so far, by name. */
  kills: Map<string, number>;
  deaths: Map<string, number>;
  /** Seconds since the match started. */
  readonly time: number;
  /** Big message in the middle of the screen. */
  announce(title: string, subtitle?: string, seconds?: number): void;
}

/** A game mode: sets up the match, keeps score, and decides when it's over. */
export interface GameMode {
  readonly id: ModeId;
  readonly name: string;
  /** Do bots also fight each other? */
  readonly freeForAll: boolean;
  /** Do bots come back after dying? */
  readonly botsRespawn: boolean;
  /** Does the player come back after dying? */
  readonly playerRespawns: boolean;
  /** How many bots to create at the start. */
  readonly initialBots: number;
  start(): void;
  update(dt: number): void;
  /** One line for the top of the screen. */
  status(): string;
  scoreboard(): ScoreRow[];
  /** Set once the match is over. */
  result: MatchResult | null;
}

/** Score table sorted by kills (then fewest deaths). */
export function scoreRows(ctx: ModeContext): ScoreRow[] {
  const names = [ctx.player.name, ...ctx.bots.bots.map((b) => b.name)];
  return names
    .map((name) => ({
      name,
      kills: ctx.kills.get(name) ?? 0,
      deaths: ctx.deaths.get(name) ?? 0,
      isPlayer: name === ctx.player.name,
    }))
    .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
