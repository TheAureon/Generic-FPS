import type * as THREE from 'three';
import type { BotManager } from '../bots/BotManager';
import type { Bot } from '../bots/Bot';
import type { NavGraph } from '../bots/NavGraph';
import { MATCH, MODES, TEAMS, type Difficulty } from '../config';
import type { CollisionWorld } from '../core/CollisionWorld';
import type { Damageable } from '../core/Hitbox';
import type { MapDef, SpawnPoint } from '../map/MapTypes';
import type { Player, Trackable } from '../player/Player';

export type ModeId = 'deathmatch' | 'tdm' | 'koh' | 'coh' | 'ctf' | 'control' | 'br' | 'survival';

/** Everything chosen in the match menu. */
export interface MatchConfig {
  mode: ModeId;
  map: string;
  difficulty: Difficulty;
  botCount: number;
  /** Free for All: kills to win. */
  killLimit: number;
  /** The other modes' win conditions (team kills, seconds in the hill, captures, points), by mode. */
  limits?: Partial<Record<ModeId, number>>;
}

/** What it takes to win this mode (from the menu choice, or the mode's default). */
export function modeLimit(cfg: MatchConfig): number {
  if (cfg.mode === 'deathmatch') return cfg.killLimit;
  const m = MODES[cfg.mode as keyof typeof MODES] as { defaultLimit?: number } | undefined;
  return cfg.limits?.[cfg.mode] ?? m?.defaultLimit ?? 0;
}

export interface ScoreRow {
  name: string;
  kills: number;
  deaths: number;
  isPlayer: boolean;
  /** Team modes: 0 = Blue, 1 = Red. */
  team?: number;
  /** Objective score (seconds in the hill, captures...), if the mode has one. */
  score?: number;
}

export interface MatchResult {
  title: string;
  subtitle: string;
  /** Did the player win (for the sound and colors)? */
  win: boolean;
  /** Extra lines for the end screen (e.g. "Waves survived: 4"). */
  stats: string[];
}

/** Anyone in the fight: the player or a bot. */
export type Combatant = Trackable & Damageable & { team: number | null };

/** A spot shown on screen (and on the radar): a hill, a zone, a flag. */
export interface Marker {
  x: number;
  y: number;
  z: number;
  /** Short label in the marker ("A", a flag icon...). */
  label: string;
  /** CSS color. */
  color: string;
  /** Also show it when it's off screen (clamped to the edge). */
  always?: boolean;
  /** Radar: draw as a circle of this radius (meters) instead of a dot. */
  radius?: number;
}

/** What a bot should do for the mode when it isn't busy fighting. */
export interface BotObjective {
  pos: THREE.Vector3;
  /** Close enough counts as "there": then it moves around inside this radius. */
  radius: number;
  /** Go now: ignore sounds, don't hide, keep moving toward it even while shooting. */
  urgent?: boolean;
  /** Run instead of walk. */
  run?: boolean;
}

/** The bar under the status line (e.g. "Capturing B"). */
export interface ProgressInfo {
  label: string;
  /** 0..1, or null for a label without a bar. */
  value: number | null;
  color: string;
}

/** What a mode can see and do in the match. */
export interface ModeContext {
  config: MatchConfig;
  bots: BotManager;
  player: Player;
  /** Player + bots. */
  combatants(): Combatant[];
  /** Kills and deaths so far, by name. */
  kills: Map<string, number>;
  deaths: Map<string, number>;
  /** Seconds since the match started. */
  readonly time: number;
  scene: THREE.Scene;
  world: CollisionWorld;
  nav: NavGraph;
  map: MapDef;
  /** The reachable part of the map. */
  playBounds: THREE.Box3;
  /** Team modes: each team's spawn points (Blue's, Red's). */
  sides: [SpawnPoint[], SpawnPoint[]];
  /** Big message in the middle of the screen. */
  announce(title: string, subtitle?: string, seconds?: number): void;
  /** A short sound cue. */
  cue(kind: 'good' | 'bad' | 'info'): void;
}

/** A game mode: sets up the match, keeps score, and decides when it's over. */
export interface GameMode {
  readonly id: ModeId;
  readonly name: string;
  /** Teams (Blue vs Red)? Otherwise everyone fights everyone (or, in Survival, the bots fight you). */
  readonly teams: boolean;
  /** Do bots also fight each other (free for all)? */
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
  /** Name of the objective score column on the scoreboard, if any. */
  readonly scoreLabel?: string;
  /** Team modes: Blue's and Red's scores. */
  teamScores?(): [number, number];
  /** Hills, zones, flags to show on screen and on the radar. */
  markers?(): Marker[];
  /** The bar under the status line, if there's something to show. */
  progress?(): ProgressInfo | null;
  /** What a bot should go and do. */
  botObjective?(bot: Bot): BotObjective | null;
  /** Shown on the death screen when you can't respawn. */
  readonly noRespawnNote?: string;
  /** Set once the match is over. */
  result: MatchResult | null;
}

/** Score table sorted by kills (then fewest deaths). */
export function scoreRows(ctx: ModeContext, score?: (name: string) => number): ScoreRow[] {
  return ctx
    .combatants()
    .map((c) => ({
      name: c.name,
      kills: ctx.kills.get(c.name) ?? 0,
      deaths: ctx.deaths.get(c.name) ?? 0,
      isPlayer: c === (ctx.player as Combatant),
      ...(c.team !== null ? { team: c.team } : {}),
      ...(score ? { score: Math.floor(score(c.name)) } : {}),
    }))
    .sort((a, b) => (score ? (b.score ?? 0) - (a.score ?? 0) : 0) || b.kills - a.kills || a.deaths - b.deaths);
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const TIME_LIMIT = MATCH.timeLimitMinutes * 60;

/** "Blue 12  ·  Red 9" for the status bar. */
export function teamLine(scores: [number, number]): string {
  return `${TEAMS.names[0]} ${Math.floor(scores[0])}  ·  ${TEAMS.names[1]} ${Math.floor(scores[1])}`;
}

/** End of a team match: who won (Blue is your team). */
export function teamResult(scores: [number, number], timeUp: boolean, what: string, stats: string[]): MatchResult {
  const [b, r] = scores.map(Math.floor);
  const sub = `${TEAMS.names[0]} ${b} – ${r} ${TEAMS.names[1]}${timeUp ? '  ·  Time is up' : ''}`;
  if (b === r) return { title: 'Draw', subtitle: sub, win: false, stats };
  return b > r
    ? { title: 'Your team wins!', subtitle: sub, win: true, stats }
    : { title: `${TEAMS.names[1]} team wins`, subtitle: `${sub}${what ? `  ·  ${what}` : ''}`, win: false, stats };
}
