import * as THREE from 'three';
import { PICKUPS } from '../config';
import { audio } from '../audio/AudioEngine';
import { createPickupModel } from '../assets/pickupModels';
import { events } from '../core/events';
import type { PickupDef, PickupType } from '../map/MapTypes';

/** Anyone who can grab pickups (the player, bots). */
export interface Collector {
  readonly name: string;
  readonly position: THREE.Vector3;
  isAlive(): boolean;
  /** Try to use a pickup. Return false if it wouldn't help (e.g. already at full health). */
  tryCollect(type: PickupType): boolean;
}

interface Item {
  def: PickupDef;
  model: THREE.Group;
  active: boolean;
  /** Seconds until it comes back (when taken). */
  timer: number;
  phase: number;
}

/** Health, armor, and ammo pickups placed around the map. */
export class Pickups {
  readonly items: Item[] = [];
  private time = 0;

  constructor(scene: THREE.Scene, defs: PickupDef[]) {
    for (const def of defs) {
      const model = createPickupModel(def.type);
      model.position.set(def.x, def.y, def.z);
      scene.add(model);
      this.items.push({ def, model, active: true, timer: 0, phase: Math.random() * Math.PI * 2 });
    }
  }

  update(dt: number, collectors: readonly Collector[]): void {
    this.time += dt;
    for (const it of this.items) {
      if (!it.active) {
        it.timer -= dt;
        if (it.timer <= 0) {
          it.active = true;
          it.model.visible = true;
        }
        continue;
      }
      // Spin and bob.
      const item = it.model.getObjectByName('item')!;
      item.rotation.y = this.time * 1.6 + it.phase;
      item.position.y = 0.55 + Math.sin(this.time * 2.2 + it.phase) * 0.08;

      for (const c of collectors) {
        if (!c.isAlive()) continue;
        const p = c.position;
        const close = Math.hypot(p.x - it.def.x, p.z - it.def.z) < PICKUPS.radius && Math.abs(p.y - it.def.y) < 1.5;
        if (close && c.tryCollect(it.def.type)) {
          it.active = false;
          it.model.visible = false;
          it.timer = PICKUPS[it.def.type].respawnTime;
          audio.play('pickup', { position: it.model.position, volume: 0.8 });
          events.emit('pickup', { who: c.name, type: it.def.type });
          break;
        }
      }
    }
  }

  /** Closest available pickup of a type within `maxDist` (flat distance), or null. */
  nearest(type: PickupType, from: THREE.Vector3, maxDist = Infinity): THREE.Vector3 | null {
    let best: Item | null = null;
    let bestD = maxDist;
    for (const it of this.items) {
      if (!it.active || it.def.type !== type) continue;
      const d = Math.hypot(it.def.x - from.x, it.def.z - from.z) + Math.abs(it.def.y - from.y) * 2;
      if (d < bestD) {
        bestD = d;
        best = it;
      }
    }
    return best ? new THREE.Vector3(best.def.x, best.def.y, best.def.z) : null;
  }
}
