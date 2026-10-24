import type * as THREE from 'three';
import { REWARDS, type WeaponId } from '../config';
import { audio } from '../audio/AudioEngine';
import { events } from './events';

/**
 * Medals and score for the player during a match: points for every kill
 * plus bonuses (headshot, longshot, revenge...), multikills (kills in quick
 * succession), kill streaks (kills without dying), and the stats for the
 * end-of-match summary. What it awards is shown by the HUD (see RewardsHud).
 */

export type MedalTier = 'bronze' | 'silver' | 'gold' | 'legend';

export interface MedalDef {
  name: string;
  tier: MedalTier;
  /** Icon name (see the icons in RewardsHud). */
  icon: string;
  /** What it's for (end screen). */
  info: string;
}

export const MEDALS: Record<string, MedalDef> = {
  firstBlood: { name: 'First Blood', tier: 'silver', icon: 'drop', info: 'First kill of the match' },
  longshot: { name: 'Longshot', tier: 'silver', icon: 'scope', info: `Kill from ${REWARDS.longshotDistance} m or more` },
  pointBlank: { name: 'Point Blank', tier: 'bronze', icon: 'burst', info: 'Kill at arm’s length' },
  closeCall: { name: 'Close Call', tier: 'silver', icon: 'heart', info: 'Kill while nearly dead' },
  revenge: { name: 'Revenge', tier: 'bronze', icon: 'revenge', info: 'Kill whoever last killed you' },
  comeback: { name: 'Comeback', tier: 'silver', icon: 'rise', info: 'Kill after dying 3 times in a row' },
  buzzkill: { name: 'Buzzkill', tier: 'gold', icon: 'stop', info: 'End an enemy’s kill streak' },
  collateral: { name: 'Collateral', tier: 'gold', icon: 'pierce', info: 'Two kills with one shot' },
  avenger: { name: 'Avenger', tier: 'bronze', icon: 'shield', info: 'Kill an enemy who just killed a teammate' },
  headshot: { name: 'Headshot', tier: 'bronze', icon: 'skull', info: 'Kill with a shot to the head' },
  double: { name: 'Double Kill', tier: 'bronze', icon: 'x2', info: '2 kills in quick succession' },
  triple: { name: 'Triple Kill', tier: 'silver', icon: 'x3', info: '3 kills in quick succession' },
  quad: { name: 'Quad Kill', tier: 'gold', icon: 'x4', info: '4 kills in quick succession' },
  rampage: { name: 'Rampage', tier: 'legend', icon: 'x5', info: '5+ kills in quick succession' },
  onARoll: { name: 'On a Roll', tier: 'bronze', icon: 'flame', info: '3 kills without dying' },
  spree: { name: 'Killing Spree', tier: 'silver', icon: 'flame', info: '5 kills without dying' },
  unstoppable: { name: 'Unstoppable', tier: 'gold', icon: 'flame', info: '8 kills without dying' },
  godlike: { name: 'Godlike', tier: 'legend', icon: 'crown', info: '12 kills without dying' },
  legendary: { name: 'Legendary', tier: 'legend', icon: 'crown', info: '16 kills without dying' },
};

const MULTI = ['', '', 'double', 'triple', 'quad', 'rampage'];
const STREAKS: Record<number, string> = { 3: 'onARoll', 5: 'spree', 8: 'unstoppable', 12: 'godlike', 16: 'legendary' };
/** Medals that also get a big call-out across the screen. */
const CALLOUT = new Set(['double', 'triple', 'quad', 'rampage', 'onARoll', 'spree', 'unstoppable', 'godlike', 'legendary', 'firstBlood', 'collateral', 'buzzkill']);

/** What the HUD needs to show rewards. */
export interface RewardsDisplay {
  score(lines: { label: string; points: number }[], total: number): void;
  medal(id: string, def: MedalDef): void;
  callout(title: string, sub: string, tier: MedalTier): void;
  streak(count: number): void;
  killFlash(headshot: boolean): void;
}

interface Who {
  name: string;
  position: THREE.Vector3;
  team: number | null;
}

export interface RewardsDeps {
  player: Who & { health: number };
  combatants: () => Who[];
  teams: boolean;
  time: () => number;
  display: RewardsDisplay;
}

/** The player's match, for the end screen. */
export interface MatchSummary {
  score: number;
  kills: number;
  deaths: number;
  headshots: number;
  damage: number;
  bestStreak: number;
  bestMulti: number;
  longestKill: number;
  medals: Record<string, number>;
  weaponKills: Partial<Record<WeaponId, number>>;
  /** Points by kind: kills, headshots, medals... (for the XP breakdown). */
  breakdown: { kills: number; headshots: number; medals: number };
}

export class Rewards {
  readonly summary: MatchSummary = {
    score: 0, kills: 0, deaths: 0, headshots: 0, damage: 0, bestStreak: 0, bestMulti: 0, longestKill: 0,
    medals: {}, weaponKills: {}, breakdown: { kills: 0, headshots: 0, medals: 0 },
  };
  private streak = 0;
  private multi = 0;
  private lastKillAt = -99;
  private deathsInRow = 0;
  private anyKill = false;
  private lastKiller: string | null = null;
  /** Everyone's current streak (for Buzzkill). */
  private streaks = new Map<string, number>();
  /** Enemies who just killed a teammate, and when (for Avenger). */
  private teamKillers = new Map<string, number>();
  private unsub: (() => void)[] = [];

  constructor(private d: RewardsDeps) {
    this.unsub.push(
      events.on('kill', (e) => this.onKill(e.killer, e.victim, e.weapon, e.headshot)),
      events.on('damage', (e) => {
        if (e.attacker === d.player.name && e.victim !== d.player.name) this.summary.damage += Math.max(0, e.amount);
      }),
    );
  }

  dispose(): void {
    this.unsub.forEach((u) => u());
  }

  private onKill(killer: string, victim: string, weapon: WeaponId | 'zone', headshot: boolean): void {
    const me = this.d.player.name, now = this.d.time();
    const firstBlood = !this.anyKill && killer !== victim && weapon !== 'zone';
    if (killer !== victim) this.anyKill = true;
    const victimStreak = this.streaks.get(victim) ?? 0;
    this.streaks.set(victim, 0);
    if (killer !== victim) this.streaks.set(killer, (this.streaks.get(killer) ?? 0) + 1);

    if (victim === me) {
      this.summary.deaths++;
      this.streak = 0;
      this.multi = 0;
      this.deathsInRow++;
      if (killer !== me) this.lastKiller = killer;
      this.d.display.streak(0);
      return;
    }
    // A teammate went down: remember who did it.
    const team = this.d.player.team;
    if (killer !== me && this.d.teams && team !== null) {
      const v = this.d.combatants().find((c) => c.name === victim);
      if (v && v.team === team) this.teamKillers.set(killer, now);
    }
    if (killer !== me) return;

    // ---- Our kill ----
    const P = REWARDS.points;
    const s = this.summary;
    const victimObj = this.d.combatants().find((c) => c.name === victim);
    const dist = victimObj ? victimObj.position.distanceTo(this.d.player.position) : 0;
    s.kills++;
    if (weapon !== 'zone') s.weaponKills[weapon] = (s.weaponKills[weapon] ?? 0) + 1;
    s.longestKill = Math.max(s.longestKill, dist);
    const lines: { label: string; points: number }[] = [{ label: `Eliminated ${victim}`, points: P.kill }];
    s.breakdown.kills += P.kill;
    const medals: string[] = [];
    const bonus = (id: string, points: number) => {
      medals.push(id);
      lines.push({ label: MEDALS[id].name, points });
    };
    if (headshot) {
      s.headshots++;
      s.breakdown.headshots += P.headshot;
      lines.push({ label: 'Headshot', points: P.headshot });
      this.addMedal('headshot');
    }
    if (firstBlood) bonus('firstBlood', P.firstBlood);
    if (dist >= REWARDS.longshotDistance) bonus('longshot', P.longshot);
    else if (dist > 0 && dist <= REWARDS.pointBlankDistance) bonus('pointBlank', P.pointBlank);
    if (this.d.player.health > 0 && this.d.player.health <= REWARDS.closeCallHealth) bonus('closeCall', P.closeCall);
    if (this.lastKiller === victim) {
      bonus('revenge', P.revenge);
      this.lastKiller = null;
    }
    if (this.deathsInRow >= 3) bonus('comeback', P.comeback);
    this.deathsInRow = 0;
    if (victimStreak >= 3) bonus('buzzkill', P.buzzkill);
    const tk = this.teamKillers.get(victim);
    if (tk !== undefined && now - tk < 6) {
      bonus('avenger', P.avenger);
      this.teamKillers.delete(victim);
    }
    // Two kills in the same instant: one shot went through (or a shotgun blast got both).
    if (now - this.lastKillAt < 0.05) bonus('collateral', P.collateral);

    // Multikill.
    this.multi = now - this.lastKillAt <= REWARDS.multikillWindow ? this.multi + 1 : 1;
    this.lastKillAt = now;
    s.bestMulti = Math.max(s.bestMulti, this.multi);
    if (this.multi >= 2) bonus(MULTI[Math.min(5, this.multi)], P.multikill[Math.min(5, this.multi)]);

    // Streak.
    this.streak++;
    s.bestStreak = Math.max(s.bestStreak, this.streak);
    const st = STREAKS[this.streak];
    if (st) bonus(st, P.streak[this.streak]);
    this.d.display.streak(this.streak);

    // Add it all up and show it.
    const total = lines.reduce((a, l) => a + l.points, 0);
    s.score += total;
    s.breakdown.medals += total - P.kill - (headshot ? P.headshot : 0);
    this.d.display.killFlash(headshot);
    this.d.display.score(lines, s.score);
    for (const id of medals) this.addMedal(id);
    // The biggest one gets the call-out (multikills and streaks beat the rest).
    const big = [...medals].reverse().find((id) => CALLOUT.has(id));
    if (big) {
      const def = MEDALS[big];
      const sub = STREAKS[this.streak] === big ? `${this.streak} kills without dying` : this.multi >= 2 && MULTI[Math.min(5, this.multi)] === big ? `${this.multi} kills in a row` : def.info;
      this.d.display.callout(def.name, sub, def.tier);
      audio.play(def.tier === 'legend' || def.tier === 'gold' ? 'callout_big' : 'callout');
    } else if (medals.length) {
      audio.play('medal');
    }
  }

  private addMedal(id: string): void {
    this.summary.medals[id] = (this.summary.medals[id] ?? 0) + 1;
    if (id !== 'headshot') this.d.display.medal(id, MEDALS[id]);
  }
}
