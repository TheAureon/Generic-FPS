import * as THREE from 'three';
import type { WeaponId } from '../config';
import { rules } from '../core/MatchRules';
import type { Bot } from '../bots/Bot';
import { Deathmatch } from './Deathmatch';
import type { GameMode, MatchResult, ModeContext, ScoreRow } from './GameMode';

/**
 * One-weapon playlists: Free for All where everyone has the same weapon.
 * - Snipers Only: sniper rifles.
 * - Shotguns Only: shotguns.
 * - Blades Only: no guns at all, just katanas (and your throwing knives).
 *   The bots charge in with blades: one hit from them kills you too.
 */

export type OneWeaponId = 'snipers' | 'shotguns' | 'blades';

const SETUP: Record<OneWeaponId, { name: string; gun: WeaponId | null; blurb: string }> = {
  snipers: { name: 'Snipers Only', gun: 'sniper', blurb: 'Sniper rifles only. Find a spot and be patient.' },
  shotguns: { name: 'Shotguns Only', gun: 'shotgun', blurb: 'Shotguns only. Get close.' },
  blades: { name: 'Blades Only', gun: null, blurb: 'No guns. V to slash, hold V to block, T to throw a knife.' },
};

/** A faint steel-blue glow on bots in Blades Only. */
const BLADE_GLOW = new THREE.Color(0x0a1420);

export class OneWeapon implements GameMode {
  readonly name: string;
  readonly teams = false;
  readonly freeForAll = true;
  readonly botsRespawn = true;
  readonly playerRespawns = true;
  readonly noKillstreaks = true;
  private ffa: Deathmatch;

  constructor(
    private ctx: ModeContext,
    readonly id: OneWeaponId,
  ) {
    this.ffa = new Deathmatch(ctx);
    this.name = SETUP[id].name;
  }

  get result(): MatchResult | null {
    return this.ffa.result;
  }
  set result(_r: MatchResult | null) {
    // (Set by the free-for-all inside.)
  }

  get initialBots(): number {
    return this.ffa.initialBots;
  }

  start(): void {
    const s = SETUP[this.id];
    const w = this.ctx.weapons;
    if (s.gun) {
      for (const c of this.ctx.combatants()) this.ctx.loadout(c, [s.gun]);
    } else {
      // Blades: you put your guns away; the bots fight hand to hand.
      w.meleeOnly = true;
      for (const b of this.ctx.bots.bots) this.blade(b);
      rules.grenades = () => false;
    }
    this.ctx.announce(s.name, s.blurb, 3);
  }

  private blade(b: Bot): void {
    b.melee = { range: 2.2, damage: 100, every: 0.9 };
    b.hideGun = true;
    b.tint = BLADE_GLOW;
    b.grenadesPerLife = 0;
    b.skill = { ...b.skill, aggression: 1 };
  }

  update(dt: number): void {
    this.ffa.update();
    void dt;
  }

  status(): string {
    return `${this.name}  ·  ${this.ffa.status()}`;
  }

  scoreboard(): ScoreRow[] {
    return this.ffa.scoreboard();
  }

  dispose(): void {
    this.ctx.weapons.meleeOnly = false;
  }
}
