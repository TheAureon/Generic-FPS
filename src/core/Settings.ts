import { CONFIG } from '../config';

/** Player-adjustable settings, saved in the browser between sessions. */
export interface SettingsData {
  mouseSensitivity: number;
  fov: number;
  masterVolume: number;
  /** Camera shake when shooting and getting hit. */
  screenShake: boolean;
  /** Which button aims down sights / scopes: both right mouse and Q, or just one. */
  aimKey: 'both' | 'mouse' | 'q';
  /** Size of the HUD panels (health, ammo, minimap, kill feed...), 0.6 to 1. */
  hudScale: number;
  /** low = fastest, high = best looking. */
  quality: 'low' | 'medium' | 'high';
}

const STORAGE_KEY = 'generic-fps-settings';
/** Bumped when a default changes in a way old saved settings should pick up. */
const VERSION = 2;

type Listener = (s: SettingsData) => void;

class SettingsStore {
  private data: SettingsData = { ...CONFIG.defaultSettings };
  private listeners: Listener[] = [];

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        // Version 2: aiming works with both right mouse and Q by default (Q no
        // longer switches weapons), so older saves get the new default.
        if ((saved.version ?? 1) < 2) saved.aimKey = 'both';
        this.data = { ...this.data, ...saved };
      }
    } catch {
      // Storage unavailable or corrupt: fall back to defaults.
    }
  }

  get(): Readonly<SettingsData> {
    return this.data;
  }

  set(patch: Partial<SettingsData>): void {
    this.data = { ...this.data, ...patch };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...this.data, version: VERSION }));
    } catch {
      // Ignore: settings just won't persist.
    }
    for (const l of this.listeners) l(this.data);
  }

  onChange(l: Listener): void {
    this.listeners.push(l);
  }
}

export const settings = new SettingsStore();
