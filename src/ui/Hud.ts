import { WEAPONS, type WeaponId } from '../config';

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

  private hitTimer = 0;
  private frames = 0;
  private fpsTimer = 0;
  private fps = 0;
  showDebug = true;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud', parent);
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

    this.debugEl = el('div', 'debug', this.root);
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

  update(dt: number): void {
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
