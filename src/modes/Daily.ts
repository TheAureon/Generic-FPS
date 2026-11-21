import type { Difficulty, WeaponId } from '../config';
import type { Weather } from '../core/environment';
import { rules } from '../core/MatchRules';
import { formatTime, scoreRows, type GameMode, type MatchConfig, type MatchResult, type ModeContext, type ScoreRow } from './GameMode';

/**
 * Daily Challenge: one match a day with a twist, the same for everyone on
 * that date (map, rule, difficulty, time of day and weather are picked from
 * the date). Three minutes, free for all: get as many kills as you can.
 * Your best score for the day is saved, so you can keep trying to beat it.
 */

interface Rule {
  name: string;
  info: string;
  /** Everyone carries only this gun. */
  gun?: WeaponId;
  apply?: () => void;
}

const RULES: Rule[] = [
  { name: 'Pistols at Dawn', info: 'Pistols only.', gun: 'pistol' },
  { name: 'Long Shots', info: 'Sniper rifles only.', gun: 'sniper' },
  { name: 'Glass Cannons', info: 'Every hit kills.', apply: () => (rules.damage = (_a, _v, amount) => (amount > 0 ? 999 : 0)) },
  { name: 'Heads Up', info: 'Only headshots hurt.', apply: () => (rules.damage = (_a, _v, amount, part) => (part === 'head' ? amount * 1.5 : 0)) },
  { name: 'Overdrive', info: 'Everyone moves 40% faster.', apply: () => (rules.speed = () => 1.4) },
  { name: 'Close Quarters', info: 'Shotguns only.', gun: 'shotgun' },
  { name: 'High Noon', info: 'Revolvers only.', gun: 'revolver' },
  { name: 'Silent Hunters', info: 'Crossbows only.', gun: 'crossbow' },
  { name: 'Spray and Pray', info: 'SMGs only, and everyone is a little tougher.', gun: 'smg', apply: () => (rules.damage = (_a, _v, amount) => amount * 0.75) },
];

const MAPS = ['foundry', 'office', 'museum', 'forest', 'mountains', 'flatlands', 'harbor', 'metro', 'outpost'];
const DIFFS: Difficulty[] = ['medium', 'advanced', 'hard'];
const WEATHERS: Weather[] = ['clear', 'clear', 'clear', 'rain', 'snow', 'fog'];
/** Length of the match (seconds). */
const LENGTH = 180;
const KEY = 'gfps-daily';

/** Today's date as YYYY-MM-DD (your own time zone). */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A number from the date, so the same day always gives the same challenge. */
function seed(date: string): () => number {
  let h = 2166136261;
  for (const ch of date) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0), (h ^= h >>> 13), (h >>> 0) / 4294967296);
}

export interface DailyPlan {
  date: string;
  rule: Rule;
  map: string;
  difficulty: Difficulty;
  night: boolean;
  weather: Weather;
}

export function dailyPlan(date = today()): DailyPlan {
  const r = seed(date);
  const pick = <T>(list: T[]) => list[Math.floor(r() * list.length)];
  return { date, rule: pick(RULES), map: pick(MAPS), difficulty: pick(DIFFS), night: r() < 0.25, weather: pick(WEATHERS) };
}

/** The match settings for today's challenge (replacing what was picked in the menu). */
export function dailyConfig(cfg: MatchConfig): MatchConfig {
  const p = dailyPlan();
  return { ...cfg, mode: 'daily', map: p.map, difficulty: p.difficulty, botCount: 6, night: p.night, weather: p.weather };
}

/** One line for the menu card. */
export function dailyBlurb(): string {
  const p = dailyPlan();
  const best = bestToday();
  return `Today: “${p.rule.name}” (${p.rule.info.replace(/\.$/, '')}) on ${p.map[0].toUpperCase()}${p.map.slice(1)}. 3 minutes, most kills.${best ? ` Your best today: ${best}.` : ''}`;
}

function bestToday(): number {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return s && s.date === today() ? s.best : 0;
  } catch {
    return 0;
  }
}

function saveBest(n: number): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ date: today(), best: n }));
  } catch {
    // Couldn't save.
  }
}

export class Daily implements GameMode {
  readonly id = 'daily' as const;
  readonly name = 'Daily Challenge';
  readonly teams = false;
  readonly freeForAll = true;
  readonly botsRespawn = true;
  readonly playerRespawns = true;
  readonly noKillstreaks = true;
  result: MatchResult | null = null;
  private plan = dailyPlan();

  constructor(private ctx: ModeContext) {}

  get initialBots(): number {
    return this.ctx.config.botCount;
  }

  start(): void {
    const r = this.plan.rule;
    if (r.gun) for (const c of this.ctx.combatants()) this.ctx.loadout(c, [r.gun]);
    r.apply?.();
    this.ctx.announce(`Daily: ${r.name}`, `${r.info} Most kills in 3 minutes.${bestToday() ? ` Beat ${bestToday()}!` : ''}`, 3.5);
  }

  update(): void {
    if (this.result || this.ctx.time < LENGTH) return;
    const me = this.scoreboard().find((x) => x.isPlayer)!;
    const before = bestToday();
    const best = me.kills > before;
    if (best) saveBest(me.kills);
    this.result = {
      title: best ? 'New best today!' : `${me.kills} kills`,
      subtitle: `Daily Challenge: ${this.plan.rule.name}  ·  ${best ? (before ? `beat your ${before}` : 'first try today') : `your best today: ${before}`}`,
      win: best,
      stats: [`Kills: ${me.kills}`, `Deaths: ${me.deaths}`, `Rule: ${this.plan.rule.info}`, 'A new challenge tomorrow'],
    };
  }

  status(): string {
    const me = this.scoreboard().find((x) => x.isPlayer)!;
    const best = bestToday();
    return `Daily: ${this.plan.rule.name}  ·  Kills ${me.kills}${best ? `  ·  Best today ${best}` : ''}  ·  ${formatTime(LENGTH - this.ctx.time)}`;
  }

  scoreboard(): ScoreRow[] {
    return scoreRows(this.ctx);
  }
}
