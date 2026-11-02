import { CHALLENGES, WEAPONS, type Difficulty, type WeaponId } from '../config';
import { seededRandom } from '../map/terrain';
import type { MatchSummary } from './Rewards';

/**
 * Daily challenges: three goals a day (easy, medium, hard) that give bonus
 * XP when done. Everyone gets the same three on the same day (picked from
 * the date); they change at midnight. Progress is saved in this browser.
 * Matches on practice difficulties (no XP) don't count.
 */

/** What a match has done so far (or in the end), for measuring progress. */
export interface MatchView {
  summary: MatchSummary;
  /** Has the match ended (played to the finish)? */
  finished: boolean;
  win: boolean;
  mode: string;
  map: string;
  difficulty: Difficulty;
  accuracy: number;
}

export interface Challenge {
  id: string;
  tier: 0 | 1 | 2;
  text: string;
  target: number;
  /** 'sum': adds up over matches; 'best': the best single match counts. */
  kind: 'sum' | 'best';
  measure: (m: MatchView) => number;
}

const TIER_NAMES = ['Easy', 'Medium', 'Hard'];
export const tierName = (t: number): string => TIER_NAMES[t];

const GUNS: WeaponId[] = ['pistol', 'rifle', 'shotgun', 'sniper', 'smg', 'lmg'];
const MODE_NAMES: Record<string, string> = { deathmatch: 'Free for All', tdm: 'Team Deathmatch', koh: 'King of the Hill', ctf: 'Capture the Flag', control: 'Control', br: 'Battle Royale' };
const MAP_NAMES: Record<string, string> = { foundry: 'Foundry', office: 'Office', museum: 'Museum', forest: 'Forest', mountains: 'Mountain Plains', flatlands: 'Flatlands' };
const HARD_OR_MORE: Difficulty[] = ['hard', 'insane'];

const medals = (m: MatchView, ...ids: string[]) => ids.reduce((a, id) => a + (m.summary.medals[id] ?? 0), 0);
const allMedals = (m: MatchView) => Object.entries(m.summary.medals).reduce((a, [id, n]) => a + (id === 'headshot' ? 0 : n), 0);
const gunName = (w: WeaponId) => (w === 'smg' || w === 'lmg' ? `the ${WEAPONS[w].name}` : `the ${WEAPONS[w].name.toLowerCase()}`);

/** Every challenge there could be (some come in a version per gun, map or mode). */
function pool(): Challenge[] {
  const out: Challenge[] = [];
  const add = (id: string, tier: 0 | 1 | 2, text: string, target: number, measure: (m: MatchView) => number, kind: 'sum' | 'best' = 'sum') =>
    out.push({ id, tier, text, target, kind, measure });

  // ---- Easy ----
  add('kills15', 0, 'Get 15 kills', 15, (m) => m.summary.kills);
  add('hs5', 0, 'Get 5 headshot kills', 5, (m) => m.summary.headshots);
  add('medals4', 0, 'Earn 4 medals', 4, allMedals);
  add('dmg1500', 0, 'Deal 1,500 damage', 1500, (m) => Math.round(m.summary.damage));
  add('finish2', 0, 'Play 2 matches to the end', 2, (m) => (m.finished ? 1 : 0));
  for (const w of GUNS) add(`gun8-${w}`, 0, `Get 8 kills with ${gunName(w)}`, 8, (m) => m.summary.weaponKills[w] ?? 0);

  // ---- Medium ----
  add('kills40', 1, 'Get 40 kills', 40, (m) => m.summary.kills);
  add('hs15', 1, 'Get 15 headshot kills', 15, (m) => m.summary.headshots);
  add('nade3', 1, 'Get 3 grenade kills', 3, (m) => m.summary.weaponKills.grenade ?? 0);
  add('double3', 1, 'Get 3 Double Kills (or better)', 3, (m) => medals(m, 'double', 'triple', 'quad', 'rampage'));
  add('streak5', 1, 'Get a 5-kill streak in one match', 5, (m) => m.summary.bestStreak, 'best');
  add('win2', 1, 'Win 2 matches', 2, (m) => (m.finished && m.win ? 1 : 0));
  add('long2', 1, 'Get 2 Longshots', 2, (m) => medals(m, 'longshot'));
  add('snipehs4', 1, 'Get 4 headshot kills with the sniper rifle', 4, (m) => m.summary.weaponHeadshots.sniper ?? 0);
  for (const w of GUNS) add(`gun20-${w}`, 1, `Get 20 kills with ${gunName(w)}`, 20, (m) => m.summary.weaponKills[w] ?? 0);
  for (const [id, name] of Object.entries(MAP_NAMES)) add(`map-${id}`, 1, `Play a match on ${name} to the end`, 1, (m) => (m.finished && m.map === id ? 1 : 0));
  for (const [id, name] of Object.entries(MODE_NAMES)) add(`mode-${id}`, 1, `Win a ${name} match`, 1, (m) => (m.finished && m.win && m.mode === id ? 1 : 0));

  // ---- Hard ----
  add('kills80', 2, 'Get 80 kills', 80, (m) => m.summary.kills);
  add('streak8', 2, 'Get an 8-kill streak in one match', 8, (m) => m.summary.bestStreak, 'best');
  add('triple', 2, 'Get a Triple Kill (or better)', 1, (m) => medals(m, 'triple', 'quad', 'rampage'));
  add('nade8', 2, 'Get 8 grenade kills', 8, (m) => m.summary.weaponKills.grenade ?? 0);
  add('snipehs10', 2, 'Get 10 headshot kills with the sniper rifle', 10, (m) => m.summary.weaponHeadshots.sniper ?? 0);
  add('long5', 2, 'Get 5 Longshots', 5, (m) => medals(m, 'longshot'));
  add('winhard', 2, 'Win a match on Hard or Insane', 1, (m) => (m.finished && m.win && HARD_OR_MORE.includes(m.difficulty) ? 1 : 0));
  add('kd3', 2, 'Finish a match with 10+ kills and a K/D of 3 or better', 1,
    (m) => (m.finished && m.summary.kills >= 10 && m.summary.kills >= 3 * Math.max(1, m.summary.deaths) ? 1 : 0), 'best');
  return out;
}

const ALL = pool();
const byId = new Map(ALL.map((c) => [c.id, c]));

/** Today's date (local), e.g. "2026-11-02". */
export function today(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The three challenges for a date: one per tier, picked from the date. */
export function challengesFor(date: string): Challenge[] {
  // Mix the date's characters well (nearby dates must give very different picks).
  let h = 2166136261;
  for (const c of date) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
  const rnd = seededRandom((h % 2147483646) + 1);
  for (let i = 0; i < 5; i++) rnd();
  // Pick a sort of challenge first (kills, a gun, a map...), then one of that sort,
  // so the many per-gun/map/mode versions don't crowd out the rest. Never two of
  // the same sort on one day.
  const sort = (c: Challenge) => c.id.split(/[-\d]/)[0];
  const used = new Set<string>();
  return ([0, 1, 2] as const).map((tier) => {
    const sorts = [...new Set(ALL.filter((c) => c.tier === tier && !used.has(sort(c))).map(sort))];
    const chosen = sorts[Math.floor(rnd() * sorts.length)];
    const options = ALL.filter((c) => c.tier === tier && sort(c) === chosen);
    used.add(chosen);
    return options[Math.floor(rnd() * options.length)];
  });
}

export interface DailyState {
  date: string;
  ids: string[];
  progress: number[];
  done: boolean[];
}

const KEY = 'generic-fps.daily.v1';

class Daily {
  private state: DailyState;

  constructor() {
    this.state = this.fresh();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw) as DailyState;
        if (s.date === today() && s.ids?.length === 3 && s.ids.every((id) => byId.has(id))) this.state = s;
      }
    } catch {
      // Not saved in this browser: start fresh.
    }
  }

  private fresh(): DailyState {
    const date = today();
    return { date, ids: challengesFor(date).map((c) => c.id), progress: [0, 0, 0], done: [false, false, false] };
  }

  /** Today's challenges with their saved progress (rolls over to new ones at midnight). */
  get(): { challenge: Challenge; progress: number; done: boolean; xp: number }[] {
    if (this.state.date !== today()) this.state = this.fresh();
    return this.state.ids.map((id, i) => {
      const c = byId.get(id)!;
      return { challenge: c, progress: this.state.progress[i], done: this.state.done[i], xp: CHALLENGES.xp[c.tier] };
    });
  }

  /** Save progress (after a match, or when a challenge completes). */
  save(progress: number[], done: boolean[]): void {
    this.state.progress = progress.slice();
    this.state.done = done.slice();
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
    } catch {
      // Couldn't save; keep going.
    }
  }

  /** Time until the next set of challenges. */
  timeLeft(): string {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const mins = Math.max(0, Math.round((next.getTime() - now.getTime()) / 60000));
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }
}

export const daily = new Daily();

/** What the HUD and end screen show for each challenge. */
export interface ChallengeStatus {
  text: string;
  tier: number;
  target: number;
  /** Progress at the start of the match, and now. */
  start: number;
  current: number;
  done: boolean;
  /** Completed during this match. */
  justDone: boolean;
  xp: number;
}

/**
 * Tracks today's challenges during one match. Progress shows live; it's
 * saved when a challenge completes and when the match ends (or you quit).
 */
export class ChallengeTracker {
  private list = daily.get();
  private date = today();
  private start = this.list.map((c) => c.progress);
  private justDone = [false, false, false];
  /** Bonus XP earned from challenges completed this match. */
  xpEarned = 0;

  constructor(
    /** Practice difficulty: nothing counts. */
    readonly practice: boolean,
    private onComplete: (s: ChallengeStatus) => void,
  ) {}

  /** Recompute progress from the match so far; announces any just completed. */
  update(m: MatchView): ChallengeStatus[] {
    const out = this.list.map((c, i): ChallengeStatus => {
      const was = this.start[i];
      let current = was;
      if (!c.done && !this.practice) {
        const v = c.challenge.measure(m);
        current = Math.min(c.challenge.target, c.challenge.kind === 'sum' ? was + v : Math.max(was, v));
      }
      if (c.done) current = c.challenge.target;
      return { text: c.challenge.text, tier: c.challenge.tier, target: c.challenge.target, start: was, current, done: c.done || current >= c.challenge.target, justDone: this.justDone[i], xp: c.xp };
    });
    let changed = false;
    out.forEach((s, i) => {
      if (s.done && !this.list[i].done) {
        this.list[i].done = true;
        this.justDone[i] = s.justDone = true;
        this.xpEarned += s.xp;
        changed = true;
        this.onComplete(s);
      }
    });
    if (changed) this.save(out);
    return out;
  }

  /** Save where everyone's at (call at the end of the match, or when quitting). */
  save(statuses: ChallengeStatus[]): void {
    if (this.practice || this.date !== today()) return;
    daily.save(statuses.map((s) => s.current), statuses.map((s) => s.done));
  }
}
