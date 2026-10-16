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

type Screen = 'main' | 'setup' | 'pause' | 'settings' | 'end' | null;

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
    this.root.className = `menu-root ${screen === 'main' || screen === 'setup' ? 'solid' : ''}`;
    this.root.innerHTML = '';
    const panel = div('menu-panel', this.root);
    switch (screen) {
      case 'main': this.buildMain(panel); break;
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

  private buildMain(p: HTMLElement): void {
    div('menu-title', p).textContent = 'Generic FPS';
    div('menu-sub', p).textContent = 'A singleplayer shooter against AI bots';
    const col = div('menu-buttons', p);
    button(col, 'Play', () => this.show('setup'), 'primary');
    button(col, 'Settings', () => this.openSettings('main'));
    const help = div('menu-help', p);
    help.innerHTML =
      'WASD move · Mouse look · Space jump · Shift sprint · C crouch<br>' +
      'Left click shoot · Right click aim · R reload · 1–4 / wheel switch weapon<br>' +
      'Tab scoreboard · Esc pause';
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
    segmented(field(p, 'Graphics'), [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], s.quality, (v) =>
      settings.set({ quality: v as 'low' | 'medium' | 'high' }),
    );
    div('menu-note', p).textContent = 'Changes are saved automatically. Lower graphics quality if the game feels choppy.';
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
