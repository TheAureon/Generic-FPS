import { REWARDS } from '../config';

/**
 * Your career: level, XP and lifetime stats, saved in this browser (so they
 * survive closing the game). If the browser won't save (private window),
 * everything still works, it just starts fresh next time.
 */
export interface Career {
  xp: number;
  matches: number;
  wins: number;
  kills: number;
  deaths: number;
  headshots: number;
  bestStreak: number;
  medals: Record<string, number>;
}

/** Rank names, one per 3 levels (the last one keeps going). */
const RANKS = [
  'Recruit', 'Private', 'Corporal', 'Sergeant', 'Staff Sergeant', 'Lieutenant',
  'Captain', 'Major', 'Colonel', 'Brigadier', 'General', 'Legend',
];

const KEY = 'generic-fps.career.v1';

function empty(): Career {
  return { xp: 0, matches: 0, wins: 0, kills: 0, deaths: 0, headshots: 0, bestStreak: 0, medals: {} };
}

/** XP needed to go from `level` to the next one. */
export function xpForLevel(level: number): number {
  return REWARDS.levelBaseXp + REWARDS.perLevel * (level - 1);
}

/** Level (from 1), XP into that level, and XP needed for the next. */
export function levelInfo(xp: number): { level: number; into: number; need: number; rank: string; rankTier: number } {
  let level = 1, rest = Math.max(0, xp);
  while (rest >= xpForLevel(level)) {
    rest -= xpForLevel(level);
    level++;
  }
  const tier = Math.min(RANKS.length - 1, Math.floor((level - 1) / 3));
  return { level, into: rest, need: xpForLevel(level), rank: RANKS[tier], rankTier: tier };
}

class Progress {
  private data: Career = empty();

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = { ...empty(), ...JSON.parse(raw) };
    } catch {
      // No saving in this browser: start fresh.
    }
  }

  get(): Readonly<Career> {
    return this.data;
  }

  /** Add a finished match. Returns the career before and after. */
  record(m: { xp: number; win: boolean; kills: number; deaths: number; headshots: number; bestStreak: number; medals: Record<string, number> }): { before: Career; after: Career } {
    const before = structuredClone(this.data);
    const d = this.data;
    d.xp += m.xp;
    d.matches++;
    if (m.win) d.wins++;
    d.kills += m.kills;
    d.deaths += m.deaths;
    d.headshots += m.headshots;
    d.bestStreak = Math.max(d.bestStreak, m.bestStreak);
    for (const [id, n] of Object.entries(m.medals)) d.medals[id] = (d.medals[id] ?? 0) + n;
    try {
      localStorage.setItem(KEY, JSON.stringify(d));
    } catch {
      // Couldn't save; keep going.
    }
    return { before, after: structuredClone(d) };
  }
}

export const progress = new Progress();
