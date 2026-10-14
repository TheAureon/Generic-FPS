import { CONFIG } from '../config';

/** Player-adjustable settings, saved in the browser between sessions. */
export interface SettingsData {
  mouseSensitivity: number;
  fov: number;
  masterVolume: number;
}

const STORAGE_KEY = 'generic-fps-settings';

type Listener = (s: SettingsData) => void;

class SettingsStore {
  private data: SettingsData = { ...CONFIG.defaultSettings };
  private listeners: Listener[] = [];

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) this.data = { ...this.data, ...JSON.parse(raw) };
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
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
