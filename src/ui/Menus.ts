import { MATCH } from '../config';
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
      return saved ? { ...def, ...saved } : def;
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
    this.root.className = `menu-root ${cinematic ? `cinematic ${screen}` : screen === 'setup' || screen === 'controls' ? 'solid' : ''}`;
    this.root.innerHTML = '';
    if (cinematic) {
      div('grain', this.root);
      if (screen === 'title') this.buildTitle();
      else this.buildMain();
      return;
    }
    const panel = div('menu-panel', this.root);
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
    div('menu-title small', p).textContent = 'How to play';
    const rows: [string, string][] = [
      ['W A S D', 'Move'], ['Mouse', 'Look'], ['Space', 'Jump'], ['Shift', 'Sprint'], ['C', 'Crouch'],
      ['Left click', 'Shoot'], [settings.get().aimKey === 'q' ? 'Q' : 'Right click', 'Aim / scope'], ['R', 'Reload'], ['1 – 4 / Wheel', 'Switch weapon'],
      ...(settings.get().aimKey === 'q' ? [] : [['Q', 'Last weapon'] as [string, string]]), ['Tab', 'Scoreboard'], ['Esc', 'Pause'],
    ];
    const grid = div('controls-grid', p);
    for (const [k, v] of rows) {
      div('controls-key', grid).innerHTML = k.split(' / ').map((x) => `<kbd>${x}</kbd>`).join(' ');
      div('controls-action', grid).textContent = v;
    }
    const tips = div('controls-tips', p);
    tips.innerHTML =
      '<b>Tips</b><br>' +
      'Pickups: <span class="t-health">health</span>, <span class="t-armor">armor</span> (on the roof), and <span class="t-ammo">ammo</span> respawn after a while.<br>' +
      'Bots hear gunshots and come to look — and hurt bots run for cover or health.<br>' +
      'Headshots do double damage (more with the sniper rifle).';
    const row = div('menu-buttons row', p);
    button(row, 'Back', () => this.show('main'), 'primary');
  }

  private buildSetup(p: HTMLElement): void {
    const c = this.config;
    div('menu-title small', p).textContent = 'New match';

    const modeRow = field(p, 'Mode');
    segmented(modeRow, [['deathmatch', 'Deathmatch'], ['survival', 'Survival']], c.mode, (v) => {
      c.mode = v as MatchConfig['mode'];
      this.show('setup');
    });
    div('menu-note', p).textContent = MODE_INFO[c.mode];

    segmented(field(p, 'Map'), MAPS.map((m) => [m.id, m.name] as [string, string]), c.map, (v) => (c.map = v));
    segmented(field(p, 'Difficulty'), [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']], c.difficulty, (v) => {
      c.difficulty = v as MatchConfig['difficulty'];
    });
    slider(field(p, c.mode === 'survival' ? 'Bots in wave 1' : 'Bots'), MATCH.minBots, MATCH.maxBots, 1, c.botCount, (v) => String(v), (v) => {
      c.botCount = v;
    });
    if (c.mode === 'deathmatch') {
      segmented(field(p, 'Kill limit'), MATCH.killLimits.map((k) => [String(k), String(k)] as [string, string]), String(c.killLimit), (v) => {
        c.killLimit = Number(v);
      });
    }

    const row = div('menu-buttons row', p);
    button(row, 'Back', () => this.show('main'));
    button(row, 'Start', () => {
      this.saveConfig();
      this.actions.startMatch({ ...c });
    }, 'primary');
  }

  private buildPause(p: HTMLElement): void {
    div('menu-title small', p).textContent = 'Paused';
    if (this.pauseHint) div('menu-note', p).textContent = this.pauseHint;
    const col = div('menu-buttons', p);
    button(col, 'Resume', () => this.actions.resume(), 'primary');
    button(col, 'Restart match', () => this.actions.restart());
    button(col, 'Settings', () => this.openSettings('pause'));
    button(col, 'Quit to main menu', () => this.actions.quitToMenu());
  }

  private openSettings(from: Screen): void {
    this.settingsReturn = from;
    this.show('settings');
  }

  private buildSettings(p: HTMLElement): void {
    div('menu-title small', p).textContent = 'Settings';
    const s = settings.get();
    slider(field(p, 'Mouse sensitivity'), 0.1, 3, 0.05, s.mouseSensitivity, (v) => v.toFixed(2), (v) => settings.set({ mouseSensitivity: v }));
    slider(field(p, 'Field of view'), 60, 110, 1, s.fov, (v) => `${v}°`, (v) => settings.set({ fov: v }));
    slider(field(p, 'Volume'), 0, 1, 0.05, s.masterVolume, (v) => `${Math.round(v * 100)}%`, (v) => settings.set({ masterVolume: v }), () =>
      audio.play('pickup'),
    );
    segmented(field(p, 'Screen shake'), [['on', 'On'], ['off', 'Off']], s.screenShake ? 'on' : 'off', (v) =>
      settings.set({ screenShake: v === 'on' }),
    );
    segmented(field(p, 'Aim / scope'), [['mouse', 'Right mouse'], ['q', 'Q key']], s.aimKey, (v) =>
      settings.set({ aimKey: v as 'mouse' | 'q' }),
    );
    segmented(field(p, 'Graphics'), [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], s.quality, (v) =>
      settings.set({ quality: v as 'low' | 'medium' | 'high' }),
    );
    div('menu-note', p).textContent = 'Changes are saved automatically. Lower graphics quality if the game feels choppy. Some graphics changes take full effect from the next match.';
    const row = div('menu-buttons row', p);
    button(row, 'Back', () => this.show(this.settingsReturn ?? 'main'), 'primary');
  }

  private buildEnd(p: HTMLElement): void {
    const r = this.lastResult;
    if (!r) return;
    const title = div(`menu-title small ${r.result.win ? 'win' : 'lose'}`, p);
    title.textContent = r.result.title;
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

function field(parent: HTMLElement, label: string): HTMLDivElement {
  const row = div('menu-field', parent);
  div('menu-label', row).textContent = label;
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
