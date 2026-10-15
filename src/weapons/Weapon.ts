import { WEAPONS, type WeaponId, type WeaponStats } from '../config';

/**
 * One weapon's live state: ammo, cooldown between shots, reloading.
 * Used by the player now, and by bots later.
 */
export class Weapon {
  readonly stats: WeaponStats;
  ammo: number;
  reserve: number;
  /** Seconds until the next shot is allowed. */
  cooldown = 0;
  /** Seconds left in the current reload (or shell), 0 if not reloading. */
  reloadTimer = 0;
  /** Extra spread from recent shots (degrees). */
  bloom = 0;

  constructor(readonly id: WeaponId) {
    this.stats = WEAPONS[id];
    this.ammo = this.stats.magazineSize;
    this.reserve = this.stats.startingReserve;
  }

  get reloading(): boolean {
    return this.reloadTimer > 0;
  }

  canFire(): boolean {
    return this.cooldown <= 0 && this.ammo > 0 && (!this.reloading || this.stats.reloadStyle === 'perShell');
  }

  /** Spends a round and starts the cooldown. Call only when canFire(). */
  fire(): void {
    this.ammo--;
    this.cooldown = 1 / this.stats.fireRate;
    this.reloadTimer = 0; // firing interrupts shell-by-shell reloading
    this.bloom = Math.min(this.stats.maxSpread - this.stats.baseSpread, this.bloom + this.stats.spreadPerShot);
  }

  canReload(): boolean {
    return !this.reloading && this.ammo < this.stats.magazineSize && this.reserve > 0;
  }

  startReload(): boolean {
    if (!this.canReload()) return false;
    this.reloadTimer = this.stats.reloadTime;
    return true;
  }

  cancelReload(): void {
    this.reloadTimer = 0;
  }

  /**
   * Advance timers. Returns 'reloaded' when a reload (or one shell) finishes.
   */
  update(dt: number): 'reloaded' | null {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.bloom = Math.max(0, this.bloom - this.stats.spreadRecovery * dt);
    if (!this.reloading) return null;
    this.reloadTimer -= dt;
    if (this.reloadTimer > 0) return null;
    this.reloadTimer = 0;
    if (this.stats.reloadStyle === 'perShell') {
      this.ammo++;
      this.reserve--;
      // Keep loading shells until full or out of spare ammo.
      if (this.ammo < this.stats.magazineSize && this.reserve > 0) this.reloadTimer = this.stats.reloadTime;
    } else {
      const take = Math.min(this.stats.magazineSize - this.ammo, this.reserve);
      this.ammo += take;
      this.reserve -= take;
    }
    return 'reloaded';
  }

  /** Reload progress 0..1 for the HUD. */
  get reloadProgress(): number {
    return this.reloading ? 1 - this.reloadTimer / this.stats.reloadTime : 0;
  }

  addReserve(amount: number): void {
    this.reserve = Math.min(this.stats.maxReserve, this.reserve + amount);
  }
}
