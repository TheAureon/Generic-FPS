import { REWARDS, type Difficulty } from '../config';
import { ACHIEVEMENTS, ACHIEVEMENT_XP, type AchievementDef } from './Achievements';

/**
 * Your career: level, XP and lifetime stats, saved in this browser (so they
 * survive closing the game). If the browser won't save (private window),
 * everything still works, it just starts fresh next time.
 */
export interface Career {
  /** XP toward your current level (prestige resets it). */
  xp: number;
  /** All the XP you've ever earned (never resets; the UsForge leaderboard uses it). */
  lifetimeXp: number;
  matches: number;
  wins: number;
  kills: number;
  deaths: number;
  headshots: number;
  damage: number;
  bestStreak: number;
  medals: Record<string, number>;
  /** Kills per gun (and 'grenade'). */
  weaponKills: Record<string, number>;
  /** Your best single match. */
  bests: Bests;
  /** Survival: most waves cleared on each map. */
  survivalBest: Record<string, number>;
  /** Stars per map, as bits: 1 = won, 2 = won on Hard or Insane, 4 = won on Insane. */
  mapStars: Record<string, number>;
  /** Wins per mode, and matches finished per map. */
  modesWon: Record<string, number>;
  mapsFinished: Record<string, number>;
  /** Achievements earned (id → when). */
  achievements: Record<string, number>;
  /** Daily (and weekly) challenges completed. */
  challengesDone: number;
}

export interface Bests {
  score: number;
  kills: number;
  streak: number;
  longestKill: number;
  damage: number;
  multi: number;
  accuracy: number;
}

/** One finished match, as the career sees it. */
export interface MatchRecord {
  xp: number;
  win: boolean;
  kills: number;
  deaths: number;
  headshots: number;
  bestStreak: number;
  bestMulti: number;
  longestKill: number;
  damage: number;
  score: number;
  accuracy: number;
  medals: Record<string, number>;
  weaponKills: Record<string, number>;
  mode: string;
  map: string;
  difficulty: Difficulty;
  wavesCleared?: number;
}

/** What a match changed in your career (for the match report). */
export interface RecordResult {
  before: Career;
  after: Career;
  /** Personal bests beaten (and whether it's the first one set). */
  newBests: (keyof Bests)[];
  firstRecords: boolean;
  /** Achievements earned in this match, and their XP. */
  achievements: AchievementDef[];
  achievementXp: number;
  /** Map stars before and after (0..3). */
  stars: [number, number];
  /** Survival: previous best on this map, if this match beat it. */
  survivalRecord: { before: number; after: number } | null;
}

/** Rank names, one per 3 levels (the last one keeps going). */
const RANKS = [
  'Recruit', 'Private', 'Corporal', 'Sergeant', 'Staff Sergeant', 'Lieutenant',
  'Captain', 'Major', 'Colonel', 'Brigadier', 'General', 'Legend',
];

const KEY = 'generic-fps.career.v1';

function empty(): Career {
  return {
    xp: 0, lifetimeXp: 0, matches: 0, wins: 0, kills: 0, deaths: 0, headshots: 0, damage: 0, bestStreak: 0, medals: {},
    weaponKills: {}, bests: { score: 0, kills: 0, streak: 0, longestKill: 0, damage: 0, multi: 0, accuracy: 0 },
    survivalBest: {}, mapStars: {}, modesWon: {}, mapsFinished: {}, achievements: {}, challengesDone: 0,
  };
}

const stars = (mask = 0) => (mask & 1 ? 1 : 0) + (mask & 2 ? 1 : 0) + (mask & 4 ? 1 : 0);

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
      if (raw) {
        const saved = JSON.parse(raw);
        this.data = { ...empty(), ...saved, bests: { ...empty().bests, ...(saved.bests ?? {}) } };
        // Careers from before lifetime XP was kept: start it at what they have.
        this.data.lifetimeXp = Math.max(this.data.lifetimeXp, this.data.xp);
      }
    } catch {
      // No saving in this browser: start fresh.
    }
  }

  get(): Readonly<Career> {
    return this.data;
  }

  /** Add XP on its own (daily challenges finished in a match you left early). */
  addXp(xp: number): void {
    this.data.xp += xp;
    this.data.lifetimeXp += xp;
    this.save();
  }

  /** A daily (or weekly) challenge was completed. */
  challengeDone(): void {
    this.data.challengesDone++;
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // Couldn't save; keep going.
    }
  }

  /** Add a finished match: stats, records, stars, and any achievements it earned (with their XP). */
  record(m: MatchRecord): RecordResult {
    const before = structuredClone(this.data);
    const d = this.data;
    d.xp += m.xp;
    d.lifetimeXp += m.xp;
    d.matches++;
    if (m.win) d.wins++;
    d.kills += m.kills;
    d.deaths += m.deaths;
    d.headshots += m.headshots;
    d.damage += Math.round(m.damage);
    d.bestStreak = Math.max(d.bestStreak, m.bestStreak);
    for (const [id, n] of Object.entries(m.medals)) d.medals[id] = (d.medals[id] ?? 0) + n;
    for (const [w, n] of Object.entries(m.weaponKills)) d.weaponKills[w] = (d.weaponKills[w] ?? 0) + n;
    d.mapsFinished[m.map] = (d.mapsFinished[m.map] ?? 0) + 1;
    if (m.win) d.modesWon[m.mode] = (d.modesWon[m.mode] ?? 0) + 1;

    // Personal bests (accuracy only counts with at least 10 kills, so a lucky shot can't set it).
    const now: Bests = { score: m.score, kills: m.kills, streak: m.bestStreak, longestKill: Math.round(m.longestKill), damage: Math.round(m.damage), multi: m.bestMulti, accuracy: m.kills >= 10 ? m.accuracy : 0 };
    const firstRecords = before.matches === 0;
    const newBests: (keyof Bests)[] = [];
    for (const k of Object.keys(now) as (keyof Bests)[]) {
      if (now[k] > d.bests[k]) {
        if (d.bests[k] > 0 || firstRecords) newBests.push(k);
        d.bests[k] = now[k];
      }
    }

    // Map stars: a win, a win on Hard or Insane, a win on Insane.
    const starsBefore = stars(d.mapStars[m.map]);
    if (m.win) {
      let bits = 1;
      if (m.difficulty === 'hard' || m.difficulty === 'insane') bits |= 2;
      if (m.difficulty === 'insane') bits |= 4;
      d.mapStars[m.map] = (d.mapStars[m.map] ?? 0) | bits;
    }

    // Survival record on this map.
    let survivalRecord: RecordResult['survivalRecord'] = null;
    if (m.wavesCleared !== undefined && m.wavesCleared > (d.survivalBest[m.map] ?? 0)) {
      survivalRecord = { before: d.survivalBest[m.map] ?? 0, after: m.wavesCleared };
      d.survivalBest[m.map] = m.wavesCleared;
    }

    // Achievements, with their XP.
    const earned = ACHIEVEMENTS.filter((a) => !d.achievements[a.id] && a.check(d, m));
    let achievementXp = 0;
    for (const a of earned) {
      d.achievements[a.id] = Date.now();
      achievementXp += ACHIEVEMENT_XP[a.tier];
    }
    d.xp += achievementXp;
    d.lifetimeXp += achievementXp;
    this.save();
    return { before, after: structuredClone(d), newBests, firstRecords, achievements: earned, achievementXp, stars: [starsBefore, stars(d.mapStars[m.map])], survivalRecord };
  }
}

export const progress = new Progress();
