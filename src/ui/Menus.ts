import { DIFFICULTIES, MATCH } from '../config';
import { audio } from '../audio/AudioEngine';
import { settings } from '../core/Settings';
import { MAPS } from '../map/maps';
import type { MatchConfig, MatchResult, ScoreRow } from '../modes/GameMode';
import { scoreTableHtml } from './Hud';

export interface MenuActions {
  startMatch(config: MatchConfig): void;
  resume(): void;
  restart(): void;
  quitToMenu(): void;
}

type Screen = 'title' | 'main' | 'controls' | 'setup' | 'pause' | 'settings' | 'end' | null;

const CONFIG_KEY = 'generic-fps-match';

const MODE_INFO = {
  deathmatch: 'Everyone for themselves. First to the kill limit wins. Everyone respawns.',
  survival: 'Waves of bots hunt you, each wave bigger and tougher. One life. Clearing a wave heals you a bit.',
};

/** All the menu screens (plain HTML on top of the game). */
export class Menus {
  private root: HTMLDivElement;
  private screen: Screen = null;
  /** Where "Back" in settings goes. */
  private settingsReturn: Screen = 'main';
  private config: MatchConfig;
  private lastResult: { result: MatchResult; rows: ScoreRow[] } | null = null;
  /** Shown on the pause screen, e.g. when the mouse couldn't be captured. */
  private pauseHint = '';

  constructor(parent: HTMLElement, private actions: MenuActions) {
    this.root = document.createElement('div');
    this.root.className = 'menu-root';
    parent.appendChild(this.root);
    this.config = this.loadConfig();

    // Any click in a menu also unlocks audio (browsers require a click first).
    this.root.addEventListener('pointerdown', () => audio.unlock());

    // Film grain for the title screen and main menu (a small noise image, tiled).
    const g = document.createElement('canvas');
    g.width = g.height = 160;
    const ctx = g.getContext('2d')!;
    const img = ctx.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 22;
    }
    ctx.putImageData(img, 0, 0);
    this.root.style.setProperty('--grain', `url(${g.toDataURL()})`);

    // On the title screen, any key or click starts.
    window.addEventListener('keydown', (e) => {
      if (this.screen === 'title' && !e.repeat) this.leaveTitle();
    });
  }

  private leaveTitle(): void {
    if (this.screen !== 'title' || this.root.classList.contains('leaving')) return;
    audio.unlock();
    audio.play('title_start');
    this.root.classList.add('leaving');
    setTimeout(() => this.show('main'), 450);
  }

  get current(): Screen {
    return this.screen;
  }

  private loadConfig(): MatchConfig {
    const def: MatchConfig = {
      mode: MATCH.defaultMode,
      map: MATCH.defaultMap,
      difficulty: MATCH.defaultDifficulty,
      botCount: MATCH.defaultBotCount,
      killLimit: MATCH.defaultKillLimit,
    };
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? 'null');
      if (!saved) return def;
      // Older saves used 'normal' for what's now 'medium'.
      if (saved.difficulty === 'normal') saved.difficulty = 'medium';
      if (!DIFFICULTIES.some((d) => d.id === saved.difficulty)) delete saved.difficulty;
      return { ...def, ...saved };
    } catch {
      return def;
    }
  }

  private saveConfig(): void {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(this.config));
    } catch {
      // Not saved; fine.
    }
  }

  hide(): void {
    this.screen = null;
    this.root.innerHTML = '';
    this.root.style.display = 'none';
  }

  show(screen: Exclude<Screen, null>, hint = ''): void {
    if (screen === 'pause') this.pauseHint = hint;
    this.screen = screen;
    this.root.style.display = 'flex';
    const cinematic = screen === 'title' || screen === 'main';
    // Screens over a match (pause, end) blur the game behind; the others show the dusk arena.
    const overGame = screen === 'pause' || screen === 'end' || (screen === 'settings' && this.settingsReturn === 'pause');
    this.root.className = `menu-root ${cinematic ? `cinematic ${screen}` : overGame ? 'over-game' : 'backdrop'}`;
    this.root.innerHTML = '';
    if (cinematic) {
      div('grain', this.root);
      if (screen === 'title') this.buildTitle();
      else this.buildMain();
      return;
    }
    const panel = div(`menu-panel ${screen}`, this.root);
    switch (screen) {
      case 'controls': this.buildControls(panel); break;
      case 'setup': this.buildSetup(panel); break;
      case 'pause': this.buildPause(panel); break;
      case 'settings': this.buildSettings(panel); break;
      case 'end': this.buildEnd(panel); break;
    }
  }

  showEnd(result: MatchResult, rows: ScoreRow[]): void {
    this.lastResult = { result, rows };
    this.show('end');
  }

  // ---- Screens -------------------------------------------------------------

  private buildTitle(): void {
    const wrap = div('title-screen', this.root);
    const center = div('title-center', wrap);
    center.appendChild(logo('big'));
    div('title-tagline', center).textContent = 'Outthink them. Outaim them. Outlast them.';
    div('title-prompt', wrap).textContent = 'Click or press any key to start';
    const foot = div('title-footer', wrap);
    foot.innerHTML = '<span>Singleplayer · AI bots · Deathmatch & Survival</span><span>v1.0</span>';
    wrap.addEventListener('click', () => this.leaveTitle());
  }

  private buildMain(): void {
    const wrap = div('main-layout', this.root);
    const left = div('main-left', wrap);
    left.appendChild(logo('small'));
    const nav = div('main-nav', left);
    const item = (label: string, hint: string, onClick: () => void, featured = false) => {
      const b = button(nav, '', onClick, `nav-item ${featured ? 'featured' : ''}`);
      b.innerHTML = `<span class="nav-label">${label}</span><span class="nav-hint">${hint}</span>`;
    };
    item('Play', 'Deathmatch or Survival against bots', () => this.show('setup'), true);
    item('How to play', 'Controls and tips', () => this.show('controls'));
    item('Settings', 'Mouse, field of view, sound, graphics', () => this.openSettings('main'));
    const aim = settings.get().aimKey === 'q' ? 'Q' : 'right click';
    div('main-foot', left).textContent = `Tip: hold ${aim} to aim down sights — bots miss more when you keep moving.`;
  }

  private buildControls(p: HTMLElement): void {
    head(p, 'Field manual', 'How to play');
    const aimQ = settings.get().aimKey === 'q';
    const groups: [string, [string, string][]][] = [
      ['Movement', [['W A S D', 'Move'], ['Mouse', 'Look around'], ['Space', 'Jump'], ['Shift', 'Sprint'], ['C', 'Crouch']]],
      ['Combat', [['Left click', 'Shoot'], [aimQ ? 'Q' : 'Right click', 'Aim / scope'], ['R', 'Reload'], ['1 – 4 / Wheel', 'Switch weapon'], ...(aimQ ? [] : [['Q', 'Last weapon'] as [string, string]])]],
      ['Other', [['Tab', 'Scoreboard'], ['Esc', 'Pause']]],
    ];
    const cols = div('controls-cols', p);
    for (const [title, rows] of groups) {
      const col = div('controls-group', cols);
      div('section-title', col).textContent = title;
      for (const [k, v] of rows) {
        const row = div('control-row', col);
        div('controls-action', row).textContent = v;
        div('controls-key', row).innerHTML = k.split(' / ').map((x) => `<kbd>${x}</kbd>`).join('');
      }
    }
    const tips = div('tip-cards', p);
    const tip = (icon: string, cls: string, title: string, text: string) => {
      const c = div('tip-card', tips);
      c.innerHTML = `<span class="tip-icon ${cls}">${icon}</span><span class="tip-title">${title}</span><span class="tip-text">${text}</span>`;
    };
    tip(ICONS.health, 't-health', 'Pickups', 'Health, armor (on the roof) and ammo come back a while after they’re taken. Bots grab them too.');
    tip(ICONS.ear, 't-ammo', 'Bots listen', 'Gunshots bring bots to look. Hurt bots run for cover or health; empty ones go for ammo.');
    tip(ICONS.target, 't-armor', 'Aim high', 'Headshots do double damage, more with the sniper rifle. Moving makes you harder to hit.');
    const row = div('menu-buttons row', p);
    button(row, 'Back', () => this.show('main'), 'primary');
  }

  private buildSetup(p: HTMLElement): void {
    const c = this.config;
    head(p, 'Ready up', 'New match');

    div('section-title', p).textContent = 'Mode';
    choiceCards(p, [
      ['deathmatch', 'Deathmatch', MODE_INFO.deathmatch, ICONS.crosshair],
      ['survival', 'Survival', MODE_INFO.survival, ICONS.waves],
    ], c.mode, (v) => {
      c.mode = v as MatchConfig['mode'];
      this.show('setup');
    });

    div('section-title', p).textContent = 'Map';
    choiceCards(p, MAPS.map((m) => [m.id, m.name, m.description, ICONS.map] as [string, string, string, string]), c.map, (v) => (c.map = v), 'small');

    div('section-title', p).textContent = 'Difficulty';
    const diffWrap = div('difficulty', p);
    const meter = div('diff-meter', diffWrap);
    const bars = DIFFICULTIES.map(() => div('diff-bar', meter));
    const diffInfo = div('diff-info', diffWrap);
    const refresh = () => {
      const i = DIFFICULTIES.findIndex((d) => d.id === c.difficulty);
      bars.forEach((b, k) => b.classList.toggle('on', k <= i));
      meter.dataset.level = String(i);
      diffInfo.textContent = DIFFICULTIES[i]?.info ?? '';
    };
    segmented(diffWrap, DIFFICULTIES.map((d) => [d.id, d.name] as [string, string]), c.difficulty, (v) => {
      c.difficulty = v as MatchConfig['difficulty'];
      refresh();
    });
    diffWrap.appendChild(meter);
    diffWrap.appendChild(diffInfo);
    refresh();

    const pair = div('field-pair', p);
    const bots = div('pair-item', pair);
    div('section-title', bots).textContent = c.mode === 'survival' ? 'Bots in wave 1' : 'Bots';
    slider(div('menu-control', bots), MATCH.minBots, MATCH.maxBots, 1, c.botCount, (v) => String(v), (v) => {
      c.botCount = v;
    });
    if (c.mode === 'deathmatch') {
      const kl = div('pair-item', pair);
      div('section-title', kl).textContent = 'Kill limit';
      segmented(div('menu-control', kl), MATCH.killLimits.map((k) => [String(k), String(k)] as [string, string]), String(c.killLimit), (v) => {
        c.killLimit = Number(v);
      });
    }

    const row = div('menu-buttons row', p);
    button(row, 'Back', () => this.show('main'));
    button(row, 'Start match', () => {
      this.saveConfig();
      this.actions.startMatch({ ...c });
    }, 'primary start');
  }

  private buildPause(p: HTMLElement): void {
    head(p, 'Match on hold', 'Paused');
    if (this.pauseHint) div('menu-note hint', p).textContent = this.pauseHint;
    const nav = div('main-nav pause-nav', p);
    const item = (label: string, hint: string, onClick: () => void, featured = false) => {
      const b = button(nav, '', onClick, `nav-item ${featured ? 'featured' : ''}`);
      b.innerHTML = `<span class="nav-label">${label}</span><span class="nav-hint">${hint}</span>`;
    };
    item('Resume', 'Back to the fight', () => this.actions.resume(), true);
    item('Restart', 'Same settings, fresh start', () => this.actions.restart());
    item('Settings', 'Mouse, aim key, graphics, HUD size, sound', () => this.openSettings('pause'));
    item('Quit', 'Back to the main menu', () => this.actions.quitToMenu());
  }

  private openSettings(from: Screen): void {
    this.settingsReturn = from;
    this.show('settings');
  }

  private buildSettings(p: HTMLElement): void {
    head(p, 'Make it yours', 'Settings');
    const s = settings.get();

    div('section-title', p).textContent = 'Controls';
    slider(field(p, 'Mouse sensitivity'), 0.1, 3, 0.05, s.mouseSensitivity, (v) => v.toFixed(2), (v) => settings.set({ mouseSensitivity: v }));
    slider(field(p, 'Field of view', 'How wide you see'), 60, 110, 1, s.fov, (v) => `${v}°`, (v) => settings.set({ fov: v }));
    segmented(field(p, 'Aim / scope', 'Hold to aim down sights'), [['mouse', 'Right mouse'], ['q', 'Q key']], s.aimKey, (v) =>
      settings.set({ aimKey: v as 'mouse' | 'q' }),
    );

    div('section-title', p).textContent = 'Display';
    segmented(field(p, 'Graphics', 'Lower if the game feels choppy'), [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], s.quality, (v) =>
      settings.set({ quality: v as 'low' | 'medium' | 'high' }),
    );
    slider(field(p, 'HUD size', 'Shrinks health, ammo, minimap…'), 0.6, 1, 0.05, s.hudScale ?? 1, (v) => `${Math.round(v * 100)}%`, (v) => settings.set({ hudScale: v }));
    segmented(field(p, 'Screen shake'), [['on', 'On'], ['off', 'Off']], s.screenShake ? 'on' : 'off', (v) =>
      settings.set({ screenShake: v === 'on' }),
    );

    div('section-title', p).textContent = 'Sound';
    slider(field(p, 'Volume'), 0, 1, 0.05, s.masterVolume, (v) => `${Math.round(v * 100)}%`, (v) => settings.set({ masterVolume: v }), () =>
      audio.play('pickup'),
    );

    div('menu-note', p).textContent = 'Changes are saved automatically. Some graphics changes take full effect from the next match.';
    const row = div('menu-buttons row', p);
    button(row, 'Back', () => this.show(this.settingsReturn ?? 'main'), 'primary');
  }

  private buildEnd(p: HTMLElement): void {
    const r = this.lastResult;
    if (!r) return;
    const h = head(p, 'Match over', r.result.title);
    h.classList.add(r.result.win ? 'win' : 'lose');
    div('menu-sub', p).textContent = r.result.subtitle;
    const stats = div('end-stats', p);
    for (const line of r.result.stats) div('end-stat', stats).textContent = line;
    const table = div('end-table', p);
    table.innerHTML = scoreTableHtml(r.rows, '');
    const row = div('menu-buttons row', p);
    button(row, 'Main menu', () => this.actions.quitToMenu());
    button(row, 'Play again', () => this.actions.restart(), 'primary');
  }
}

/** Small line icons for the menus. */
const ICONS = {
  crosshair: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 1v5M12 18v5M1 12h5M18 12h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/></svg>',
  waves: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 8c3-3 5 3 8 0s5 3 8 0 3-1 4 0"/><path d="M2 13c3-3 5 3 8 0s5 3 8 0 3-1 4 0"/><path d="M2 18c3-3 5 3 8 0s5 3 8 0 3-1 4 0"/></svg>',
  map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/></svg>',
  health: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z"/></svg>',
  ear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9a6 6 0 1 1 12 0c0 4-4 5-4 9a3 3 0 0 1-6 0"/><path d="M10 9a2 2 0 1 1 4 0"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>',
};

/** Panel header: a small gold label above a big title. */
function head(p: HTMLElement, eyebrow: string, title: string): HTMLDivElement {
  const h = div('panel-head', p);
  div('panel-eyebrow', h).textContent = eyebrow;
  div('panel-title', h).textContent = title;
  return h;
}

/** Big selectable cards with an icon, a name and a description. */
function choiceCards(
  parent: HTMLElement, options: [string, string, string, string][], value: string, onChange: (v: string) => void, size = '',
): void {
  const group = div(`choice-cards ${size}`, parent);
  for (const [v, name, info, icon] of options) {
    const b = document.createElement('button');
    b.className = `choice-card ${v === value ? 'active' : ''}`;
    b.innerHTML = `<span class="choice-icon">${icon}</span><span class="choice-text"><span class="choice-name">${name}</span><span class="choice-info">${info}</span></span>`;
    b.addEventListener('click', () => {
      audio.play('ui_click');
      group.querySelectorAll('.choice-card').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      onChange(v);
    });
    group.appendChild(b);
  }
}

// ---- Tiny DOM helpers --------------------------------------------------------

function div(className: string, parent: HTMLElement): HTMLDivElement {
  const d = document.createElement('div');
  d.className = className;
  parent.appendChild(d);
  return d;
}

function button(parent: HTMLElement, label: string, onClick: () => void, kind = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = `menu-btn ${kind}`;
  b.textContent = label;
  b.addEventListener('click', () => {
    audio.unlock();
    audio.play('ui_click');
    onClick();
  });
  parent.appendChild(b);
  return b;
}

function field(parent: HTMLElement, label: string, hint = ''): HTMLDivElement {
  const row = div('menu-field', parent);
  const l = div('menu-label', row);
  l.textContent = label;
  if (hint) div('menu-hint', l).textContent = hint;
  return div('menu-control', row);
}

function segmented(parent: HTMLElement, options: [string, string][], value: string, onChange: (v: string) => void): void {
  const group = div('segmented', parent);
  for (const [v, label] of options) {
    const b = document.createElement('button');
    b.className = `seg ${v === value ? 'active' : ''}`;
    b.textContent = label;
    b.addEventListener('click', () => {
      audio.play('ui_click');
      group.querySelectorAll('.seg').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      onChange(v);
    });
    group.appendChild(b);
  }
}

function slider(
  parent: HTMLElement, min: number, max: number, step: number, value: number,
  format: (v: number) => string, onChange: (v: number) => void, onRelease?: () => void,
): void {
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const out = div('slider-value', parent);
  out.textContent = format(value);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = format(v);
    onChange(v);
  });
  if (onRelease) input.addEventListener('change', onRelease);
  parent.prepend(input);
}

/** The game logo: a crosshair emblem plus the name. */
function logo(size: 'big' | 'small'): HTMLElement {
  const el = document.createElement('div');
  el.className = `logo ${size}`;
  el.innerHTML = `
    <svg class="logo-mark" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="34" fill="none" stroke="currentColor" stroke-width="5"/>
      <circle cx="50" cy="50" r="5" fill="currentColor"/>
      <path d="M50 2 V30 M50 70 V98 M2 50 H30 M70 50 H98" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>
    </svg>
    <div class="logo-text"><span class="logo-top">Generic</span><span class="logo-main">FPS</span></div>`;
  return el;
}
