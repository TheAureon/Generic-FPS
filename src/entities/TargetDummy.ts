import * as THREE from 'three';
import { createCharacterModel, type CharacterModel } from '../assets/characterModel';
import { CharacterHitbox, type Damageable, type DamageInfo } from '../core/Hitbox';
import { events } from '../core/events';
import type { PracticeTargetDef } from '../map/MapTypes';

const MAX_HEALTH = 100;
const RESPAWN_DELAY = 3;

/**
 * A practice target shaped like a person. It doesn't fight back; it just
 * takes hits, falls over, and stands back up. Some slide side to side.
 */
export class TargetDummy implements Damageable {
  readonly hitbox = new CharacterHitbox(1.8, 0.3, 0.16);
  readonly model: CharacterModel;
  health = MAX_HEALTH;

  private base: THREE.Vector3;
  private pos = new THREE.Vector3();
  private time = Math.random() * 10;
  private deadTimer = 0;
  private flash = 0;
  private fall = 0;

  constructor(readonly name: string, private def: PracticeTargetDef, scene: THREE.Scene) {
    this.model = createCharacterModel(0xd9772b, 0x3a3a3a);
    // Arms hanging at the sides.
    const b = this.model.bones;
    b.lShoulder.rotation.set(0.05, 0, -0.14);
    b.rShoulder.rotation.set(0.05, 0, 0.14);
    b.lElbow.rotation.set(0.2, 0, 0);
    b.rElbow.rotation.set(0.2, 0, 0);
    this.base = new THREE.Vector3(def.x, def.y, def.z);
    this.model.root.rotation.y = ((def.yaw ?? 0) * Math.PI) / 180;
    scene.add(this.model.root);
    this.place();
  }

  isAlive(): boolean {
    return this.health > 0;
  }

  takeDamage(info: DamageInfo): boolean {
    if (!this.isAlive()) return false;
    this.health -= info.amount;
    this.flash = 1;
    const killed = this.health <= 0;
    events.emit('damage', { attacker: info.attacker, victim: this.name, amount: info.amount, part: info.part, killed });
    if (killed) {
      this.health = 0;
      this.deadTimer = RESPAWN_DELAY;
      events.emit('kill', { killer: info.attacker, victim: this.name, weapon: info.weapon, headshot: info.part === 'head' });
    }
    return killed;
  }

  update(dt: number): void {
    this.time += dt;
    if (this.isAlive()) this.place();

    // Fall over when dead, stand back up when respawning.
    if (!this.isAlive()) {
      this.deadTimer -= dt;
      this.fall = Math.min(1, this.fall + dt * 3);
      if (this.deadTimer <= 0) this.health = MAX_HEALTH;
    } else {
      this.fall = Math.max(0, this.fall - dt * 2.5);
    }
    const ease = this.fall * this.fall * (3 - 2 * this.fall);
    this.model.root.rotation.x = (ease * Math.PI) / 2;

    // Flash white when hit.
    this.flash = Math.max(0, this.flash - dt * 8);
    this.model.material.emissive.setRGB(this.flash * 0.6, this.flash * 0.6, this.flash * 0.6);
  }

  private place(): void {
    const strafe = this.def.strafe ?? 0;
    const offset = strafe ? Math.sin(this.time * 0.9) * strafe : 0;
    const yaw = ((this.def.yaw ?? 0) * Math.PI) / 180;
    // Slide along the dummy's own left/right direction.
    this.pos.set(this.base.x + Math.cos(yaw) * offset, this.base.y, this.base.z - Math.sin(yaw) * offset);
    this.model.root.position.copy(this.pos);
    this.hitbox.setPosition(this.pos);
  }
}
