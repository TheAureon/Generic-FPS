import { WEAPONS, type WeaponId } from '../config';

/**
 * Cosmetic unlocks: weapon camos, glove colors, crosshair styles and colors,
 * calling cards (the background of your player card), titles and menu
 * backdrops. They only change looks, never how the game plays.
 *
 * You unlock them by reaching player levels (the highest you've ever
 * reached, so prestiging doesn't take anything away), by weapon mastery
 * (kills with each gun), by achievements, and by prestiging. What you've
 * equipped is saved in this browser.
 */

/** How something is unlocked. */
export type Unlock =
  | { level: number }
  | { mastery: number } // (per gun, for camos)
  | { achievement: string; hint: string }
  | { prestige: number }
  | { default: true };

/** What unlocks are checked against. */
export interface UnlockState {
  bestLevel: number;
  prestige: number;
  achievements: Record<string, number>;
  weaponKills: Record<string, number>;
}

export interface Camo {
  id: string;
  name: string;
  unlock: Unlock;
  /** Look: base color, metal and roughness, an optional pattern, and a glow for the special ones. */
  color: string;
  metalness: number;
  roughness: number;
  pattern?: 'blobs' | 'digital' | 'tiger' | 'carbon' | 'neon' | 'facets' | 'royal';
  colors?: string[];
  emissive?: string;
}

/** The guns that have mastery and camos. */
export const MASTERY_GUNS: WeaponId[] = ['pistol', 'rifle', 'shotgun', 'sniper', 'smg', 'lmg'];
/** Kills with a gun needed for each mastery level (1..10). */
export const MASTERY_KILLS = [10, 25, 50, 100, 150, 225, 300, 400, 500, 650];

export function masteryLevel(kills: number): number {
  return MASTERY_KILLS.filter((k) => kills >= k).length;
}

export const CAMOS: Camo[] = [
  { id: 'factory', name: 'Factory', unlock: { default: true }, color: '#4a5058', metalness: 0.55, roughness: 0.38 },
  // Mastery camos (each gun earns its own).
  { id: 'woodland', name: 'Woodland', unlock: { mastery: 2 }, color: '#4d5a32', metalness: 0.1, roughness: 0.75, pattern: 'blobs', colors: ['#2f3a1e', '#6b5a36', '#1c2014', '#5f7238'] },
  { id: 'desert', name: 'Desert', unlock: { mastery: 4 }, color: '#b89a6a', metalness: 0.1, roughness: 0.8, pattern: 'blobs', colors: ['#d2b88a', '#8f7046', '#a8885c', '#e0cfa8'] },
  { id: 'digital', name: 'Digital', unlock: { mastery: 6 }, color: '#5a6470', metalness: 0.15, roughness: 0.7, pattern: 'digital', colors: ['#3a424c', '#7c8794', '#252a30', '#9aa4ae'] },
  { id: 'tiger', name: 'Tiger', unlock: { mastery: 8 }, color: '#d2862a', metalness: 0.15, roughness: 0.6, pattern: 'tiger', colors: ['#1a120a'] },
  { id: 'gold', name: 'Gold', unlock: { mastery: 10 }, color: '#e0b04a', metalness: 0.95, roughness: 0.22 },
  // Level camos (every gun).
  { id: 'arctic', name: 'Arctic', unlock: { level: 5 }, color: '#d8dee4', metalness: 0.1, roughness: 0.7, pattern: 'blobs', colors: ['#ffffff', '#aab4be', '#c4ccd4', '#8e98a2'] },
  { id: 'crimson', name: 'Crimson', unlock: { level: 10 }, color: '#7a1c1c', metalness: 0.35, roughness: 0.45, pattern: 'blobs', colors: ['#3a0a0a', '#a32626', '#1a0606'] },
  { id: 'carbon', name: 'Carbon', unlock: { level: 15 }, color: '#2a2d32', metalness: 0.4, roughness: 0.35, pattern: 'carbon', colors: ['#16181b', '#3c4046'] },
  { id: 'cobalt', name: 'Cobalt', unlock: { level: 20 }, color: '#2a5aa8', metalness: 0.85, roughness: 0.25 },
  { id: 'neon', name: 'Neon', unlock: { level: 25 }, color: '#14161c', metalness: 0.3, roughness: 0.4, pattern: 'neon', colors: ['#20e8ff', '#ff3cc8'], emissive: '#ffffff' },
  { id: 'obsidian', name: 'Obsidian', unlock: { level: 30 }, color: '#121014', metalness: 0.7, roughness: 0.12, pattern: 'facets', colors: ['#2a1e3a', '#0a080c'] },
  { id: 'royal', name: 'Royal', unlock: { level: 50 }, color: '#3a1a5c', metalness: 0.6, roughness: 0.3, pattern: 'royal', colors: ['#e0b04a', '#5a2a8c'] },
  // Special.
  { id: 'prestige', name: 'Prestige', unlock: { prestige: 1 }, color: '#1a1030', metalness: 0.5, roughness: 0.3, pattern: 'neon', colors: ['#e0b04a', '#a060ff'], emissive: '#ffffff' },
  { id: 'diamond', name: 'Diamond', unlock: { achievement: 'goldAll', hint: 'Gold on every gun' }, color: '#bfe8ff', metalness: 0.9, roughness: 0.08, pattern: 'facets', colors: ['#ffffff', '#7cc8f0'], emissive: '#3a6a8a' },
];

export interface Item {
  id: string;
  name: string;
  unlock: Unlock;
  /** A color, or a CSS background for cards. */
  value: string;
}

export const GLOVES: Item[] = [
  { id: 'black', name: 'Tactical Black', unlock: { default: true }, value: '#2b2e33' },
  { id: 'tan', name: 'Coyote Tan', unlock: { level: 2 }, value: '#8a7556' },
  { id: 'olive', name: 'Olive Drab', unlock: { level: 7 }, value: '#4e5636' },
  { id: 'urban', name: 'Urban Grey', unlock: { level: 13 }, value: '#6c7076' },
  { id: 'arctic', name: 'Arctic White', unlock: { level: 19 }, value: '#d8dce0' },
  { id: 'red', name: 'Blood Red', unlock: { level: 28 }, value: '#7a1a1a' },
  { id: 'gold', name: 'Gilded', unlock: { level: 38 }, value: '#b8902e' },
  { id: 'champion', name: 'Champion Blue', unlock: { achievement: 'win50', hint: 'Win 50 matches' }, value: '#1e4fa8' },
  { id: 'prestige', name: 'Prestige Violet', unlock: { prestige: 2 }, value: '#5a2a9c' },
];

export const CROSSHAIR_STYLES: Item[] = [
  { id: 'classic', name: 'Classic', unlock: { default: true }, value: 'classic' },
  { id: 'dot', name: 'Dot', unlock: { level: 6 }, value: 'dot' },
  { id: 'circle', name: 'Circle', unlock: { level: 11 }, value: 'circle' },
  { id: 'cross', name: 'Cross', unlock: { level: 17 }, value: 'cross' },
  { id: 't', name: 'T', unlock: { level: 21 }, value: 't' },
];

export const CROSSHAIR_COLORS: Item[] = [
  { id: 'white', name: 'White', unlock: { default: true }, value: '#ffffff' },
  { id: 'green', name: 'Green', unlock: { level: 3 }, value: '#5cff7a' },
  { id: 'cyan', name: 'Cyan', unlock: { level: 9 }, value: '#3ce8ff' },
  { id: 'yellow', name: 'Yellow', unlock: { level: 14 }, value: '#ffe04a' },
  { id: 'magenta', name: 'Magenta', unlock: { level: 22 }, value: '#ff4ad8' },
  { id: 'red', name: 'Red', unlock: { level: 35 }, value: '#ff4a3c' },
];

export const CARDS: Item[] = [
  { id: 'steel', name: 'Steel', unlock: { default: true }, value: 'linear-gradient(135deg, #1e232c, #11141a)' },
  { id: 'sunset', name: 'Sunset', unlock: { level: 4 }, value: 'linear-gradient(160deg, #3a1c3e 0%, #a8432a 55%, #f0a040 100%)' },
  { id: 'blueprint', name: 'Blueprint', unlock: { level: 12 }, value: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.07) 0 1px, transparent 1px 20px), repeating-linear-gradient(90deg, rgba(255,255,255,0.07) 0 1px, transparent 1px 20px), linear-gradient(160deg, #123a6a, #0a2240)' },
  { id: 'hazard', name: 'Hazard', unlock: { level: 18 }, value: 'repeating-linear-gradient(45deg, #1a1a1a 0 18px, #c9a020 18px 36px)' },
  { id: 'nightcity', name: 'Night City', unlock: { level: 24 }, value: 'linear-gradient(180deg, #0a0c1a 0%, #1a1440 60%, #e04a8a 100%)' },
  { id: 'inferno', name: 'Inferno', unlock: { level: 32 }, value: 'radial-gradient(120% 90% at 50% 120%, #ffd04a 0%, #e04a1a 35%, #3a0a0a 75%)' },
  { id: 'aurora', name: 'Aurora', unlock: { level: 40 }, value: 'linear-gradient(170deg, #06121a 0%, #0a4a4a 45%, #4ae0a0 70%, #2a1a5a 100%)' },
  { id: 'insane', name: 'Insane', unlock: { achievement: 'winInsane', hint: 'Win on Insane' }, value: 'repeating-radial-gradient(circle at 30% 40%, #3a0606 0 10px, #120202 10px 22px)' },
  { id: 'allstar', name: 'All-Star', unlock: { achievement: 'stars18', hint: 'All 18 map stars' }, value: 'radial-gradient(circle at 20% 30%, rgba(255,220,120,0.9) 0 2px, transparent 3px), radial-gradient(circle at 70% 60%, rgba(255,220,120,0.8) 0 2px, transparent 3px), radial-gradient(circle at 45% 80%, rgba(255,220,120,0.7) 0 1.5px, transparent 2.5px), linear-gradient(160deg, #1a1440, #3a2a10)' },
  { id: 'legend', name: 'One-Man Army', unlock: { achievement: 'kills5000', hint: '5,000 kills' }, value: 'linear-gradient(135deg, #2a0a0a 0%, #8a1a1a 50%, #e0b04a 100%)' },
  { id: 'prestige', name: 'Prestige', unlock: { prestige: 1 }, value: 'linear-gradient(135deg, #2a1050 0%, #6a30c0 50%, #e0b04a 100%)' },
];

/** Menu backdrops: the arena at different times of day. */
export interface Backdrop extends Item {
  sky: { zenith: number; mid: number; horizon: number; ground: number; sunColor: number; sunElevation: number; sunAzimuth: number; sunIntensity: number; skyLight: number; clouds: number; cloudColor: number; skylineColor: number; litWindows: boolean };
  fog: [number, number];
}

export const BACKDROPS: Backdrop[] = [
  {
    id: 'dusk', name: 'Dusk', unlock: { default: true }, value: '#d88e5c', fog: [30, 140],
    sky: { zenith: 0x0c1428, mid: 0x2e3a5c, horizon: 0xd88e5c, ground: 0x2a2220, sunColor: 0xffa860, sunElevation: 9, sunAzimuth: 245, sunIntensity: 2.3, skyLight: 0.75, clouds: 0.32, cloudColor: 0x6e5a6c, skylineColor: 0x2c303c, litWindows: true },
  },
  {
    id: 'night', name: 'Night', unlock: { level: 8 }, value: '#1a2440', fog: [25, 120],
    sky: { zenith: 0x02040c, mid: 0x0a1226, horizon: 0x1e2a44, ground: 0x101216, sunColor: 0x9ab4e8, sunElevation: 30, sunAzimuth: 120, sunIntensity: 0.9, skyLight: 0.45, clouds: 0.2, cloudColor: 0x1a2234, skylineColor: 0x0c1018, litWindows: true },
  },
  {
    id: 'dawn', name: 'Dawn', unlock: { level: 16 }, value: '#f0b0a0', fog: [40, 170],
    sky: { zenith: 0x3a5a9a, mid: 0x8a9ac8, horizon: 0xf4b8a0, ground: 0x4a4440, sunColor: 0xffd0b0, sunElevation: 6, sunAzimuth: 80, sunIntensity: 2.0, skyLight: 0.95, clouds: 0.4, cloudColor: 0xe8b0b8, skylineColor: 0x6a6878, litWindows: false },
  },
  {
    id: 'storm', name: 'Storm', unlock: { level: 26 }, value: '#4a5058', fog: [18, 90],
    sky: { zenith: 0x20242a, mid: 0x3a4048, horizon: 0x5a6068, ground: 0x2a2c2e, sunColor: 0xb8c4d0, sunElevation: 40, sunAzimuth: 200, sunIntensity: 0.8, skyLight: 0.7, clouds: 0.95, cloudColor: 0x3a3e44, skylineColor: 0x2a2e34, litWindows: true },
  },
  {
    id: 'golden', name: 'Golden Hour', unlock: { level: 45 }, value: '#f0c060', fog: [40, 180],
    sky: { zenith: 0x2a4a8a, mid: 0x6a7ab0, horizon: 0xffc070, ground: 0x5a4a30, sunColor: 0xffc860, sunElevation: 14, sunAzimuth: 260, sunIntensity: 2.8, skyLight: 0.9, clouds: 0.25, cloudColor: 0xe8a868, skylineColor: 0x5a5060, litWindows: false },
  },
];

/** Is this unlocked? `gun` is needed for mastery camos. */
export function isUnlocked(u: Unlock, s: UnlockState, gun?: string): boolean {
  if ('default' in u) return true;
  if ('level' in u) return s.bestLevel >= u.level;
  if ('prestige' in u) return s.prestige >= u.prestige;
  if ('achievement' in u) return !!s.achievements[u.achievement];
  return gun ? masteryLevel(s.weaponKills[gun] ?? 0) >= u.mastery : false;
}

/** How to unlock it, in a few words. */
export function unlockHint(u: Unlock): string {
  if ('default' in u) return 'Default';
  if ('level' in u) return `Reach level ${u.level}`;
  if ('prestige' in u) return `Prestige ${u.prestige}`;
  if ('achievement' in u) return u.hint;
  return `Mastery ${u.mastery}`;
}

/** Everything unlocked, as ids like "camo:smg:desert", "gloves:tan", "card:sunset". */
export function unlockedIds(s: UnlockState): Set<string> {
  const out = new Set<string>();
  for (const c of CAMOS) for (const g of MASTERY_GUNS) if (!('default' in c.unlock) && isUnlocked(c.unlock, s, g)) out.add(`camo:${g}:${c.id}`);
  const lists: [string, Item[]][] = [['gloves', GLOVES], ['crosshair', CROSSHAIR_STYLES], ['color', CROSSHAIR_COLORS], ['card', CARDS], ['backdrop', BACKDROPS]];
  for (const [kind, list] of lists) for (const it of list) if (!('default' in it.unlock) && isUnlocked(it.unlock, s)) out.add(`${kind}:${it.id}`);
  return out;
}

/** A readable name for an unlock id (for the match report). */
export function unlockName(id: string): { kind: string; name: string } {
  const [kind, a, b] = id.split(':');
  const find = (list: { id: string; name: string }[], x: string) => list.find((i) => i.id === x)?.name ?? x;
  switch (kind) {
    case 'camo': return { kind: `${WEAPONS[a as WeaponId]?.name ?? a} camo`, name: find(CAMOS, b) };
    case 'gloves': return { kind: 'Gloves', name: find(GLOVES, a) };
    case 'crosshair': return { kind: 'Crosshair style', name: find(CROSSHAIR_STYLES, a) };
    case 'color': return { kind: 'Crosshair color', name: find(CROSSHAIR_COLORS, a) };
    case 'card': return { kind: 'Calling card', name: find(CARDS, a) };
    case 'backdrop': return { kind: 'Menu backdrop', name: find(BACKDROPS, a) };
    default: return { kind, name: a };
  }
}

// ---- What you've equipped ------------------------------------------------------------

export interface Loadout {
  camo: Partial<Record<WeaponId, string>>;
  gloves: string;
  crosshair: string;
  crosshairColor: string;
  card: string;
  /** An achievement id (its name is the title), or '' for none. */
  title: string;
  backdrop: string;
}

const KEY = 'generic-fps.loadout.v1';

class LoadoutStore {
  private data: Loadout = { camo: {}, gloves: 'black', crosshair: 'classic', crosshairColor: 'white', card: 'steel', title: '', backdrop: 'dusk' };
  private listeners: ((l: Loadout) => void)[] = [];

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = { ...this.data, ...JSON.parse(raw) };
    } catch {
      // Not saved in this browser: defaults.
    }
  }

  get(): Readonly<Loadout> {
    return this.data;
  }

  set(patch: Partial<Loadout>): void {
    this.data = { ...this.data, ...patch, camo: { ...this.data.camo, ...(patch.camo ?? {}) } };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // Couldn't save; keep going.
    }
    for (const l of this.listeners) l(this.data);
  }

  onChange(l: (l: Loadout) => void): void {
    this.listeners.push(l);
  }
}

export const loadout = new LoadoutStore();
