import { RIVALS } from '../config';

/**
 * Your history with each named bot (how many times you've killed them and
 * they've killed you), saved in this browser across matches. A bot that has
 * beaten you a lot becomes your nemesis; one you keep beating is your prey.
 */

export interface RivalRecord {
  /** You killed them. */
  kills: number;
  /** They killed you. */
  deaths: number;
}

const KEY = 'gfps-rivals';

class Rivals {
  private data: Record<string, RivalRecord> = {};

  constructor() {
    try {
      this.data = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
    } catch {
      this.data = {};
    }
  }

  get(name: string): RivalRecord {
    return this.data[name] ?? { kills: 0, deaths: 0 };
  }

  all(): [string, RivalRecord][] {
    return Object.keys(RIVALS).map((n) => [n, this.get(n)]);
  }

  /** Has this bot beaten you a lot more than you've beaten it? */
  isNemesis(name: string): boolean {
    const r = this.get(name);
    return r.deaths >= 5 && r.deaths >= r.kills * 1.5;
  }

  isPrey(name: string): boolean {
    const r = this.get(name);
    return r.kills >= 10 && r.kills >= r.deaths * 3;
  }

  add(name: string, field: keyof RivalRecord): void {
    if (!(name in RIVALS)) return;
    const r = (this.data[name] ??= { kills: 0, deaths: 0 });
    r[field]++;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // Couldn't save; keep going.
    }
  }
}

export const rivals = new Rivals();
