import { REWARDS, WEAPONS } from '../config';
import { audio } from '../audio/AudioEngine';
import { camoTextures } from '../assets/camos';
import { ACHIEVEMENT_XP, ACHIEVEMENTS, CAREER_MAPS, starCount } from '../core/Achievements';
import {
  BACKDROPS, CAMOS, CARDS, CROSSHAIR_COLORS, CROSSHAIR_STYLES, GLOVES, MASTERY_GUNS, MASTERY_KILLS,
  isUnlocked, loadout, masteryLevel, unlockHint, type Item, type UnlockState,
} from '../core/Cosmetics';
import { levelInfo, progress } from '../core/Progress';
import { dailyCard, playerCard } from './Career';
import { medalHtml } from './RewardsHud';
import { MEDALS, type MedalTier } from '../core/Rewards';
import { MAPS } from '../map/maps';

/**
 * The Career screen: your unlocks and how to get more. Tabs:
 * - Armory: each gun's mastery (kills with it) and its camos
 * - Look: gloves, crosshair style and color, menu backdrop
 * - Profile: your player card, calling cards, titles, and prestige
 * (more tabs are added by the medal / records screens)
 */

export type CareerTab = 'armory' | 'look' | 'profile' | string;

/** Extra tabs (name, label, builder), added by other screens. */
export const EXTRA_TABS: [string, string, (p: HTMLElement, rebuild: () => void) => void][] = [];

export function buildCareer(p: HTMLElement, tab: CareerTab, go: (tab: CareerTab) => void): void {
  const tabs = div('career-tabs', p);
  const all: [string, string][] = [['armory', 'Armory'], ['look', 'Look'], ['profile', 'Profile'], ['medals', 'Medals'], ['achievements', 'Achievements'], ['records', 'Records'], ['challenges', 'Challenges'], ...EXTRA_TABS.map(([id, label]) => [id, label] as [string, string])];
  for (const [id, label] of all) {
    const b = document.createElement('button');
    b.className = `career-tab${id === tab ? ' active' : ''}`;
    b.textContent = label;
    b.addEventListener('click', () => {
      audio.play('ui_click');
      go(id);
    });
    tabs.appendChild(b);
  }
  const body = div('career-body', p);
  const rebuild = () => go(tab);
  if (tab === 'armory') armory(body, rebuild);
  else if (tab === 'look') look(body, rebuild);
  else if (tab === 'profile') profile(body, rebuild);
  else if (tab === 'medals') medals(body);
  else if (tab === 'achievements') achievements(body);
  else if (tab === 'records') records(body);
  else if (tab === 'challenges') challenges(body);
  else EXTRA_TABS.find(([id]) => id === tab)?.[2](body, rebuild);
}

function state(): UnlockState {
  return progress.get();
}

// ---- Armory: mastery and camos ---------------------------------------------------------

function armory(p: HTMLElement, rebuild: () => void): void {
  const s = state();
  div('career-note', p).textContent = 'Kills with a gun raise its mastery. Mastery 2, 4, 6 and 8 unlock that gun’s camos, and mastery 10 unlocks Gold. Other camos come with your level, achievements and prestige.';
  for (const gun of MASTERY_GUNS) {
    const kills = s.weaponKills[gun] ?? 0;
    const lvl = masteryLevel(kills);
    const prev = lvl === 0 ? 0 : MASTERY_KILLS[lvl - 1], next = MASTERY_KILLS[lvl];
    const row = div('gun-row', p);
    const head = div('gun-head', row);
    head.innerHTML = `<div class="gun-name">${WEAPONS[gun].name}</div>
      <div class="gun-mastery"><span class="gm-level">${lvl >= 10 ? 'Mastered' : `Mastery ${lvl}`}</span>
      <div class="xp-bar"><div class="xp-fill" style="width:${next ? ((100 * (kills - prev)) / (next - prev)).toFixed(1) : 100}%"></div></div>
      <span class="gm-kills">${next ? `${kills} / ${next} kills` : `${kills} kills`}</span></div>`;
    const grid = div('swatches', row);
    const equipped = loadout.get().camo[gun] ?? 'factory';
    for (const c of CAMOS) {
      const open = isUnlocked(c.unlock, s, gun);
      swatchButton(grid, c.name, open ? '' : unlockHint(c.unlock), c.id === equipped, open, `url(${camoTextures(c).swatch})`, () => {
        loadout.set({ camo: { [gun]: c.id } });
        rebuild();
      });
    }
  }
}

// ---- Look: gloves, crosshair, backdrop --------------------------------------------------------

function look(p: HTMLElement, rebuild: () => void): void {
  const s = state(), l = loadout.get();
  section(p, 'Gloves');
  pickList(p, GLOVES, l.gloves, (it) => it.value, (id) => loadout.set({ gloves: id }), rebuild, s);
  section(p, 'Crosshair');
  const prev = div('xh-preview', p);
  prev.innerHTML = `<div class="crosshair ch-style-${l.crosshair}" style="--gap:7px;--ch-color:${CROSSHAIR_COLORS.find((c) => c.id === l.crosshairColor)?.value ?? '#fff'}"><div class="ch-line ch-top"></div><div class="ch-line ch-bottom"></div><div class="ch-line ch-left"></div><div class="ch-line ch-right"></div><div class="ch-dot"></div></div>`;
  pickList(p, CROSSHAIR_STYLES, l.crosshair, () => '#262b34', (id) => loadout.set({ crosshair: id }), rebuild, s, true);
  pickList(p, CROSSHAIR_COLORS, l.crosshairColor, (it) => it.value, (id) => loadout.set({ crosshairColor: id }), rebuild, s);
  section(p, 'Menu backdrop');
  pickList(p, BACKDROPS, l.backdrop, (it) => `linear-gradient(180deg, #${(it as (typeof BACKDROPS)[number]).sky.zenith.toString(16).padStart(6, '0')}, ${it.value})`, (id) => loadout.set({ backdrop: id }), rebuild, s, true);
}

// ---- Profile: card, title, prestige ------------------------------------------------------------

function profile(p: HTMLElement, rebuild: () => void): void {
  const s = state(), l = loadout.get(), c = progress.get();
  const preview = div('profile-preview', p);
  preview.appendChild(playerCard());
  section(p, 'Calling card');
  pickList(p, CARDS, l.card, (it) => it.value, (id) => loadout.set({ card: id }), rebuild, s, true);

  section(p, 'Title');
  const titles = div('titles', p);
  const earned = ACHIEVEMENTS.filter((a) => c.achievements[a.id]);
  const titleBtn = (id: string, name: string) => {
    const b = document.createElement('button');
    b.className = `title-chip${l.title === id ? ' active' : ''}`;
    b.textContent = name;
    b.addEventListener('click', () => {
      audio.play('ui_click');
      loadout.set({ title: id });
      rebuild();
    });
    titles.appendChild(b);
  };
  titleBtn('', 'No title');
  for (const a of earned) titleBtn(a.id, a.name);
  if (!earned.length) div('career-note', p).textContent = 'Each achievement you earn becomes a title you can show on your player card.';

  section(p, 'Prestige');
  const L = levelInfo(c.xp);
  const box = div('prestige-box', p);
  const can = progress.canPrestige();
  box.innerHTML = `<div class="pb-text"><div class="pb-title">${c.prestige ? `Prestige ${c.prestige}` : 'Not prestiged yet'}</div>
    <div class="pb-info">${c.prestige >= REWARDS.maxPrestige ? 'Maximum prestige reached.' : can ? `You’re level ${L.level}: you can prestige now.` : `Reach level ${REWARDS.prestigeLevel} to prestige (you’re level ${L.level}).`}
    Prestiging starts you over at level 1 with a prestige star on your emblem and new unlocks. You keep everything you’ve unlocked, your stats, and your leaderboard XP.</div></div>`;
  const btn = document.createElement('button');
  btn.className = `menu-btn ${can ? 'primary' : ''}`;
  btn.textContent = can ? 'Prestige' : 'Locked';
  btn.disabled = !can;
  let armed = false;
  btn.addEventListener('click', () => {
    if (!can) return;
    audio.play('ui_click');
    // Two clicks, so it can't happen by accident.
    if (!armed) {
      armed = true;
      btn.textContent = 'Click again to confirm';
      return;
    }
    if (progress.doPrestige()) {
      audio.play('levelup');
      rebuild();
    }
  });
  box.appendChild(btn);
}

// ---- Medals: the collection ---------------------------------------------------------------------

function medals(p: HTMLElement): void {
  const c = progress.get();
  const tiers: MedalTier[] = ['bronze', 'silver', 'gold', 'legend'];
  const entries = Object.entries(MEDALS);
  const sets = div('medal-sets', p);
  for (const t of tiers) {
    const all = entries.filter(([, m]) => m.tier === t), have = all.filter(([id]) => (c.medals[id] ?? 0) > 0).length;
    const it = div(`medal-set tier-${t}`, sets);
    it.innerHTML = `<div class="ms-name">${t === 'legend' ? 'Legendary' : t[0].toUpperCase() + t.slice(1)}</div><div class="ms-count">${have} / ${all.length}</div><div class="xp-bar"><div class="xp-fill" style="width:${((100 * have) / all.length).toFixed(0)}%"></div></div>`;
  }
  div('career-note', p).textContent = 'Collect every medal of a color (and then every medal) for achievements. Medals you haven’t earned yet show as silhouettes.';
  for (const t of tiers) {
    const grid = div('medal-grid', p);
    for (const [id, m] of entries.filter(([, x]) => x.tier === t)) {
      const n = c.medals[id] ?? 0;
      const it = div(`mc-item${n ? '' : ' locked'}`, grid);
      it.innerHTML = `${medalHtml(m, n)}<div class="mc-name">${n ? m.name : '???'}</div><div class="mc-info">${m.info}</div>`;
    }
  }
}

// ---- Achievements --------------------------------------------------------------------------------

function achievements(p: HTMLElement): void {
  const c = progress.get();
  const earned = ACHIEVEMENTS.filter((a) => c.achievements[a.id]).length;
  div('career-note', p).textContent = `${earned} of ${ACHIEVEMENTS.length} earned. Each gives XP once: 500 (bronze), 1,000 (silver), 2,500 (gold), 5,000 (legendary).`;
  const list = div('ach-list', p);
  for (const a of [...ACHIEVEMENTS].sort((x, y) => (c.achievements[y.id] ? 1 : 0) - (c.achievements[x.id] ? 1 : 0))) {
    const when = c.achievements[a.id];
    const it = div(`ach-item${when ? '' : ' locked'}`, list);
    it.innerHTML = `${medalHtml({ name: a.name, tier: a.tier, icon: a.icon, info: a.info })}<div class="rr-text"><div class="rr-name">${a.name}</div><div class="rr-info">${a.info}</div></div>
      <div class="ach-right"><div class="rr-xp">+${ACHIEVEMENT_XP[a.tier].toLocaleString('en-US')} XP</div><div class="ach-when">${when ? new Date(when).toLocaleDateString() : 'Locked'}</div></div>`;
  }
}

// ---- Records: personal bests, career totals, maps ---------------------------------------------------

function records(p: HTMLElement): void {
  const c = progress.get(), b = c.bests;
  section(p, 'Personal bests (one match)');
  const tiles = div('report-tiles', p);
  const tile = (v: string, l: string) => (div('report-tile in', tiles).innerHTML = `<div class="rt-v">${v}</div><div class="rt-l">${l}</div>`);
  tile(b.score.toLocaleString('en-US'), 'Score');
  tile(String(b.kills), 'Kills');
  tile(String(b.streak), 'Streak');
  tile(`×${b.multi}`, 'Multikill');
  tile(`${b.longestKill} m`, 'Longest kill');
  tile(b.damage.toLocaleString('en-US'), 'Damage');
  tile(b.accuracy ? `${b.accuracy}%` : '—', 'Accuracy (10+ kills)');
  section(p, 'Career');
  const tot = div('report-tiles', p);
  const t2 = (v: string, l: string) => (div('report-tile in', tot).innerHTML = `<div class="rt-v">${v}</div><div class="rt-l">${l}</div>`);
  t2(c.matches.toLocaleString('en-US'), 'Matches');
  t2(c.wins.toLocaleString('en-US'), 'Wins');
  t2(c.kills.toLocaleString('en-US'), 'Kills');
  t2(c.deaths ? (c.kills / c.deaths).toFixed(2) : String(c.kills), 'K/D');
  t2(c.headshots.toLocaleString('en-US'), 'Headshot kills');
  t2(c.damage.toLocaleString('en-US'), 'Damage');
  t2(c.lifetimeXp.toLocaleString('en-US'), 'Lifetime XP');
  t2(c.challengesDone.toLocaleString('en-US'), 'Challenges done');
  section(p, 'Maps');
  const table = div('map-table', p);
  table.innerHTML = `<div class="mt-row mt-head"><span>Map</span><span>Stars</span><span>Survival best</span><span>Matches</span></div>` +
    CAREER_MAPS.map((id) => {
      const n = starCount(c.mapStars[id]);
      return `<div class="mt-row"><span>${MAPS.find((m) => m.id === id)?.name ?? id}</span><span class="map-stars">${'★'.repeat(n)}<span>${'★'.repeat(3 - n)}</span></span><span>${c.survivalBest[id] ? `wave ${c.survivalBest[id]}` : '—'}</span><span>${c.mapsFinished[id] ?? 0}</span></div>`;
    }).join('');
  div('career-note', p).textContent = '★ win · ★★ win on Hard or harder · ★★★ win on Master or Insane.';
}

// ---- Challenges: daily and weekly -----------------------------------------------------------------

function challenges(p: HTMLElement): void {
  p.appendChild(dailyCard());
}

// ---- Helpers -----------------------------------------------------------------------------------

function pickList(p: HTMLElement, items: Item[], current: string, bg: (it: Item) => string, set: (id: string) => void, rebuild: () => void, s: UnlockState, wide = false): void {
  const grid = div(`swatches${wide ? ' wide' : ''}`, p);
  for (const it of items) {
    const open = isUnlocked(it.unlock, s);
    swatchButton(grid, it.name, open ? '' : unlockHint(it.unlock), it.id === current, open, bg(it), () => {
      set(it.id);
      rebuild();
    }, it.value.startsWith('#') || it.value.includes('gradient') ? '' : it.value);
  }
}

function swatchButton(grid: HTMLElement, name: string, lockedHint: string, active: boolean, open: boolean, background: string, onPick: () => void, glyph = ''): void {
  const b = document.createElement('button');
  b.className = `swatch${active ? ' active' : ''}${open ? '' : ' locked'}`;
  b.title = open ? name : `${name}: ${lockedHint}`;
  b.innerHTML = `<span class="sw-face" style="background:${background};background-size:cover">${glyph ? `<span class="sw-glyph ch-glyph-${glyph}"></span>` : ''}${open ? '' : `<span class="sw-lock">${LOCK}</span>`}</span><span class="sw-name">${name}</span>${open ? '' : `<span class="sw-hint">${lockedHint}</span>`}`;
  b.addEventListener('click', () => {
    if (!open) return;
    audio.play('ui_click');
    onPick();
  });
  grid.appendChild(b);
}

const LOCK = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1zm2 0h6V7a3 3 0 0 0-6 0z"/></svg>';

function section(p: HTMLElement, title: string): void {
  div('section-title', p).textContent = title;
}

function div(className: string, parent: HTMLElement): HTMLDivElement {
  const d = document.createElement('div');
  d.className = className;
  parent.appendChild(d);
  return d;
}
