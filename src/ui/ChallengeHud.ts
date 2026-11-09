import type { ChallengeStatus } from '../core/Challenges';

/**
 * Daily challenges during a match: a small tracker on the right (each
 * challenge's progress, which pulses when it goes up) and a big banner
 * when one is completed.
 */
export class ChallengeHud {
  private panel: HTMLDivElement;
  private rows: { el: HTMLDivElement; text: HTMLDivElement; count: HTMLSpanElement; fill: HTMLDivElement; last: number }[] = [];
  private note: HTMLDivElement;
  private banner: HTMLDivElement;
  private bannerTimer = 0;
  private lastKey = '';

  constructor(root: HTMLElement) {
    this.panel = div('ch-panel glass', root);
    const head = div('ch-head', this.panel);
    head.textContent = 'Challenges';
    this.note = div('ch-note', this.panel);
    this.banner = div('ch-banner', root);
    this.reset();
  }

  reset(): void {
    this.lastKey = '';
    this.bannerTimer = 0;
    this.banner.style.opacity = '0';
    for (const r of this.rows) r.last = -1;
  }

  set(list: ChallengeStatus[], practice: boolean): void {
    const key = list.map((s) => `${s.current}/${s.done}`).join('|') + practice;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.panel.classList.toggle('practice', practice);
    this.note.textContent = practice ? 'Practice difficulty: challenges don’t count' : '';
    // (Rows are made as needed: three daily, three weekly.)
    while (this.rows.length < list.length) {
      const el = document.createElement('div');
      this.panel.insertBefore(el, this.note);
      const top = div('chr-top', el);
      const text = div('ch-text', top);
      const count = document.createElement('span');
      count.className = 'ch-count';
      top.appendChild(count);
      const fill = div('ch-fill', div('ch-bar', el));
      this.rows.push({ el, text, count, fill, last: -1 });
    }
    list.forEach((s, i) => {
      const r = this.rows[i];
      r.el.className = `ch-row tier-${s.tier}${s.done ? ' done' : ''}${s.weekly ? ' weekly' : ''}`;
      r.text.innerHTML = `${s.weekly ? '<span class="ch-tag">Weekly</span>' : ''}${esc(s.text)}`;
      r.count.textContent = s.done ? '✓' : `${fmt(s.current)}/${fmt(s.target)}`;
      r.fill.style.width = `${((100 * s.current) / s.target).toFixed(1)}%`;
      // Progress went up: a little pulse.
      if (r.last >= 0 && s.current > r.last) {
        r.el.classList.remove('bump');
        void r.el.offsetWidth;
        r.el.classList.add('bump');
      }
      r.last = s.current;
    });
  }

  complete(s: ChallengeStatus): void {
    this.banner.className = `ch-banner tier-${s.tier}`;
    this.banner.innerHTML = `<div class="chb-eyebrow">${s.weekly ? 'Weekly' : 'Daily'} challenge complete</div><div class="chb-text">${esc(s.text)}</div><div class="chb-xp">+${s.xp.toLocaleString('en-US')} XP</div>`;
    this.banner.style.opacity = '1';
    this.banner.classList.add('in');
    this.bannerTimer = 4;
  }

  update(dt: number): void {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      this.banner.style.opacity = Math.min(1, this.bannerTimer * 2).toFixed(2);
    }
  }
}

const fmt = (n: number) => (n >= 1000 ? n.toLocaleString('en-US') : String(Math.floor(n)));

function div(className: string, parent: HTMLElement): HTMLDivElement {
  const e = document.createElement('div');
  e.className = className;
  parent.appendChild(e);
  return e;
}

function esc(t: string): string {
  return t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}
