import * as THREE from 'three';
import { CONFIG } from '../config';
import { CharacterHitbox, type Damageable, type DamageInfo } from '../core/Hitbox';
import { events } from '../core/events';
import type { SpawnPoint } from '../map/MapTypes';
import type { PlayerController } from './PlayerController';

const P = CONFIG.player;

/** What bots need to know about someone they're hunting. */
export interface Trackable {
  readonly name: string;
  isAlive(): boolean;
  /** Feet position. */
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  /** Current height (lower when crouching). */
  readonly height: number;
}

/** The player as a combatant: health, armor, dying, respawning. */
export class Player implements Damageable, Trackable {
  readonly name = 'You';
  readonly hitbox = new CharacterHitbox(P.height, 0.3, 0.16);
  health = P.maxHealth;
  armor = P.startingArmor;
  /** Seconds until respawn (when dead). */
  respawnTimer = 0;
  killedBy = '';
  /** Called whenever the player is hurt (for the HUD and sounds). */
  onHurt: ((info: DamageInfo, armorHit: boolean) => void) | null = null;

  constructor(readonly controller: PlayerController) {}

  get position(): THREE.Vector3 {
    return this.controller.position;
  }
  get velocity(): THREE.Vector3 {
    return this.controller.velocity;
  }
  get height(): number {
    return this.controller.height;
  }

  isAlive(): boolean {
    return this.health > 0;
  }

  takeDamage(info: DamageInfo): boolean {
    if (!this.isAlive()) return false;
    // Armor soaks up part of the hit.
    const absorbed = Math.min(this.armor, info.amount * P.armorAbsorption);
    this.armor -= absorbed;
    this.health -= info.amount - absorbed;
    const killed = this.health <= 0;
    this.onHurt?.(info, absorbed > 0);
    events.emit('damage', { attacker: info.attacker, victim: this.name, amount: info.amount, part: info.part, killed });
    if (killed) {
      this.health = 0;
      this.respawnTimer = P.respawnDelay;
      this.killedBy = info.attacker;
      events.emit('kill', { killer: info.attacker, victim: this.name, weapon: info.weapon, headshot: info.part === 'head' });
    }
    return killed;
  }

  heal(amount: number): void {
    this.health = Math.min(P.maxHealth, this.health + amount);
  }

  addArmor(amount: number): void {
    this.armor = Math.min(P.maxArmor, this.armor + amount);
  }

  /** Keep the hitbox matched to where the player is (call every frame). */
  syncHitbox(): void {
    this.hitbox.setPosition(this.position);
    this.hitbox.height = this.controller.height;
  }

  respawn(sp: SpawnPoint): void {
    this.health = P.maxHealth;
    this.armor = P.startingArmor;
    this.respawnTimer = 0;
    this.controller.spawn(sp);
    this.syncHitbox();
  }
}
