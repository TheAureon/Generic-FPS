import * as THREE from 'three';
import type { MedalDef, MedalTier, RewardsDisplay } from '../core/Rewards';

/**
 * The fun part of the HUD: floating damage numbers, the score popup next to
 * the crosshair ("+150 · Eliminated Viper · Headshot"), medals popping in,
 * big call-outs ("TRIPLE KILL"), the streak and score badge, and a golden
 * flash at the screen edges on each kill.
 *
 * Everything appears at once and is then moved/faded by code, so it always
 * shows even on a slow computer.
 */

/** Small icons for medals (24 x 24, drawn in the medal's color). */
export const MEDAL_ICONS: Record<string, string> = {
  skull: '<path d="M12 3c-4.4 0-8 3.1-8 7.5 0 2.6 1.3 4.3 3 5.3V19h2v-2h2v2h2v-2h2v2h2v-3.2c1.7-1 3-2.7 3-5.3C20 6.1 16.4 3 12 3zm-3.5 9.5a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6zm7 0a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6z"/>',
  drop: '<path d="M12 2.5S5.5 10 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 10 12 2.5 12 2.5z"/>',
  scope: '<circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="1.6"/>',
  burst: '<path d="M12 2l2.2 5.6L20 6l-3.6 4.6L22 13l-5.8 1.4L18 20l-6-3-6 3 1.8-5.6L2 13l5.6-2.4L4 6l5.8 1.6z"/>',
  heart: '<path d="M12 21s-8-5.2-8-11a4.6 4.6 0 0 1 8-3 4.6 4.6 0 0 1 8 3c0 5.8-8 11-8 11z"/><path d="M5 12h4l1.5-3 3 6 1.5-3h4" fill="none" stroke="#14110a" stroke-width="1.6" stroke-linejoin="round"/>',
  revenge: '<path d="M4 4l7 7-2 2-7-7zM20 4l-7 7 2 2 7-7zM6 16l2 2-3 3-2-2zM18 16l-2 2 3 3 2-2zM9 13l6-6 2 2-6 6zM15 13l-6-6-2 2 6 6z"/>',
  rise: '<path d="M3 18l6-6 4 4 7-8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 6h6v6z"/>',
  stop: '<path d="M8 2h8l6 6v8l-6 6H8l-6-6V8z"/><path d="M7 12h10" stroke="#14110a" stroke-width="2.6" stroke-linecap="round"/>',
  pierce: '<path d="M2 12h16l-4-4M18 12l-4 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="12" r="2.6"/><circle cx="13" cy="12" r="2.6"/>',
  shield: '<path d="M12 2l8 3v6c0 5-3.4 9-8 11-4.6-2-8-6-8-11V5z"/><path d="M8 12l3 3 5-6" fill="none" stroke="#14110a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  flame: '<path d="M12 2c1 4 5 5.5 5 11a5 5 0 0 1-10 0c0-2.4 1.2-3.8 2.4-5 .3 2 1.2 3 2.3 3.4C11 8.5 11 5 12 2z"/>',
  crown: '<path d="M3 18h18l-1.6-10-4.9 4.6L12 5l-2.5 7.6L4.6 8z"/><path d="M4 20h16" stroke="currentColor" stroke-width="2"/>',
  x2: '<text x="12" y="17" text-anchor="middle" font-size="14" font-weight="800" font-family="Rajdhani, sans-serif">×2</text>',
  x3: '<text x="12" y="17" text-anchor="middle" font-size="14" font-weight="800" font-family="Rajdhani, sans-serif">×3</text>',
  x4: '<text x="12" y="17" text-anchor="middle" font-size="14" font-weight="800" font-family="Rajdhani, sans-serif">×4</text>',
  x5: '<text x="12" y="17" text-anchor="middle" font-size="14" font-weight="800" font-family="Rajdhani, sans-serif">×5</text>',
};

/** A medal badge (also used on the end screen). */
export function medalHtml(def: MedalDef, count = 0): string {
  return `<div class="medal tier-${def.tier}"><div class="medal-badge"><svg viewBox="0 0 24 24" fill="currentColor">${MEDAL_ICONS[def.icon] ?? ''}</svg></div>${count > 1 ? `<div class="medal-count">×${count}</div>` : ''}</div>`;
}

interface Floater {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  age: number;
  drift: number;
}

const FLOAT_LIFE = 0.9;

export class RewardsHud implements RewardsDisplay {
  private floatLayer: HTMLDivElement;
  private floaters: Floater[] = [];
  private scoreEl: HTMLDivElement;
  private scoreTotal: HTMLDivElement;
  private scoreLines: HTMLDivElement;
  private scoreTimer = 0;
  private scoreShown = 0;
  private scoreTarget = 0;
  private calloutEl: HTMLDivElement;
  private calloutTimer = 0;
  private medalRow: HTMLDivElement;
  private medals: { el: HTMLDivElement; life: number }[] = [];
  private badge: HTMLDivElement;
  private badgeScore: HTMLSpanElement;
  private badgeStreak: HTMLDivElement;
  private badgeStreakNum: HTMLSpanElement;
  private flash: HTMLDivElement;
  private flashAmount = 0;
  private _v = new THREE.Vector3();

  constructor(root: HTMLElement) {
    this.flash = div('fx-killflash', root);
    this.floatLayer = div('fx-floaters', root);
    this.scoreEl = div('fx-score', root);
    this.scoreTotal = div('fx-score-total', this.scoreEl);
    this.scoreLines = div('fx-score-lines', this.scoreEl);
    this.calloutEl = div('fx-callout', root);
    this.medalRow = div('fx-medals', root);
    this.badge = div('fx-badge glass', root);
    this.badge.innerHTML = '<div class="fx-badge-score"><span class="fx-badge-label">Score</span><span class="fx-badge-value">0</span></div><div class="fx-badge-streak"><svg viewBox="0 0 24 24" fill="currentColor">' + MEDAL_ICONS.flame + '</svg><span>0</span></div>';
    this.badgeScore = this.badge.querySelector('.fx-badge-value')!;
    this.badgeStreak = this.badge.querySelector('.fx-badge-streak')!;
    this.badgeStreakNum = this.badgeStreak.querySelector('span')!;
    this.reset();
  }

  reset(): void {
    this.floatLayer.innerHTML = '';
    this.floaters = [];
    this.scoreTimer = 0;
    this.scoreEl.style.opacity = '0';
    this.calloutTimer = 0;
    this.calloutEl.style.opacity = '0';
    this.medalRow.innerHTML = '';
    this.medals = [];
    this.flashAmount = 0;
    this.badgeScore.textContent = '0';
    this.streak(0);
  }

  // ---- RewardsDisplay ----

  score(lines: { label: string; points: number }[], total: number): void {
    // Stack onto the popup if it's still up, so a fast double kill reads "+350".
    if (this.scoreTimer <= 0) {
      this.scoreLines.innerHTML = '';
      this.scoreShown = 0;
      this.scoreTarget = 0;
    }
    for (const l of lines) {
      const row = div('fx-score-line', this.scoreLines);
      row.innerHTML = `<span class="pts">+${l.points}</span><span>${esc(l.label)}</span>`;
      this.scoreTarget += l.points;
    }
    while (this.scoreLines.children.length > 6) this.scoreLines.firstElementChild!.remove();
    this.scoreTimer = 2.2;
    this.scoreEl.style.opacity = '1';
    restart(this.scoreEl, 'pop');
    this.badgeScore.textContent = total.toLocaleString('en-US');
    restart(this.badge, 'bump');
  }

  medal(_id: string, def: MedalDef): void {
    const wrap = div('fx-medal', this.medalRow);
    wrap.innerHTML = `${medalHtml(def)}<div class="fx-medal-name">${esc(def.name)}</div>`;
    this.medals.push({ el: wrap, life: 3.2 });
    while (this.medals.length > 5) this.medals.shift()!.el.remove();
  }

  callout(title: string, sub: string, tier: MedalTier): void {
    this.calloutEl.className = `fx-callout tier-${tier}`;
    this.calloutEl.innerHTML = `<div class="fx-callout-title">${esc(title)}</div><div class="fx-callout-sub">${esc(sub)}</div>`;
    this.calloutEl.style.opacity = '1';
    restart(this.calloutEl, 'slam');
    this.calloutTimer = 2.4;
  }

  streak(count: number): void {
    this.badgeStreak.classList.toggle('on', count >= 2);
    this.badgeStreak.classList.toggle('hot', count >= 5);
    this.badgeStreakNum.textContent = String(count);
    if (count >= 2) restart(this.badgeStreak, 'bump');
  }

  killFlash(headshot: boolean): void {
    this.flash.classList.toggle('head', headshot);
    this.flashAmount = 1;
  }

  // ---- Damage numbers ----

  /** A number rising from where a bullet hit. */
  damageNumber(point: THREE.Vector3, amount: number, head: boolean, killed: boolean): void {
    const e = div(`fx-dmg${head ? ' head' : ''}${killed ? ' kill' : ''}`, this.floatLayer);
    e.textContent = String(Math.max(1, Math.round(amount)));
    // Bigger hits get bigger numbers.
    e.style.setProperty('--s', Math.min(1.6, 0.85 + amount / 120).toFixed(2));
    this.floaters.push({ el: e, pos: point.clone(), age: 0, drift: (Math.random() - 0.5) * 30 });
    while (this.floaters.length > 24) this.floaters.shift()!.el.remove();
  }

  /** Move everything along. Call every frame with the camera (for the damage numbers). */
  update(dt: number, camera: THREE.Camera): void {
    const W = window.innerWidth, H = window.innerHeight;
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.age += dt;
      if (f.age >= FLOAT_LIFE) {
        f.el.remove();
        this.floaters.splice(i, 1);
        continue;
      }
      const v = this._v.copy(f.pos).project(camera);
      if (v.z > 1) {
        f.el.style.visibility = 'hidden';
        continue;
      }
      const t = f.age / FLOAT_LIFE;
      const x = ((v.x + 1) / 2) * W + f.drift * t;
      const y = ((1 - v.y) / 2) * H - 26 - 60 * t;
      // Pops big, settles, then fades in the last third.
      const pop = t < 0.12 ? 1.5 - (t / 0.12) * 0.5 : 1;
      f.el.style.visibility = 'visible';
      f.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(calc(var(--s) * ${pop.toFixed(2)}))`;
      f.el.style.opacity = (t < 0.66 ? 1 : 1 - (t - 0.66) / 0.34).toFixed(2);
    }

    if (this.scoreTimer > 0) {
      this.scoreTimer -= dt;
      // The total counts up quickly.
      if (this.scoreShown < this.scoreTarget) {
        this.scoreShown = Math.min(this.scoreTarget, this.scoreShown + Math.max(5, (this.scoreTarget - this.scoreShown) * dt * 12));
        this.scoreTotal.textContent = `+${Math.round(this.scoreShown)}`;
      }
      this.scoreEl.style.opacity = Math.min(1, this.scoreTimer * 2.5).toFixed(2);
    }
    if (this.calloutTimer > 0) {
      this.calloutTimer -= dt;
      this.calloutEl.style.opacity = Math.min(1, this.calloutTimer * 2).toFixed(2);
    }
    for (let i = this.medals.length - 1; i >= 0; i--) {
      const m = this.medals[i];
      m.life -= dt;
      if (m.life <= 0) {
        m.el.remove();
        this.medals.splice(i, 1);
      } else m.el.style.opacity = Math.min(1, m.life * 2).toFixed(2);
    }
    this.flashAmount = Math.max(0, this.flashAmount - dt * 3);
    this.flash.style.opacity = this.flashAmount.toFixed(2);
  }
}

function div(className: string, parent: HTMLElement): HTMLDivElement {
  const e = document.createElement('div');
  e.className = className;
  parent.appendChild(e);
  return e;
}

/** Restart a CSS animation class. */
function restart(e: HTMLElement, cls: string): void {
  e.classList.remove(cls);
  void e.offsetWidth;
  e.classList.add(cls);
}

function esc(t: string): string {
  return t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}
