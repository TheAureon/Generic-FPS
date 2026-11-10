import { MEDALS, type MedalTier } from './Rewards';
import { MASTERY_GUNS, masteryLevel } from './Cosmetics';
import type { Career, MatchRecord } from './Progress';

/**
 * Achievements: career milestones (1,000 kills, win every mode, survive wave
 * 20...). Each is earned once, gives XP, and is announced on the match report.
 * They're checked after each match, against your updated career and the
 * match you just played.
 */
export interface AchievementDef {
  id: string;
  name: string;
  info: string;
  tier: MedalTier;
  /** Icon (see MEDAL_ICONS). */
  icon: string;
  check: (c: Career, m: MatchRecord) => boolean;
}

/** XP for an achievement of each tier. */
export const ACHIEVEMENT_XP: Record<MedalTier, number> = { bronze: 500, silver: 1000, gold: 2500, legend: 5000 };

/** Modes that can be won (Survival is about how long you last). */
export const WINNABLE_MODES = ['deathmatch', 'tdm', 'koh', 'coh', 'ctf', 'control', 'br'];
/** The party modes (Gun Game, Infected...): winning each of them is its own achievement. */
export const PARTY_MODE_IDS = ['gungame', 'killconfirmed', 'infected', 'oitc', 'headhunter', 'juggernaut'];
/** The real maps (not the test room). */
export const CAREER_MAPS = ['foundry', 'office', 'museum', 'forest', 'mountains', 'flatlands'];

/** Has every medal (of a tier) been earned at least once? */
const hasAll = (c: Career, tier?: MedalTier) => Object.entries(MEDALS).filter(([, m]) => !tier || m.tier === tier).every(([id]) => (c.medals[id] ?? 0) > 0);
const count = (rec: Record<string, number>) => Object.values(rec).reduce((a, b) => a + b, 0);
/** Stars on a map: 1 for a win, 2 for a win on Hard or harder, 3 for a win on Insane. */
export const starCount = (mask = 0) => (mask & 1 ? 1 : 0) + (mask & 2 ? 1 : 0) + (mask & 4 ? 1 : 0);
const totalStars = (c: Career) => CAREER_MAPS.reduce((a, m) => a + starCount(c.mapStars[m]), 0);

export const ACHIEVEMENTS: AchievementDef[] = [
  // Kills
  { id: 'kills100', name: 'Centurion', info: 'Get 100 kills', tier: 'bronze', icon: 'skull', check: (c) => c.kills >= 100 },
  { id: 'kills500', name: 'Veteran', info: 'Get 500 kills', tier: 'silver', icon: 'skull', check: (c) => c.kills >= 500 },
  { id: 'kills1000', name: 'Thousand Down', info: 'Get 1,000 kills', tier: 'gold', icon: 'skull', check: (c) => c.kills >= 1000 },
  { id: 'kills5000', name: 'One-Man Army', info: 'Get 5,000 kills', tier: 'legend', icon: 'crown', check: (c) => c.kills >= 5000 },
  { id: 'hs100', name: 'Head Hunter', info: 'Get 100 headshot kills', tier: 'silver', icon: 'scope', check: (c) => c.headshots >= 100 },
  { id: 'hs500', name: 'Marksman', info: 'Get 500 headshot kills', tier: 'gold', icon: 'scope', check: (c) => c.headshots >= 500 },
  { id: 'nade25', name: 'Demolitionist', info: 'Get 25 grenade kills', tier: 'silver', icon: 'grenade', check: (c) => (c.weaponKills.grenade ?? 0) >= 25 },
  { id: 'dmg100k', name: 'Heavy Hitter', info: 'Deal 100,000 damage', tier: 'gold', icon: 'burst', check: (c) => c.damage >= 100000 },
  // Wins and matches
  { id: 'win1', name: 'First Victory', info: 'Win a match', tier: 'bronze', icon: 'crown', check: (c) => c.wins >= 1 },
  { id: 'win10', name: 'Winner', info: 'Win 10 matches', tier: 'silver', icon: 'crown', check: (c) => c.wins >= 10 },
  { id: 'win50', name: 'Champion', info: 'Win 50 matches', tier: 'gold', icon: 'crown', check: (c) => c.wins >= 50 },
  { id: 'matches100', name: 'Regular', info: 'Play 100 matches to the end', tier: 'silver', icon: 'rise', check: (c) => c.matches >= 100 },
  { id: 'allModes', name: 'Jack of All Trades', info: 'Win a match in every mode (except Survival)', tier: 'gold', icon: 'x5', check: (c) => WINNABLE_MODES.every((m) => (c.modesWon[m] ?? 0) > 0) },
  { id: 'partyAll', name: 'Life of the Party', info: 'Win a match in every party mode (Gun Game, Kill Confirmed, Infected, One in the Chamber, Headhunter, Juggernaut)', tier: 'gold', icon: 'x5', check: (c) => PARTY_MODE_IDS.every((m) => (c.modesWon[m] ?? 0) > 0) },
  { id: 'gungameWin', name: 'Gun Runner', info: 'Win a Gun Game', tier: 'bronze', icon: 'rise', check: (_c, m) => m.win && m.mode === 'gungame' },
  { id: 'infectedWin', name: 'Patient Zero', info: 'Win a game of Infected', tier: 'silver', icon: 'shield', check: (_c, m) => m.win && m.mode === 'infected' },
  { id: 'allMaps', name: 'Tourist', info: 'Play a match to the end on every map', tier: 'bronze', icon: 'drop', check: (c) => CAREER_MAPS.every((m) => (c.mapsFinished[m] ?? 0) > 0) },
  { id: 'winHard', name: 'Hardened', info: 'Win a match on Hard or Insane', tier: 'silver', icon: 'shield', check: (_c, m) => m.win && (m.difficulty === 'hard' || m.difficulty === 'insane') },
  { id: 'winInsane', name: 'Insane', info: 'Win a match on Insane', tier: 'gold', icon: 'flame', check: (_c, m) => m.win && m.difficulty === 'insane' },
  { id: 'stars9', name: 'Rising Star', info: 'Earn 9 map stars', tier: 'silver', icon: 'burst', check: (c) => totalStars(c) >= 9 },
  { id: 'stars18', name: 'All-Star', info: 'Earn all 18 map stars', tier: 'legend', icon: 'burst', check: (c) => totalStars(c) >= 18 },
  // Feats in one match
  { id: 'flawless', name: 'Flawless', info: 'Win a match with 10+ kills and no deaths', tier: 'gold', icon: 'shield', check: (_c, m) => m.win && m.kills >= 10 && m.deaths === 0 },
  { id: 'streak10', name: 'Untouchable', info: 'Get a 10-kill streak', tier: 'silver', icon: 'flame', check: (_c, m) => m.bestStreak >= 10 },
  { id: 'streak16', name: 'Legendary', info: 'Get a 16-kill streak', tier: 'gold', icon: 'crown', check: (_c, m) => m.bestStreak >= 16 },
  { id: 'multi5', name: 'Rampage', info: 'Get 5 kills in quick succession', tier: 'gold', icon: 'x5', check: (_c, m) => m.bestMulti >= 5 },
  { id: 'long100', name: 'Long Distance', info: 'Kill someone 100 m away', tier: 'silver', icon: 'scope', check: (_c, m) => m.longestKill >= 100 },
  { id: 'score5000', name: 'High Scorer', info: 'Score 5,000 points in one match', tier: 'gold', icon: 'rise', check: (_c, m) => m.score >= 5000 },
  // Survival
  { id: 'wave10', name: 'Holdout', info: 'Clear wave 10 in Survival', tier: 'silver', icon: 'shield', check: (_c, m) => (m.wavesCleared ?? 0) >= 10 },
  { id: 'wave20', name: 'Last One Standing', info: 'Clear wave 20 in Survival', tier: 'legend', icon: 'crown', check: (_c, m) => (m.wavesCleared ?? 0) >= 20 },
  // Medals and challenges
  { id: 'medals100', name: 'Decorated', info: 'Earn 100 medals', tier: 'silver', icon: 'burst', check: (c) => count(c.medals) - (c.medals.headshot ?? 0) >= 100 },
  { id: 'daily10', name: 'Daily Grind', info: 'Complete 10 daily challenges', tier: 'silver', icon: 'rise', check: (c) => c.challengesDone >= 10 },
  // Medal collection: every medal of a tier at least once.
  { id: 'allBronze', name: 'Bronze Collection', info: 'Earn every bronze medal', tier: 'silver', icon: 'burst', check: (c) => hasAll(c, 'bronze') },
  { id: 'allSilver', name: 'Silver Collection', info: 'Earn every silver medal', tier: 'gold', icon: 'burst', check: (c) => hasAll(c, 'silver') },
  { id: 'allGold', name: 'Gold Collection', info: 'Earn every gold medal', tier: 'gold', icon: 'crown', check: (c) => hasAll(c, 'gold') },
  { id: 'allLegend', name: 'Legend Collection', info: 'Earn every legendary medal', tier: 'legend', icon: 'crown', check: (c) => hasAll(c, 'legend') },
  { id: 'allMedals', name: 'Collector', info: 'Earn every medal in the game', tier: 'legend', icon: 'crown', check: (c) => hasAll(c) },
  // Mastery and prestige
  { id: 'gold1', name: 'Golden Gun', info: 'Reach mastery 10 (Gold) with any gun', tier: 'gold', icon: 'crown', check: (c) => MASTERY_GUNS.some((g) => masteryLevel(c.weaponKills[g] ?? 0) >= 10) },
  { id: 'goldAll', name: 'Armory of Gold', info: 'Reach mastery 10 with every gun', tier: 'legend', icon: 'crown', check: (c) => MASTERY_GUNS.every((g) => masteryLevel(c.weaponKills[g] ?? 0) >= 10) },
  { id: 'prestige1', name: 'Prestige', info: 'Prestige for the first time (level 50)', tier: 'legend', icon: 'rise', check: (c) => c.prestige >= 1 },
];

export const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
