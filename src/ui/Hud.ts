import { CONFIG, WEAPONS, type WeaponId } from '../config';

export type HitmarkerKind = 'hit' | 'head' | 'kill';

export interface AmmoInfo {
  weapon: WeaponId;
  ammo: number;
  magazine: number;
  reserve: number;
  reloadProgress: number; // 0 when not reloading
}

/** In-game heads-up display. Grows with each milestone. */
export class Hud {
  private root: HTMLDivElement;
  private debugEl: HTMLDivElement;
  private crosshair: HTMLDivElement;
  private hitmarker: HTMLDivElement;
  private ammoName: HTMLDivElement;
  private ammoCount: HTMLDivElement;
  private ammoReserve: HTMLSpanElement;
  private reloadBar: HTMLDivElement;
  private reloadFill: HTMLDivElement;
  private slots = new Map<WeaponId, HTMLDivElement>();
  private scope: HTMLDivElement;
  private notice: HTMLDivElement;
  private healthFill: HTMLDivElement;
  private healthText: HTMLDivElement;
  private armorFill: HTMLDivElement;
  private armorText: HTMLDivElement;
  private armorRow: HTMLDivElement;
  private vignette: HTMLDivElement;
  private lowHealth: HTMLDivElement;
  private indicators: { el: HTMLDivElement; x: number; z: number; life: number }[] = [];
  private killFeed: HTMLDivElement;
  private deathScreen: HTMLDivElement;
  private deathText: HTMLDivElement;
  private deathTimer: HTMLDivElement;
  private hurtFlash = 0;

  private hitTimer = 0;
  private frames = 0;
  private fpsTimer = 0;
  private fps = 0;
  showDebug = true;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud', parent);
    this.vignette = el('div', 'hurt-vignette', this.root);
    this.lowHealth = el('div', 'low-health', this.root);
    this.scope = el('div', 'scope', this.root);
    el('div', 'scope-lines', this.scope);

    this.crosshair = el('div', 'crosshair', this.root);
    for (const side of ['top', 'bottom', 'left', 'right']) el('div', `ch-line ch-${side}`, this.crosshair);
    el('div', 'ch-dot', this.crosshair);

    this.hitmarker = el('div', 'hitmarker', this.root);
    for (let i = 0; i < 4; i++) el('div', 'hm-line', this.hitmarker);

    this.notice = el('div', 'notice', this.root);

    const weaponPanel = el('div', 'weapon-panel', this.root);
    const slotList = el('div', 'slots', weaponPanel);
    for (const id of Object.keys(WEAPONS) as WeaponId[]) {
      const s = el('div', 'slot', slotList);
      s.innerHTML = `<span class="key">${WEAPONS[id].slot}</span>${WEAPONS[id].name}`;
      this.slots.set(id, s);
    }
    this.ammoName = el('div', 'ammo-name', weaponPanel);
    this.ammoCount = el('div', 'ammo-count', weaponPanel);
    this.ammoReserve = document.createElement('span');
    this.reloadBar = el('div', 'reload-bar', weaponPanel);
    this.reloadFill = el('div', 'reload-fill', this.reloadBar);

    // Damage direction indicators: arcs around the crosshair.
    const ring = el('div', 'dmg-ring', this.root);
    for (let i = 0; i < 6; i++) {
      const ind = el('div', 'dmg-indicator', ring);
      this.indicators.push({ el: ind, x: 0, z: 0, life: 0 });
    }

    // Health + armor, bottom left.
    const vitals = el('div', 'vitals', this.root);
    const hRow = el('div', 'vital-row', vitals);
    el('div', 'vital-icon health-icon', hRow).textContent = '+';
    this.healthText = el('div', 'vital-num', hRow);
    const hBar = el('div', 'vital-bar', hRow);
    this.healthFill = el('div', 'vital-fill health-fill', hBar);
    this.armorRow = el('div', 'vital-row armor-row', vitals);
    el('div', 'vital-icon armor-icon', this.armorRow).textContent = '◆';
    this.armorText = el('div', 'vital-num', this.armorRow);
    const aBar = el('div', 'vital-bar', this.armorRow);
    this.armorFill = el('div', 'vital-fill armor-fill', aBar);

    this.killFeed = el('div', 'kill-feed', this.root);

    this.deathScreen = el('div', 'death-screen', this.root);
    this.deathText = el('div', 'death-title', this.deathScreen);
    this.deathTimer = el('div', 'death-timer', this.deathScreen);

    this.debugEl = el('div', 'debug', this.root);
  }

  updateVitals(health: number, armor: number): void {
    const P = CONFIG.player;
    this.healthText.textContent = String(Math.ceil(health));
    this.healthFill.style.width = `${(health / P.maxHealth) * 100}%`;
    this.healthFill.classList.toggle('low', health <= 30);
    this.armorRow.style.opacity = armor > 0 ? '1' : '0.35';
    this.armorText.textContent = String(Math.ceil(armor));
    this.armorFill.style.width = `${(armor / P.maxArmor) * 100}%`;
    // Red edges that pulse when health is low.
    const low = health > 0 && health <= 35 ? 1 - health / 35 : 0;
    this.lowHealth.style.opacity = String(low * (0.55 + 0.25 * Math.sin(performance.now() / 180)));
  }

  /** Show where damage came from (attacker's world position x/z). */
  showDamage(fromX: number, fromZ: number, amount: number): void {
    this.hurtFlash = Math.min(1, this.hurtFlash + 0.25 + amount / 60);
    // Reuse an indicator for the same attacker spot, else the oldest one.
    let ind = this.indicators.find((i) => i.life > 0 && Math.hypot(i.x - fromX, i.z - fromZ) < 2);
    ind ??= this.indicators.reduce((a, b) => (a.life < b.life ? a : b));
    ind.x = fromX;
    ind.z = fromZ;
    ind.life = 1.4;
  }

  /** Point each indicator at its attacker, relative to where you're facing. */
  private updateIndicators(dt: number, px: number, pz: number, yaw: number): void {
    for (const ind of this.indicators) {
      if (ind.life <= 0) {
        ind.el.style.opacity = '0';
        continue;
      }
      ind.life -= dt;
      const attackerYaw = Math.atan2(-(ind.x - px), -(ind.z - pz));
      ind.el.style.opacity = String(Math.min(1, ind.life));
      ind.el.style.transform = `rotate(${yaw - attackerYaw}rad)`;
    }
  }

  addKill(killer: string, victim: string, weapon: WeaponId, headshot: boolean): void {
    const row = document.createElement('div');
    row.className = 'kf-row';
    const you = (n: string) => (n === 'You' ? ' you' : '');
    row.innerHTML = `<span class="kf-name${you(killer)}"></span><span class="kf-weapon"></span><span class="kf-name${you(victim)}"></span>`;
    const spans = row.querySelectorAll('span');
    spans[0].textContent = killer;
    spans[1].textContent = `[${WEAPONS[weapon].name}]${headshot ? ' ✛' : ''}`;
    spans[2].textContent = victim;
    this.killFeed.prepend(row);
    while (this.killFeed.children.length > 5) this.killFeed.lastElementChild!.remove();
    setTimeout(() => row.classList.add('fade'), 5000);
    setTimeout(() => row.remove(), 6000);
  }

  /** Death screen; pass null to hide. */
  setDeath(info: { killer: string; seconds: number } | null): void {
    this.deathScreen.style.display = info ? 'flex' : 'none';
    if (!info) return;
    this.deathText.textContent = `Killed by ${info.killer}`;
    this.deathTimer.textContent = `Respawning in ${Math.max(0, Math.ceil(info.seconds))}`;
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
  }

  /**
   * @param gapPx distance from center to the crosshair lines (shows spread)
   * @param ads 0..1 aim amount (crosshair fades out while aiming)
   * @param scoped show the sniper scope
   */
  updateCrosshair(gapPx: number, ads: number, scoped: boolean): void {
    this.crosshair.style.setProperty('--gap', `${Math.min(gapPx, 160).toFixed(1)}px`);
    this.crosshair.style.opacity = scoped ? '0' : String(1 - ads * 0.85);
    this.scope.style.display = scoped ? 'block' : 'none';
  }

  updateAmmo(a: AmmoInfo): void {
    this.ammoName.textContent = WEAPONS[a.weapon].name;
    this.ammoCount.textContent = String(a.ammo);
    this.ammoCount.classList.toggle('low', a.ammo <= Math.ceil(a.magazine * 0.25));
    this.ammoReserve.textContent = ` / ${a.reserve}`;
    this.ammoCount.appendChild(this.ammoReserve);
    for (const [id, s] of this.slots) s.classList.toggle('active', id === a.weapon);
    this.reloadBar.style.visibility = a.reloadProgress > 0 ? 'visible' : 'hidden';
    this.reloadFill.style.width = `${(a.reloadProgress * 100).toFixed(0)}%`;

    if (a.reloadProgress > 0) this.setNotice('Reloading');
    else if (a.ammo === 0 && a.reserve === 0) this.setNotice('Out of ammo');
    else if (a.ammo === 0) this.setNotice('Press R to reload');
    else if (a.ammo <= Math.ceil(a.magazine * 0.25)) this.setNotice('Low ammo');
    else this.setNotice('');
  }

  private setNotice(text: string): void {
    if (this.notice.textContent !== text) this.notice.textContent = text;
  }

  showHitmarker(kind: HitmarkerKind): void {
    this.hitmarker.className = `hitmarker show ${kind}`;
    this.hitTimer = kind === 'kill' ? 0.35 : 0.18;
  }

  /** @param px,pz,yaw the player's position and facing, for damage indicators */
  update(dt: number, px: number, pz: number, yaw: number): void {
    this.updateIndicators(dt, px, pz, yaw);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.8);
    this.vignette.style.opacity = String(this.hurtFlash);
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) this.hitmarker.classList.remove('show');
    }
  }

  /** Small info readout in the corner (toggle with F3). */
  updateDebug(dt: number, lines: () => string[]): void {
    this.frames++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.frames / this.fpsTimer);
      this.frames = 0;
      this.fpsTimer = 0;
      this.debugEl.textContent = this.showDebug ? [`FPS ${this.fps}`, ...lines()].join('\n') : '';
    }
  }
}

function el(tag: string, className: string, parent: HTMLElement): HTMLDivElement {
  const e = document.createElement(tag) as HTMLDivElement;
  e.className = className;
  parent.appendChild(e);
  return e;
}
