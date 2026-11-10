import type { HitPart } from './Hitbox';

/**
 * Rules a game mode can bend for its match: how much damage a hit does, and
 * how fast someone moves. Everyone (player, bots, grenades) goes through
 * these, so a mode changes them in one place. They're reset to normal at the
 * start of every match.
 */
export interface MatchRules {
  /** Damage actually dealt by a hit (e.g. one-hit kills, a tough Juggernaut). */
  damage(attacker: string, victim: string, amount: number, part: HitPart): number;
  /** Movement speed multiplier for someone (1 = normal). */
  speed(name: string): number;
  /** Can this person throw grenades? */
  grenades(name: string): boolean;
}

const normal: MatchRules = {
  damage: (_a, _v, amount) => amount,
  speed: () => 1,
  grenades: () => true,
};

export const rules: MatchRules = { ...normal };

/** Back to normal rules (at the start of a match). */
export function resetRules(): void {
  Object.assign(rules, normal);
}
