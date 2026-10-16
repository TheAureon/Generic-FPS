import * as THREE from 'three';
import { COMBAT, WEAPONS, type WeaponId } from '../config';
import { audio } from '../audio/AudioEngine';
import type { SoundId } from '../audio/sounds';
import type { CollisionWorld } from '../core/CollisionWorld';
import type { Damageable, HitPart } from '../core/Hitbox';
import type { Input } from '../core/Input';
import { events } from '../core/events';
import type { Effects } from '../effects/Effects';
import type { PlayerController } from '../player/PlayerController';
import type { Hud } from '../ui/Hud';
import { applySpread, shotDamage, traceShot } from './hitscan';
import type { Viewmodel } from './Viewmodel';
import { Weapon } from './Weapon';

const DEG = Math.PI / 180;
/** Time to lower the old weapon before raising the new one. */
const LOWER_TIME = 0.15;
/** A click this soon before the gun is ready still fires (feels responsive). */
const TRIGGER_BUFFER = 0.12;

export interface WeaponSystemDeps {
  world: CollisionWorld;
  player: PlayerController;
  camera: THREE.PerspectiveCamera;
  effects: Effects;
  hud: Hud;
  /** Everything that can be shot (bots, dummies). */
  getTargets: () => readonly Damageable[];
  /** Name used in the kill feed / events. */
  ownerName: string;
  /** The first-person gun view (shared between matches). */
  viewmodel: Viewmodel;
}

/** The player's guns: input, firing, reloading, switching, aiming. */
export class WeaponSystem {
  readonly weapons: Weapon[];
  readonly viewmodel: Viewmodel;
  private index = 0;
  private lastIndex = 1;
  /** Weapon we're switching to, or -1. */
  private switchTo = -1;
  private switchTimer = 0;
  /** Seconds left raising the current weapon. */
  private raiseTimer = 0;
  private ads = 0;
  private triggerBuffer = 0;
  private sprintBlockTimer = 0;
  private sprintBlend = 0;

  private _origin = new THREE.Vector3();
  private _dir = new THREE.Vector3();
  private _pellet = new THREE.Vector3();
  private _muzzle = new THREE.Vector3();

  constructor(private d: WeaponSystemDeps) {
    this.viewmodel = d.viewmodel;
    this.weapons = (Object.keys(WEAPONS) as WeaponId[])
      .sort((a, b) => WEAPONS[a].slot - WEAPONS[b].slot)
      .map((id) => new Weapon(id));
    this.equipImmediately(1); // start with the rifle
  }

  get current(): Weapon {
    return this.weapons[this.index];
  }

  /** Aim-down-sights amount 0..1. */
  get aimAmount(): number {
    return this.ads;
  }

  get scoped(): boolean {
    return this.current.stats.scope && this.ads > 0.9;
  }

  equipImmediately(i: number): void {
    this.index = i;
    this.switchTo = -1;
    this.raiseTimer = 0;
    this.viewmodel.setWeapon(this.current.id);
  }

  /** Ammo pickup: add spare magazines to every weapon. Returns false if all are full. */
  addAmmo(magazines: number): boolean {
    let used = false;
    for (const w of this.weapons) {
      if (w.reserve < w.stats.maxReserve) {
        w.addReserve(w.stats.magazineSize * magazines);
        used = true;
      }
    }
    return used;
  }

  /** Restore full ammo on every weapon (e.g. on respawn). */
  resetAmmo(): void {
    for (const w of this.weapons) {
      w.ammo = w.stats.magazineSize;
      w.reserve = w.stats.startingReserve;
      w.cancelReload();
      w.bloom = 0;
    }
  }

  private requestSwitch(i: number): void {
    if (i < 0 || i >= this.weapons.length) return;
    const target = this.switchTo >= 0 ? this.switchTo : this.index;
    if (i === target) return;
    this.current.cancelReload();
    this.lastIndex = this.index;
    this.switchTo = i;
    this.switchTimer = LOWER_TIME;
    audio.play('weapon_switch', { volume: 0.7 });
  }

  update(dt: number, input: Input, canAct: boolean): void {
    const w = this.current;
    const { player } = this.d;

    if (canAct) this.handleInput(dt, input);

    // ---- Switching ---------------------------------------------------------
    let lowered = 0;
    if (this.switchTo >= 0) {
      this.switchTimer -= dt;
      lowered = 1 - Math.max(0, this.switchTimer) / LOWER_TIME;
      if (this.switchTimer <= 0) {
        this.index = this.switchTo;
        this.switchTo = -1;
        this.raiseTimer = this.current.stats.equipTime;
        this.viewmodel.setWeapon(this.current.id);
      }
    } else if (this.raiseTimer > 0) {
      this.raiseTimer = Math.max(0, this.raiseTimer - dt);
      lowered = this.raiseTimer / this.current.stats.equipTime;
    }

    // ---- Timers (reload, cooldown, spread recovery) ----------------------
    const wasShell = w.reloading && w.stats.reloadStyle === 'perShell';
    if (w.update(dt) === 'reloaded') audio.play(wasShell && w.reloading ? 'shell_insert' : 'reload_end');
    this.triggerBuffer = Math.max(0, this.triggerBuffer - dt);
    this.sprintBlockTimer = Math.max(0, this.sprintBlockTimer - dt);

    // ---- Tell the player about aiming effects ------------------------------
    const s = this.current.stats;
    player.zoom = 1 + (s.aimZoom - 1) * this.ads;
    player.speedMultiplier = 1 + (COMBAT.aimMoveSpeedMultiplier - 1) * this.ads;
    player.sprintBlocked = this.ads > 0.05 || this.sprintBlockTimer > 0;
    player.recoilRecovery = s.recoilRecovery * DEG;

    // ---- Viewmodel ---------------------------------------------------------
    this.sprintBlend += ((player.sprinting ? 1 : 0) - this.sprintBlend) * Math.min(1, dt * 8);
    this.viewmodel.visible = !this.scoped;
    this.viewmodel.update(dt, {
      ads: this.ads,
      sprint: this.sprintBlend,
      move: player.moveFactor,
      lookDX: player.lastLookDX,
      lookDY: player.lastLookDY,
      lowered,
      reloading: this.current.reloading && this.current.stats.reloadStyle === 'magazine',
      onGround: player.onGround,
    });

    // ---- HUD ---------------------------------------------------------------
    const cur = this.current;
    this.d.hud.updateAmmo({
      weapon: cur.id,
      ammo: cur.ammo,
      magazine: cur.stats.magazineSize,
      reserve: cur.reserve,
      reloadProgress: cur.reloading ? Math.max(0.01, cur.reloadProgress) : 0,
    });
    const spreadDeg = this.currentSpread();
    const cam = this.d.camera;
    const gapPx = (Math.tan(spreadDeg * DEG) / Math.tan((cam.fov * DEG) / 2)) * (window.innerHeight / 2);
    this.d.hud.updateCrosshair(4 + gapPx, cur.stats.scope ? 0 : this.ads, this.scoped);
  }

  private handleInput(dt: number, input: Input): void {
    // Weapon switching: number keys, mouse wheel, Q for last weapon.
    for (let i = 0; i < this.weapons.length; i++) {
      if (input.wasPressed(`Digit${this.weapons[i].stats.slot}`)) this.requestSwitch(i);
    }
    const wheel = input.consumeWheel();
    if (wheel !== 0) {
      const from = this.switchTo >= 0 ? this.switchTo : this.index;
      const n = this.weapons.length;
      this.requestSwitch((from + (wheel > 0 ? 1 : -1) + n) % n);
    }
    if (input.wasPressed('KeyQ')) this.requestSwitch(this.lastIndex);

    const busy = this.switchTo >= 0 || this.raiseTimer > 0;
    const w = this.current;

    // Aim down sights (hold right mouse).
    const wantAds = input.isMouseDown(2) && !busy && !(w.reloading && w.stats.reloadStyle === 'magazine');
    const aimRate = COMBAT.aimSpeed * dt;
    this.ads = wantAds ? Math.min(1, this.ads + aimRate) : Math.max(0, this.ads - aimRate);

    if (input.wasPressed('KeyR') && !busy && w.startReload()) audio.play('reload_start');

    if (busy) return;

    // Trigger.
    if (input.wasMousePressed(0)) this.triggerBuffer = TRIGGER_BUFFER;
    const wantsFire = w.stats.automatic ? input.isMouseDown(0) || this.triggerBuffer > 0 : this.triggerBuffer > 0;
    if (!wantsFire) return;

    if (w.canFire()) {
      this.triggerBuffer = 0;
      this.fire(w);
    } else if (w.ammo === 0 && !w.reloading && input.wasMousePressed(0)) {
      this.triggerBuffer = 0;
      if (w.startReload()) audio.play('reload_start');
      else audio.play('dry_fire');
    }
  }

  /** Total spread right now, in degrees. */
  currentSpread(): number {
    const { player } = this.d;
    const s = this.current.stats;
    const aimMult = 1 + (s.aimSpreadMultiplier - 1) * this.ads;
    let spread = (s.baseSpread + this.current.bloom) * aimMult;
    spread += s.moveSpread * player.moveFactor * (1 - 0.5 * this.ads);
    if (!player.onGround) spread += s.airSpread;
    if (player.crouching && player.onGround) spread *= COMBAT.crouchSpreadMultiplier;
    return spread;
  }

  private fire(w: Weapon): void {
    const { player, camera, world, effects, hud } = this.d;
    const spread = this.currentSpread();
    w.fire();
    this.sprintBlockTimer = COMBAT.sprintBlockAfterShot;

    camera.updateMatrixWorld();
    camera.getWorldPosition(this._origin);
    camera.getWorldDirection(this._dir);
    this.viewmodel.muzzleWorldPosition(camera, this._muzzle);

    // Add up damage per target so a shotgun blast shows one hit marker.
    const hits = new Map<Damageable, { damage: number; part: HitPart }>();
    const targets = this.d.getTargets();
    for (let p = 0; p < w.stats.pellets; p++) {
      applySpread(this._dir, spread, this._pellet);
      const r = traceShot(world, targets, this._origin, this._pellet, w.stats.range);
      // Tracers: every bullet, but only a few shotgun pellets to avoid clutter.
      if (p < 3) effects.tracer(this._muzzle, r.point);
      if (r.target && r.part) {
        const h = hits.get(r.target) ?? { damage: 0, part: 'body' as HitPart };
        h.damage += shotDamage(w.stats, r.distance, r.part);
        if (r.part === 'head') h.part = 'head';
        hits.set(r.target, h);
        effects.bloodPuff(r.point, this._pellet);
      } else if (r.normal) {
        effects.impact(r.point, r.normal);
        if (p === 0) audio.play('impact', { position: r.point, volume: 0.6 });
      }
    }

    let marker: 'hit' | 'head' | 'kill' | null = null;
    for (const [target, h] of hits) {
      const killed = target.takeDamage({
        amount: h.damage,
        part: h.part,
        attacker: this.d.ownerName,
        weapon: w.id,
        from: this._origin.clone(),
      });
      const kind = killed ? 'kill' : h.part === 'head' ? 'head' : 'hit';
      if (!marker || kind === 'kill' || (kind === 'head' && marker === 'hit')) marker = kind;
    }
    if (marker) {
      hud.showHitmarker(marker);
      audio.play(marker === 'kill' ? 'kill' : marker === 'head' ? 'hit_head' : 'hit');
    }

    // Recoil, visual kick, sound, and let everyone (bots) hear it.
    player.addRecoil(w.stats.recoilPitch, (Math.random() * 2 - 1) * w.stats.recoilYaw);
    this.viewmodel.kick(Math.min(2.5, 0.6 + w.stats.recoilPitch * 0.35));
    effects.muzzleLight(this._muzzle);
    audio.play(`shot_${w.id}` as SoundId);
    events.emit('shot', {
      shooter: this.d.ownerName,
      weapon: w.id,
      position: this._origin.clone(),
      hearingRange: w.stats.hearingRange,
    });
  }
}
