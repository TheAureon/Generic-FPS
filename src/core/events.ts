import type * as THREE from 'three';
import type { WeaponId } from '../config';
import type { HitPart } from './Hitbox';

/**
 * Game-wide events. Systems announce things here (a shot was fired,
 * someone died) and other systems react (bots hear shots, kill feed).
 */
export interface GameEvents {
  shot: { shooter: string; weapon: WeaponId; position: THREE.Vector3; hearingRange: number };
  damage: { attacker: string; victim: string; amount: number; part: HitPart; killed: boolean };
  kill: { killer: string; victim: string; weapon: WeaponId; headshot: boolean };
}

type Handler<T> = (e: T) => void;

class EventBus {
  private handlers = new Map<keyof GameEvents, Handler<never>[]>();

  on<K extends keyof GameEvents>(type: K, h: Handler<GameEvents[K]>): void {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type)!.push(h as Handler<never>);
  }

  emit<K extends keyof GameEvents>(type: K, e: GameEvents[K]): void {
    for (const h of this.handlers.get(type) ?? []) (h as Handler<GameEvents[K]>)(e);
  }
}

export const events = new EventBus();
