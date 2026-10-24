import { RewardsHud } from './RewardsHud';
import { CONFIG, TEAMS, WEAPONS, type WeaponId } from '../config';
import { settings } from '../core/Settings';
import type { PickupType } from '../map/MapTypes';
import type { ScoreRow } from '../modes/GameMode';
import { Minimap } from './Minimap';

export type HitmarkerKind = 'hit' | 'head' | 'kill';

export interface AmmoInfo {
  weapon: WeaponId;
  ammo: number;
  magazine: number;
  reserve: number;
  reloadProgress: number; // 0 when not reloading
}

/** Small inline icons (drawn with SVG so they stay crisp at any size). */
const ICON = {
  health: '<svg viewBox="0 0 24 24"><path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z"/></svg>',
  armor: '<svg viewBox="0 0 24 24"><path d="M12 1 3 4.5v6.2c0 5.6 3.8 10.4 9 12.3 5.2-1.9 9-6.7 9-12.3V4.5z"/></svg>',
  head: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="12" cy="12" r="3"/></svg>',
  ammo: '<svg viewBox="0 0 24 24"><path d="M7 22V9l2.5-6L12 9v13zm6 0V9l2.5-6L18 9v13z"/></svg>',
};

/** Short weapon names for the slot chips. */
const SHORT: Record<WeaponId, string> = { pistol: 'Pistol', rifle: 'Rifle', shotgun: 'Shotgun', sniper: 'Sniper' };

/**
 * In-game heads-up display: crosshair, hit markers, health/armor, weapon and
 * ammo, kill feed, match status bar, minimap, damage direction, death screen,
 * scoreboard. Built from plain page elements styled in style.css.
 */
export class Hud {
  private root: HTMLDivElement;
  private debugEl: HTMLDivElement;
  private crosshair: HTMLDivElement;
  private hitmarker: HTMLDivElement;
  private weaponPanel: HTMLDivElement;
  private ammoName: HTMLDivElement;
  private ammoNumber: HTMLSpanElement;
  private ammoReserve: HTMLSpanElement;
  private pips: HTMLDivElement;
  private pipEls: HTMLDivElement[] = [];
  private pipWeapon: WeaponId | null = null;
  private reloadBar: HTMLDivElement;
  private reloadFill: HTMLDivElement;
  private slots = new Map<WeaponId, HTMLDivElement>();
  private scope: HTMLDivElement;
  private notice: HTMLDivElement;
  private healthFill: HTMLDivElement;
  private healthTrail: HTMLDivElement;
  private healthText: HTMLDivElement;
  private healthRow: HTMLDivElement;
  private armorFill: HTMLDivElement;
  private armorText: HTMLDivElement;
  private armorRow: HTMLDivElement;
  private vignette: HTMLDivElement;
  private lowHealth: HTMLDivElement;
  private indicators: { el: HTMLDivElement; x: number; z: number; life: number }[] = [];
  private killFeed: HTMLDivElement;
  private deathScreen: HTMLDivElement;
  private deathText: HTMLDivElement;
  private deathTimer: HTMLDivElement;
  private deathRing: SVGCircleElement;
  private deathCount: HTMLDivElement;
  private hurtFlash = 0;
  private lastAmmo = '';
  private lastVitals = '';
  private lastGap = '';
  private lastStatus = '';
  private statusEl: HTMLDivElement;
  private announceEl: HTMLDivElement;
  private announceTitle: HTMLDivElement;
  private announceSub: HTMLDivElement;
  private announceTimer = 0;
  private pickupEl: HTMLDivElement;
  private pickupTimer = 0;
  private scoreboardEl: HTMLDivElement;
  private markersEl: HTMLDivElement;
  private markerEls: HTMLDivElement[] = [];
  private objectiveEl: HTMLDivElement;
  private objectiveLabel: HTMLDivElement;
  private objectiveFill: HTMLDivElement;
  private lastObjective = '';
  readonly minimap: Minimap;
  /** Damage numbers, score popups, medals, call-outs. */
  readonly fx: RewardsHud;

  private hitTimer = 0;
  private frames = 0;
  private fpsTimer = 0;
  private fps = 0;
  showDebug = false;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud', parent);
    this.vignette = el('div', 'hurt-vignette', this.root);
    this.lowHealth = el('div', 'low-health', this.root);
    this.scope = el('div', 'scope', this.root);
    el('div', 'scope-lines', this.scope);

    this.crosshair = el('div', 'crosshair', this.root);
    for (const side of ['top', 'bottom', 'left', 'right']) el('div', `ch-line ch-${side}`, this.crosshair);
    el('div', 'ch-dot', this.crosshair);

    this.hitmarker = el('div', 'hitmarker', this.root);
    for (let i = 0; i < 4; i++) el('div', 'hm-line', this.hitmarker);

    this.notice = el('div', 'notice', this.root);
    this.fx = new RewardsHud(this.root);

    // ---- Weapon + ammo, bottom right ----
    this.weaponPanel = el('div', 'weapon-panel glass', this.root);
    const slotList = el('div', 'slots', this.weaponPanel);
    for (const id of Object.keys(WEAPONS) as WeaponId[]) {
      const s = el('div', 'slot', slotList);
      s.innerHTML = `<span class="key">${WEAPONS[id].slot}</span><span class="slot-name">${SHORT[id]}</span>`;
      this.slots.set(id, s);
    }
    this.ammoName = el('div', 'ammo-name', this.weaponPanel);
    const count = el('div', 'ammo-count', this.weaponPanel);
    this.ammoNumber = document.createElement('span');
    this.ammoNumber.className = 'ammo-mag';
    this.ammoReserve = document.createElement('span');
    this.ammoReserve.className = 'ammo-reserve';
    const icon = document.createElement('span');
    icon.className = 'ammo-icon';
    icon.innerHTML = ICON.ammo;
    count.append(this.ammoNumber, icon, this.ammoReserve);
    this.pips = el('div', 'pips', this.weaponPanel);
    this.reloadBar = el('div', 'reload-bar', this.weaponPanel);
    this.reloadFill = el('div', 'reload-fill', this.reloadBar);

    // Damage direction indicators: arcs around the crosshair.
    const ring = el('div', 'dmg-ring', this.root);
    for (let i = 0; i < 6; i++) {
      const ind = el('div', 'dmg-indicator', ring);
      this.indicators.push({ el: ind, x: 0, z: 0, life: 0 });
    }

    // ---- Health + armor, bottom left ----
    const vitals = el('div', 'vitals glass', this.root);
    this.healthRow = el('div', 'vital-row health-row', vitals);
    el('div', 'vital-icon health-icon', this.healthRow).innerHTML = ICON.health;
    this.healthText = el('div', 'vital-num', this.healthRow);
    const hBar = el('div', 'vital-bar', this.healthRow);
    this.healthTrail = el('div', 'vital-trail', hBar);
    this.healthFill = el('div', 'vital-fill health-fill', hBar);
    this.armorRow = el('div', 'vital-row armor-row', vitals);
    el('div', 'vital-icon armor-icon', this.armorRow).innerHTML = ICON.armor;
    this.armorText = el('div', 'vital-num', this.armorRow);
    const aBar = el('div', 'vital-bar', this.armorRow);
    this.armorFill = el('div', 'vital-fill armor-fill', aBar);

    this.killFeed = el('div', 'kill-feed', this.root);

    // ---- Death screen with a countdown ring ----
    this.deathScreen = el('div', 'death-screen', this.root);
    el('div', 'death-label', this.deathScreen).textContent = 'Eliminated';
    this.deathText = el('div', 'death-title', this.deathScreen);
    const timer = el('div', 'death-countdown', this.deathScreen);
    timer.innerHTML = '<svg viewBox="0 0 100 100"><circle class="ring-bg" cx="50" cy="50" r="44"/><circle class="ring-fg" cx="50" cy="50" r="44"/></svg>';
    this.deathRing = timer.querySelector('.ring-fg') as SVGCircleElement;
    this.deathCount = el('div', 'death-count', timer);
    this.deathTimer = el('div', 'death-timer', this.deathScreen);

    this.markersEl = el('div', 'markers', this.root);
    this.statusEl = el('div', 'match-status', this.root);
    this.objectiveEl = el('div', 'objective-bar', this.root);
    this.objectiveLabel = el('div', 'ob-label', this.objectiveEl);
    const obTrack = el('div', 'ob-track', this.objectiveEl);
    this.objectiveFill = el('div', 'ob-fill', obTrack);
    this.objectiveEl.style.display = 'none';
    this.announceEl = el('div', 'announce', this.root);
    this.announceTitle = el('div', 'announce-title', this.announceEl);
    this.announceSub = el('div', 'announce-sub', this.announceEl);
    this.pickupEl = el('div', 'pickup-msg', this.root);
    this.minimap = new Minimap(this.root);
    this.scoreboardEl = el('div', 'scoreboard', this.root);

    this.debugEl = el('div', 'debug', this.root);

    // HUD size setting (scales the panels, not the crosshair).
    const applyScale = () => this.root.style.setProperty('--hud-scale', String(settings.get().hudScale ?? 1));
    applyScale();
    settings.onChange(applyScale);
  }

  /** Clear everything from the last match. */
  reset(): void {
    this.killFeed.innerHTML = '';
    this.fx.reset();
    this.announceTimer = 0;
    this.announceEl.style.opacity = '0';
    this.pickupTimer = 0;
    this.pickupEl.style.opacity = '0';
    this.hurtFlash = 0;
    this.lastVitals = '';
    this.lastAmmo = '';
    for (const ind of this.indicators) ind.life = 0;
    this.setDeath(null);
    this.showScoreboard(null);
    this.setMarkers([]);
    this.setObjective(null);
  }

  /**
   * Markers on screen (already projected to pixels): objectives (with their
   * distance) and teammates' names. `edge`: pinned to the screen edge
   * because it's off screen.
   */
  setMarkers(list: { sx: number; sy: number; label: string; sub: string; color: string; ally?: boolean; edge?: boolean }[]): void {
    while (this.markerEls.length < list.length) this.markerEls.push(el('div', 'marker', this.markersEl));
    this.markerEls.forEach((m, i) => {
      const it = list[i];
      if (!it) {
        setStyle(m, 'display', 'none');
        return;
      }
      setStyle(m, 'display', '');
      const cls = `marker${it.ally ? ' ally' : ''}${it.edge ? ' edge' : ''}`;
      if (m.className !== cls) m.className = cls;
      const html = it.ally ? `<span class="mk-name">${esc(it.label)}</span><span class="mk-chev"></span>` : `<span class="mk-icon">${esc(it.label)}</span><span class="mk-dist">${esc(it.sub)}</span>`;
      if (m.dataset.html !== html) {
        m.dataset.html = html;
        m.innerHTML = html;
      }
      m.style.setProperty('--mk', it.color);
      m.style.transform = `translate(${it.sx.toFixed(0)}px, ${it.sy.toFixed(0)}px)`;
    });
  }

  /** The bar under the status line ("Capturing B"); null hides it. */
  setObjective(info: { label: string; value: number | null; color: string } | null): void {
    const key = info ? `${info.label}|${info.value === null ? '-' : info.value.toFixed(2)}|${info.color}` : '';
    if (key === this.lastObjective) return;
    this.lastObjective = key;
    setStyle(this.objectiveEl, 'display', info ? '' : 'none');
    if (!info) return;
    this.objectiveLabel.textContent = info.label;
    this.objectiveEl.style.setProperty('--ob', info.color);
    this.objectiveEl.classList.toggle('no-bar', info.value === null);
    setStyle(this.objectiveFill, 'width', `${Math.max(0, Math.min(1, info.value ?? 0)) * 100}%`);
  }

  /** The match status bar: "A  ·  B  ·  C" becomes separate segments; a time like 9:59 gets its own style. */
  setStatus(text: string): void {
    if (text === this.lastStatus) return;
    this.lastStatus = text;
    const parts = text.split(/\s+·\s+/).filter(Boolean);
    this.statusEl.innerHTML = parts
      .map((t) => {
        const team = /^Blue \d/.test(t) ? ' team-blue' : /^Red \d/.test(t) ? ' team-red' : '';
        return `<span class="seg-part${/^\d+:\d\d$/.test(t) ? ' time' : ''}${team}">${esc(t)}</span>`;
      })
      .join('<span class="seg-sep">  ·  </span>');
  }

  /** Big message in the middle-top of the screen for a few seconds. */
  announce(title: string, subtitle = '', seconds = 2.5): void {
    this.announceTitle.textContent = title;
    this.announceSub.textContent = subtitle;
    this.announceTimer = seconds;
    // Restart the entrance animation.
    this.announceEl.classList.remove('in');
    void this.announceEl.offsetWidth;
    this.announceEl.classList.add('in');
  }

  pickupMessage(text: string, type: PickupType): void {
    const icon = type === 'health' ? ICON.health : type === 'armor' ? ICON.armor : ICON.ammo;
    this.pickupEl.innerHTML = `<span class="pk-icon">${icon}</span><span>${esc(text)}</span>`;
    this.pickupEl.className = `pickup-msg ${type}`;
    void this.pickupEl.offsetWidth;
    this.pickupEl.classList.add('in');
    this.pickupTimer = 1.6;
  }

  /** Score table (hold Tab). Pass null to hide. */
  showScoreboard(rows: ScoreRow[] | null, title = '', extra: ScoreExtras = {}): void {
    if (!rows) {
      this.scoreboardEl.style.display = 'none';
      return;
    }
    this.scoreboardEl.style.display = 'block';
    this.scoreboardEl.innerHTML = scoreTableHtml(rows, title, extra);
  }

  updateVitals(health: number, armor: number): void {
    const P = CONFIG.player;
    const key = `${Math.ceil(health)}|${Math.ceil(armor)}`;
    if (key !== this.lastVitals) {
      this.lastVitals = key;
      const hp = Math.max(0, health) / P.maxHealth;
      this.healthText.textContent = String(Math.max(0, Math.ceil(health)));
      this.healthFill.style.width = `${hp * 100}%`;
      // The trail lags behind (CSS delay), showing how much was just lost.
      this.healthTrail.style.width = `${hp * 100}%`;
      this.healthRow.classList.toggle('low', health <= 30);
      this.armorRow.classList.toggle('empty', armor <= 0);
      this.armorText.textContent = String(Math.ceil(armor));
      this.armorFill.style.width = `${(armor / P.maxArmor) * 100}%`;
    }
    // Red edges that pulse when health is low.
    const low = health > 0 && health <= 35 ? 1 - health / 35 : 0;
    setStyle(this.lowHealth, 'opacity', low ? (low * (0.55 + 0.25 * Math.sin(performance.now() / 180))).toFixed(2) : '0');
  }

  /** Show where damage came from (attacker's world position x/z). */
  showDamage(fromX: number, fromZ: number, amount: number): void {
    this.hurtFlash = Math.min(1, this.hurtFlash + 0.25 + amount / 60);
    // Reuse an indicator for the same attacker spot, else the oldest one.
    let ind = this.indicators.find((i) => i.life > 0 && Math.hypot(i.x - fromX, i.z - fromZ) < 2);
    ind ??= this.indicators.reduce((a, b) => (a.life < b.life ? a : b));
    ind.x = fromX;
    ind.z = fromZ;
    ind.life = 1.4;
  }

  /** Point each indicator at its attacker, relative to where you're facing. */
  private updateIndicators(dt: number, px: number, pz: number, yaw: number): void {
    for (const ind of this.indicators) {
      if (ind.life <= 0) {
        setStyle(ind.el, 'opacity', '0');
        continue;
      }
      ind.life -= dt;
      const attackerYaw = Math.atan2(-(ind.x - px), -(ind.z - pz));
      ind.el.style.opacity = String(Math.min(1, ind.life));
      ind.el.style.transform = `rotate(${yaw - attackerYaw}rad)`;
    }
  }

  /** @param killerColor, victimColor team colors (team modes) */
  addKill(killer: string, victim: string, weapon: WeaponId | 'zone', headshot: boolean, killerColor?: string, victimColor?: string): void {
    const row = document.createElement('div');
    const mine = killer === 'You' ? ' mine' : victim === 'You' ? ' died' : '';
    row.className = `kf-row${mine}`;
    const you = (n: string) => (n === 'You' ? ' you' : '');
    const color = (c?: string) => (c ? ` style="color:${c}"` : '');
    row.innerHTML =
      `<span class="kf-name${you(killer)}"${color(killerColor)}>${esc(killer)}</span>` +
      `<span class="kf-weapon">${esc(weapon === 'zone' ? 'Zone' : SHORT[weapon])}${headshot ? `<span class="kf-head">${ICON.head}</span>` : ''}</span>` +
      `<span class="kf-name${you(victim)}"${color(victimColor)}>${esc(victim)}</span>`;
    this.killFeed.prepend(row);
    while (this.killFeed.children.length > 5) this.killFeed.lastElementChild!.remove();
    setTimeout(() => row.classList.add('fade'), 5000);
    setTimeout(() => row.remove(), 6000);
  }

  /** Death screen; pass null to hide. `seconds` < 0 means no respawn. */
  setDeath(info: { killer: string; seconds: number; note?: string } | null): void {
    this.deathScreen.style.display = info ? 'flex' : 'none';
    this.root.classList.toggle('dead', !!info);
    if (!info) return;
    this.deathText.textContent = `Killed by ${info.killer}`;
    const noRespawn = info.seconds < 0;
    this.deathScreen.classList.toggle('final', noRespawn);
    if (noRespawn) {
      this.deathTimer.textContent = info.note ?? 'No respawns';
      return;
    }
    const total = CONFIG.player.respawnDelay;
    const left = Math.max(0, info.seconds);
    this.deathCount.textContent = String(Math.ceil(left));
    // Ring empties as the countdown runs (circumference 2π·44 ≈ 276.5).
    this.deathRing.style.strokeDashoffset = String(276.5 * (1 - left / total));
    this.deathTimer.textContent = 'Respawning';
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
  }

  /**
   * @param gapPx distance from center to the crosshair lines (shows spread)
   * @param ads 0..1 aim amount (crosshair fades out while aiming)
   * @param scoped show the sniper scope
   */
  updateCrosshair(gapPx: number, ads: number, scoped: boolean): void {
    const gap = `${Math.min(gapPx, 160).toFixed(0)}px`;
    if (gap !== this.lastGap) {
      this.lastGap = gap;
      this.crosshair.style.setProperty('--gap', gap);
    }
    setStyle(this.crosshair, 'opacity', scoped ? '0' : (1 - ads * 0.85).toFixed(2));
    setStyle(this.scope, 'display', scoped ? 'block' : 'none');
  }

  updateAmmo(a: AmmoInfo): void {
    // Only touch the page when something changed (keeps the frame rate smooth).
    if (a.weapon !== this.pipWeapon) this.buildPips(a.weapon, a.magazine);
    const key = `${a.weapon}|${a.ammo}|${a.reserve}`;
    if (key !== this.lastAmmo) {
      this.lastAmmo = key;
      this.ammoName.textContent = WEAPONS[a.weapon].name;
      this.ammoNumber.textContent = String(a.ammo);
      const low = a.ammo <= Math.ceil(a.magazine * 0.25);
      this.weaponPanel.classList.toggle('low', low);
      this.ammoReserve.textContent = String(a.reserve);
      this.pipEls.forEach((p, i) => p.classList.toggle('spent', i >= a.ammo));
      for (const [id, s] of this.slots) s.classList.toggle('active', id === a.weapon);
    }
    setStyle(this.reloadBar, 'visibility', a.reloadProgress > 0 ? 'visible' : 'hidden');
    if (a.reloadProgress > 0) setStyle(this.reloadFill, 'width', `${(a.reloadProgress * 100).toFixed(0)}%`);

    if (a.reloadProgress > 0) this.setNotice('Reloading', 'info');
    else if (a.ammo === 0 && a.reserve === 0) this.setNotice('Out of ammo', 'alert');
    else if (a.ammo === 0) this.setNotice('Press R to reload', 'alert');
    else if (a.ammo <= Math.ceil(a.magazine * 0.25)) this.setNotice('Low ammo', 'warn');
    else this.setNotice('', '');
  }

  /** One small mark per round in the magazine. */
  private buildPips(weapon: WeaponId, magazine: number): void {
    this.pipWeapon = weapon;
    this.pips.innerHTML = '';
    this.pips.className = `pips ${weapon}`;
    this.pipEls = [];
    for (let i = 0; i < magazine; i++) this.pipEls.push(el('div', 'pip', this.pips));
  }

  private setNotice(text: string, kind: string): void {
    if (this.notice.textContent !== text) {
      this.notice.textContent = text;
      this.notice.className = `notice ${kind}`;
    }
  }

  showHitmarker(kind: HitmarkerKind): void {
    this.hitmarker.className = 'hitmarker';
    void this.hitmarker.offsetWidth; // restart the pop animation
    this.hitmarker.className = `hitmarker show ${kind}`;
    this.hitTimer = kind === 'kill' ? 0.4 : 0.2;
  }

  /** @param px,pz,yaw the player's position and facing, for damage indicators */
  update(dt: number, px: number, pz: number, yaw: number): void {
    this.updateIndicators(dt, px, pz, yaw);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.8);
    this.announceTimer = Math.max(0, this.announceTimer - dt);
    setStyle(this.announceEl, 'opacity', Math.min(1, this.announceTimer * 2).toFixed(2));
    this.pickupTimer = Math.max(0, this.pickupTimer - dt);
    setStyle(this.pickupEl, 'opacity', Math.min(1, this.pickupTimer * 2).toFixed(2));
    setStyle(this.vignette, 'opacity', this.hurtFlash.toFixed(2));
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) this.hitmarker.classList.remove('show');
    }
  }

  /** Small info readout in the corner (toggle with F3). */
  updateDebug(dt: number, lines: () => string[]): void {
    this.frames++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.frames / this.fpsTimer);
      this.frames = 0;
      this.fpsTimer = 0;
      this.debugEl.textContent = this.showDebug ? [`FPS ${this.fps}`, ...lines()].join('\n') : '';
    }
  }
}

function el(tag: string, className: string, parent: HTMLElement): HTMLDivElement {
  const e = document.createElement(tag) as HTMLDivElement;
  e.className = className;
  parent.appendChild(e);
  return e;
}

function esc(t: string): string {
  return t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

export interface ScoreExtras {
  /** Name of the objective score column (e.g. "Caps"). */
  scoreLabel?: string;
  /** Team modes: Blue's and Red's scores (rows are then grouped by team). */
  teamScores?: [number, number];
}

/** HTML table of scores (used by the Tab scoreboard and the end screen). */
export function scoreTableHtml(rows: ScoreRow[], title: string, extra: ScoreExtras = {}): string {
  const hasScore = rows.some((r) => r.score !== undefined);
  const cols = 5 + (hasScore ? 1 : 0);
  const row = (r: ScoreRow, i: number) => {
    const kd = r.deaths === 0 ? r.kills.toFixed(1) : (r.kills / r.deaths).toFixed(2);
    const cls = [r.isPlayer ? 'me' : '', i === 0 ? 'first' : ''].filter(Boolean).join(' ');
    const team = r.team !== undefined ? ` style="--team:${TEAMS.css[r.team]}"` : '';
    return `<tr class="${cls}${r.team !== undefined ? ' teamed' : ''}"${team}><td class="rank">${i + 1}</td><td>${esc(r.name)}</td>${hasScore ? `<td class="obj">${r.score ?? 0}</td>` : ''}<td>${r.kills}</td><td>${r.deaths}</td><td class="kd">${kd}</td></tr>`;
  };
  let body: string;
  if (extra.teamScores && rows.some((r) => r.team !== undefined)) {
    body = [0, 1]
      .map((t) => {
        const members = rows.filter((r) => r.team === t);
        const head = `<tr class="team-head" style="--team:${TEAMS.css[t]}"><td colspan="${cols - 1}">${esc(TEAMS.names[t])}${t === 0 ? ' (your team)' : ''}</td><td class="team-score">${Math.floor(extra.teamScores![t])}</td></tr>`;
        return head + members.map(row).join('');
      })
      .join('');
  } else body = rows.map(row).join('');
  const scoreHead = hasScore ? `<th>${esc(extra.scoreLabel ?? 'Score')}</th>` : '';
  return `${title ? `<div class="sb-title">${esc(title)}</div>` : ''}<table class="score-table"><thead><tr><th>#</th><th>Name</th>${scoreHead}<th>Kills</th><th>Deaths</th><th>K/D</th></tr></thead><tbody>${body}</tbody></table>`;
}

/** Set an inline style only if it changed (avoids needless page work). */
function setStyle(el: HTMLElement, prop: 'opacity' | 'display' | 'visibility' | 'width', value: string): void {
  if (el.style[prop] !== value) el.style[prop] = value;
}
