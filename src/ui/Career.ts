import { WEAPONS, type WeaponId } from '../config';
import { audio } from '../audio/AudioEngine';
import { daily, tierName, type ChallengeStatus } from '../core/Challenges';
import { ACHIEVEMENT_XP } from '../core/Achievements';
import { levelInfo, progress, type Bests, type Career, type RecordResult } from '../core/Progress';
import { MEDALS, type MatchSummary } from '../core/Rewards';
import { medalHtml } from './RewardsHud';

/**
 * Career pieces of the menus: the rank emblem, the player card on the main
 * menu, and the animated match report on the end screen (stat tiles that
 * count up, medals, XP breakdown, the XP bar filling and leveling up).
 */

export interface EndReport {
  summary: MatchSummary;
  accuracy: number;
  xpLines: [string, number][];
  xp: number;
  /** XP before the difficulty multiplier, the multiplier, and the difficulty's name. */
  baseXp: number;
  multiplier: number;
  difficulty: string;
  /** Daily challenges after this match, and the bonus XP from ones completed in it. */
  challenges?: ChallengeStatus[];
  challengeXp?: number;
  /** What the match changed in your career: records, stars, achievements (null on practice). */
  record?: RecordResult | null;
  before: Career;
  after: Career;
  mode: string;
  map: string;
  time: number;
}

const TIER_CLASS = ['bronze', 'bronze', 'bronze', 'silver', 'silver', 'silver', 'gold', 'gold', 'gold', 'legend', 'legend', 'legend'];

/** A rank emblem: a shield with chevrons (1-3 by rank within the color) and the level number. */
export function rankEmblem(level: number, size = 64): string {
  const tier = Math.min(11, Math.floor((level - 1) / 3));
  const chevrons = (tier % 3) + 1;
  let marks = '';
  for (let i = 0; i < chevrons; i++) marks += `<path d="M30 ${70 + i * 9}l20 -9 20 9" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>`;
  const stars = tier >= 9 ? '<path d="M50 8l3 6 6.5 1-4.8 4.5 1.2 6.5-5.9-3.2-5.9 3.2 1.2-6.5L40.5 15l6.5-1z" fill="currentColor"/>' : '';
  return `<div class="rank-emblem tier-${TIER_CLASS[tier]}" style="--size:${size}px">
    <svg viewBox="0 0 100 100"><path class="re-shield" d="M50 4l40 14v30c0 24-17 40-40 48C27 88 10 72 10 48V18z"/>
    <path class="re-inner" d="M50 12l32 11v25c0 19-13 32-32 39-19-7-32-20-32-39V23z"/>${stars}${marks}</svg>
    <div class="re-level">${level}</div></div>`;
}

/** The main menu's player card: emblem, level, rank, XP bar, career stats. */
export function playerCard(): HTMLElement {
  const c = progress.get();
  const L = levelInfo(c.xp);
  const el = document.createElement('div');
  el.className = 'player-card glass-card';
  const kd = c.deaths ? (c.kills / c.deaths).toFixed(2) : c.kills.toFixed(2);
  const medals = Object.values(c.medals).reduce((a, b) => a + b, 0);
  el.innerHTML = `
    <div class="pc-top">${rankEmblem(L.level, 64)}
      <div class="pc-id"><div class="pc-name">Level ${L.level}</div><div class="pc-rank">${L.rank}</div>
        <div class="xp-bar"><div class="xp-fill" style="width:${((100 * L.into) / L.need).toFixed(1)}%"></div></div>
        <div class="pc-xp">${L.into.toLocaleString('en-US')} / ${L.need.toLocaleString('en-US')} XP</div></div></div>
    <div class="pc-stats">
      ${stat('Matches', c.matches)}${stat('Wins', c.wins)}${stat('Kills', c.kills)}${stat('K/D', kd)}${stat('Best streak', c.bestStreak)}${stat('Medals', medals)}
    </div>`;
  return el;
}

/** The main menu's daily challenges card. */
export function dailyCard(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'daily-card glass-card';
  const list = daily.get();
  const doneCount = list.filter((c) => c.done).length;
  el.innerHTML = `<div class="dc-head"><span>Daily challenges</span><span class="dc-left">${doneCount}/3 · New in ${daily.timeLeft()}</span></div>` +
    list.map((c) => `<div class="dc-row tier-${c.challenge.tier}${c.done ? ' done' : ''}">
      <div class="dc-top"><span class="dc-text">${c.challenge.text}</span><span class="dc-xp">${c.done ? '✓' : `+${c.xp.toLocaleString('en-US')} XP`}</span></div>
      <div class="ch-bar"><div class="ch-fill" style="width:${((100 * (c.done ? c.challenge.target : c.progress)) / c.challenge.target).toFixed(1)}%"></div></div>
      <div class="dc-count">${tierName(c.challenge.tier)} · ${c.done ? 'Complete' : `${Math.floor(c.progress).toLocaleString('en-US')} / ${c.challenge.target.toLocaleString('en-US')}`}</div></div>`).join('') +
    `<div class="dc-note">Play on Easy or harder to make progress.</div>`;
  return el;
}

function stat(label: string, value: string | number): string {
  return `<div class="pc-stat"><div class="pc-stat-v">${typeof value === 'number' ? value.toLocaleString('en-US') : value}</div><div class="pc-stat-l">${label}</div></div>`;
}

/** The match report on the end screen. Animates in; returns a function that stops the animation. */
export function matchReport(parent: HTMLElement, r: EndReport): () => void {
  const s = r.summary;
  // Timers and animation frames are kept apart: their ids are separate number sequences, and
  // cancelling a frame by a timer's id could cancel someone else's frame (like the game loop).
  const timers: number[] = [];
  const frames: number[] = [];
  const later = (ms: number, f: () => void) => timers.push(window.setTimeout(f, ms));
  const wrap = document.createElement('div');
  wrap.className = 'report';
  parent.appendChild(wrap);

  // ---- XP and level ----
  const before = levelInfo(r.before.xp);
  const xpBox = add(wrap, 'report-xp');
  xpBox.innerHTML = `
    <div class="rx-emblem">${rankEmblem(before.level, 76)}</div>
    <div class="rx-main">
      <div class="rx-head"><span class="rx-level">Level <b>${before.level}</b></span><span class="rx-rank">${before.rank}</span><span class="rx-gain">+<b>0</b> XP</span></div>
      <div class="xp-bar big"><div class="xp-fill" style="width:${((100 * before.into) / before.need).toFixed(1)}%"></div><div class="xp-gain"></div></div>
      <div class="rx-foot"><span class="rx-into">${before.into.toLocaleString('en-US')} / ${before.need.toLocaleString('en-US')} XP</span><span class="rx-next">Next: Level ${before.level + 1}</span></div>
    </div>
    <div class="rx-levelup">Level up!</div>`;

  // ---- Stat tiles ----
  const tiles = add(wrap, 'report-tiles');
  const kd = s.deaths ? s.kills / s.deaths : s.kills;
  const hsPct = s.kills ? Math.round((100 * s.headshots) / s.kills) : 0;
  const mm = Math.floor(r.time / 60), ss = Math.floor(r.time % 60);
  const tileDefs: [string, number, (v: number) => string, string?][] = [
    ['Score', s.score, (v) => Math.round(v).toLocaleString('en-US'), 'hero'],
    ['Kills', s.kills, (v) => String(Math.round(v))],
    ['Deaths', s.deaths, (v) => String(Math.round(v))],
    ['K/D', kd, (v) => v.toFixed(2)],
    ['Accuracy', r.accuracy, (v) => `${Math.round(v)}%`],
    ['Headshot kills', hsPct, (v) => `${Math.round(v)}%`],
    ['Damage', s.damage, (v) => Math.round(v).toLocaleString('en-US')],
    ['Best streak', s.bestStreak, (v) => String(Math.round(v))],
    ['Longest kill', s.longestKill, (v) => `${Math.round(v)} m`],
    ['Time', r.time, () => `${mm}:${String(ss).padStart(2, '0')}`],
  ];
  // Tiles that set a new personal best get a badge.
  const bestOf: Record<string, keyof Bests> = { Score: 'score', Kills: 'kills', Accuracy: 'accuracy', Damage: 'damage', 'Best streak': 'streak', 'Longest kill': 'longestKill' };
  const newBests = new Set(r.record?.newBests ?? []);
  const tileEls = tileDefs.map(([label, , fmt, cls]) => {
    const isBest = bestOf[label] && newBests.has(bestOf[label]);
    const t = add(tiles, `report-tile ${cls ?? ''}${isBest ? ' best' : ''}`);
    t.innerHTML = `<div class="rt-v">${fmt(0)}</div><div class="rt-l">${label}</div>${isBest ? `<div class="rt-best">${r.record?.firstRecords ? 'First record' : 'New best!'}</div>` : ''}`;
    return t.querySelector('.rt-v') as HTMLElement;
  });

  // ---- Medals ----
  const medalBox = add(wrap, 'report-medals');
  const earned = Object.entries(s.medals).filter(([id]) => MEDALS[id]).sort((a, b) => tierRank(MEDALS[b[0]].tier) - tierRank(MEDALS[a[0]].tier));
  medalBox.innerHTML = `<div class="section-title">Medals</div>`;
  const medalList = add(medalBox, 'rm-list');
  if (!earned.length) medalList.innerHTML = '<div class="rm-none">No medals this time. Get two kills in quick succession, or three without dying, to start earning them.</div>';
  earned.forEach(([id, n], i) => {
    const m = add(medalList, 'rm-item');
    m.innerHTML = `${medalHtml(MEDALS[id], n)}<div class="rm-name">${MEDALS[id].name}</div><div class="rm-info">${MEDALS[id].info}</div>`;
    m.style.animationDelay = `${0.9 + i * 0.12}s`;
  });

  // ---- Records: achievements, map stars, survival record, best multikill ----
  const rec = r.record;
  const multiBest = newBests.has('multi') && s.bestMulti >= 2;
  if (rec && (rec.achievements.length || rec.stars[1] > rec.stars[0] || rec.survivalRecord || multiBest)) {
    const box = add(wrap, 'report-records');
    box.innerHTML = `<div class="section-title">Records &amp; achievements</div>`;
    const list = add(box, 'rr-list');
    rec.achievements.forEach((a, i) => {
      const it = add(list, 'rr-item achievement');
      it.innerHTML = `${medalHtml({ name: a.name, tier: a.tier, icon: a.icon, info: a.info })}<div class="rr-text"><div class="rr-eyebrow">Achievement unlocked</div><div class="rr-name">${a.name}</div><div class="rr-info">${a.info}</div></div><div class="rr-xp">+${ACHIEVEMENT_XP[a.tier].toLocaleString('en-US')} XP</div>`;
      it.style.animationDelay = `${1.1 + i * 0.15}s`;
    });
    if (rec.stars[1] > rec.stars[0]) {
      const it = add(list, 'rr-item');
      it.innerHTML = `<div class="rr-stars">${'★'.repeat(rec.stars[1])}<span>${'★'.repeat(3 - rec.stars[1])}</span></div><div class="rr-text"><div class="rr-eyebrow">New map star${rec.stars[1] - rec.stars[0] > 1 ? 's' : ''}</div><div class="rr-name">${r.map}</div><div class="rr-info">★ win · ★★ win on Hard or Insane · ★★★ win on Insane</div></div>`;
    }
    if (rec.survivalRecord) {
      const it = add(list, 'rr-item');
      it.innerHTML = `<div class="rr-big">${rec.survivalRecord.after}</div><div class="rr-text"><div class="rr-eyebrow">New survival record</div><div class="rr-name">${rec.survivalRecord.after} wave${rec.survivalRecord.after === 1 ? '' : 's'} cleared on ${r.map}</div><div class="rr-info">${rec.survivalRecord.before ? `Your best was ${rec.survivalRecord.before}` : 'Your first survival record here'}</div></div>`;
    }
    if (multiBest) {
      const it = add(list, 'rr-item');
      it.innerHTML = `<div class="rr-big">×${s.bestMulti}</div><div class="rr-text"><div class="rr-eyebrow">New best</div><div class="rr-name">Biggest multikill</div><div class="rr-info">${s.bestMulti} kills in quick succession</div></div>`;
    }
  }

  // ---- Daily challenges: how far this match took each one ----
  if (r.challenges?.length) {
    const box = add(wrap, 'report-challenges');
    box.innerHTML = `<div class="section-title">Daily challenges</div>`;
    const grid = add(box, 'rc-list');
    r.challenges.forEach((c, i) => {
      const row = add(grid, `rc-item tier-${c.tier}${c.done ? ' done' : ''}${c.justDone ? ' just' : ''}`);
      const pct = (v: number) => `${((100 * v) / c.target).toFixed(1)}%`;
      row.innerHTML = `<div class="rc-top"><span class="rc-tier">${tierName(c.tier)}</span><span class="rc-xp">${c.justDone ? `+${c.xp.toLocaleString('en-US')} XP` : c.done ? 'Done' : `${c.xp.toLocaleString('en-US')} XP`}</span></div>
        <div class="rc-text">${c.text}</div>
        <div class="rc-bar"><div class="rc-was" style="width:${pct(c.start)}"></div><div class="rc-now" style="--from:${pct(c.start)};--to:${pct(c.current)};animation-delay:${1.2 + i * 0.25}s"></div></div>
        <div class="rc-count">${c.done ? 'Complete' : `${Math.floor(c.current).toLocaleString('en-US')} / ${c.target.toLocaleString('en-US')}`}${c.current > c.start && !c.done ? ` <b>(+${Math.floor(c.current - c.start).toLocaleString('en-US')})</b>` : ''}</div>`;
    });
  }

  // ---- XP breakdown + weapons ----
  const cols = add(wrap, 'report-cols');
  const xpList = add(cols, 'report-breakdown');
  xpList.innerHTML = `<div class="section-title">XP earned</div>` +
    r.xpLines.map(([l, v]) => `<div class="rb-line"><span>${l}</span><span class="rb-v">+${v.toLocaleString('en-US')}</span></div>`).join('') +
    (r.multiplier === 1 ? '' : r.multiplier === 0
      ? `<div class="rb-line none"><span>${r.difficulty} difficulty: no XP</span><span class="rb-v">×0</span></div><div class="rb-note">${r.difficulty} is practice: this match doesn't count toward your XP or career stats. Play on Easy or harder to earn XP (the harder the bots, the more you get).</div>`
      : `<div class="rb-line bonus"><span>${r.difficulty} difficulty ×${r.multiplier}</span><span class="rb-v">+${(r.xp - (r.challengeXp ?? 0) - r.baseXp).toLocaleString('en-US')}</span></div>`) +
    (r.challengeXp ? `<div class="rb-line bonus"><span>Daily challenges</span><span class="rb-v">+${r.challengeXp.toLocaleString('en-US')}</span></div>` : '') +
    (r.record?.achievementXp ? `<div class="rb-line bonus"><span>Achievements</span><span class="rb-v">+${r.record.achievementXp.toLocaleString('en-US')}</span></div>` : '') +
    `<div class="rb-line total"><span>Total</span><span class="rb-v">+${r.xp.toLocaleString('en-US')} XP</span></div>`;
  const wl = add(cols, 'report-weapons');
  const wk = Object.entries(s.weaponKills) as [WeaponId | 'grenade', number][];
  const maxK = Math.max(1, ...wk.map(([, n]) => n));
  wl.innerHTML = `<div class="section-title">Kills by weapon</div>` + (wk.length
    ? wk.sort((a, b) => b[1] - a[1]).map(([w, n]) => `<div class="rw-line"><span class="rw-name">${w === 'grenade' ? 'Grenades' : WEAPONS[w].name}</span><div class="rw-bar"><div class="rw-fill" style="--w:${((100 * n) / maxK).toFixed(0)}%"></div></div><span class="rw-n">${n}</span></div>`).join('')
    : '<div class="rm-none">No kills this match.</div>');

  // ---- Animation: tiles count up one after another, then the XP bar fills ----
  tileDefs.forEach(([, value, fmt], i) => {
    later(250 + i * 90, () => {
      const el = tileEls[i];
      el.parentElement!.classList.add('in');
      if (value > 0) audio.play('stat_slam');
      const start = performance.now(), dur = 600;
      const step = () => {
        const t = Math.min(1, (performance.now() - start) / dur);
        el.textContent = fmt(value * (1 - Math.pow(1 - t, 3)));
        if (t < 1) frames.push(requestAnimationFrame(step));
      };
      step();
    });
  });
  later(250 + tileDefs.length * 90 + 500, () => animateXp(xpBox, r, later));
  return () => {
    timers.forEach((t) => clearTimeout(t));
    frames.forEach((f) => cancelAnimationFrame(f));
  };
}

function animateXp(box: HTMLElement, r: EndReport, later: (ms: number, f: () => void) => void): void {
  const fill = box.querySelector('.xp-fill') as HTMLElement;
  const gainEl = box.querySelector('.rx-gain b') as HTMLElement;
  const levelEl = box.querySelector('.rx-level b') as HTMLElement;
  const rankEl = box.querySelector('.rx-rank') as HTMLElement;
  const intoEl = box.querySelector('.rx-into') as HTMLElement;
  const nextEl = box.querySelector('.rx-next') as HTMLElement;
  const emblem = box.querySelector('.rx-emblem') as HTMLElement;
  let xp = r.before.xp;
  const end = r.after.xp;
  let shown = 0;
  let level = levelInfo(xp).level;
  // Fill in steps so each level-up gets its moment.
  const tick = () => {
    if (xp >= end) {
      gainEl.textContent = r.xp.toLocaleString('en-US');
      return;
    }
    const L = levelInfo(xp);
    const stepXp = Math.max(1, Math.min(end - xp, Math.ceil((L.need) / 40)));
    xp += stepXp;
    shown = Math.min(r.xp, shown + stepXp);
    gainEl.textContent = shown.toLocaleString('en-US');
    const N = levelInfo(xp);
    if (N.level > level) {
      // Level up: fill to the end, flash, then start the next level's bar.
      level = N.level;
      fill.style.width = '100%';
      audio.play('levelup');
      box.classList.remove('leveled');
      void box.offsetWidth;
      box.classList.add('leveled');
      later(380, () => {
        fill.style.transition = 'none';
        fill.style.width = '0%';
        void fill.offsetWidth;
        fill.style.transition = '';
        levelEl.textContent = String(N.level);
        rankEl.textContent = N.rank;
        nextEl.textContent = `Next: Level ${N.level + 1}`;
        emblem.innerHTML = rankEmblem(N.level, 76);
        later(260, tick);
      });
      return;
    }
    fill.style.width = `${((100 * N.into) / N.need).toFixed(1)}%`;
    intoEl.textContent = `${N.into.toLocaleString('en-US')} / ${N.need.toLocaleString('en-US')} XP`;
    if (Math.random() < 0.5) audio.play('tick');
    later(28, tick);
  };
  tick();
}

function tierRank(t: string): number {
  return ['bronze', 'silver', 'gold', 'legend'].indexOf(t);
}

function add(parent: HTMLElement, className: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = className;
  parent.appendChild(d);
  return d;
}
