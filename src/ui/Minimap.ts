import type * as THREE from 'three';
import type { BoxDef, MapDef, PickupType, RampDef } from '../map/MapTypes';

/** Pixels per meter on the radar, and how far it shows (meters). */
const SCALE = 3.2;
const SIZE = 190;

export interface RadarBlip {
  x: number;
  y: number;
  z: number;
  kind: 'enemy' | PickupType;
}

/**
 * A round radar in the corner. It turns with you (up = where you're facing).
 * It shows the map layout, pickups, and enemies you can see or that just fired.
 */
export class Minimap {
  readonly el: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private layout: HTMLCanvasElement | null = null;
  /** Multi-story maps: one layout per level, with each level's floor height. */
  private levelLayouts: { y: number; canvas: HTMLCanvasElement }[] = [];
  private originX = 0;
  private originZ = 0;
  private dpr = Math.min(2, window.devicePixelRatio || 1);

  constructor(parent: HTMLElement) {
    this.el = document.createElement('canvas');
    this.el.className = 'minimap';
    this.el.width = SIZE * this.dpr;
    this.el.height = SIZE * this.dpr;
    this.el.style.width = `${SIZE}px`;
    this.el.style.height = `${SIZE}px`;
    this.ctx = this.el.getContext('2d')!;
    parent.appendChild(this.el);
  }

  /** Draw the map layout once (seen from above) for this match. */
  setMap(def: MapDef, bounds: THREE.Box3): void {
    this.originX = bounds.min.x;
    this.originZ = bounds.min.z;
    this.levelLayouts = [];
    if (def.levels && def.levels.length > 1) {
      // One picture per floor: that floor's slabs and the walls standing on it.
      const lv = def.levels;
      lv.forEach((y, i) => {
        const next = lv[i + 1] ?? Infinity;
        const slab = (b: BoxDef) => b.h < 0.6 && b.w * b.d > 20;
        const floors = i === 0 ? [] : def.boxes.filter((b) => slab(b) && Math.abs(b.y + b.h - y) < 0.15);
        const walls = def.boxes.filter((b) => !slab(b) && b.y >= y - 0.05 && b.y < next - 0.05);
        const ramps = def.ramps.filter((r) => Math.max(r.low, r.high) > y - 0.05 && Math.min(r.low, r.high) < next - 0.05);
        this.levelLayouts.push({ y, canvas: this.drawLayout(bounds, floors, walls, ramps, y) });
      });
      this.layout = this.levelLayouts[0].canvas;
      return;
    }
    this.layout = this.drawLayout(bounds, [], def.boxes, def.ramps, 0);
  }

  private drawLayout(bounds: THREE.Box3, floors: BoxDef[], boxes: BoxDef[], ramps: RampDef[], levelY: number): HTMLCanvasElement {
    const w = Math.ceil((bounds.max.x - bounds.min.x) * SCALE);
    const h = Math.ceil((bounds.max.z - bounds.min.z) * SCALE);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    g.fillStyle = levelY > 0 ? 'rgba(14, 17, 22, 0.95)' : 'rgba(40, 48, 58, 0.9)';
    g.fillRect(0, 0, w, h);
    const px = (x: number) => (x - this.originX) * SCALE;
    const pz = (z: number) => (z - this.originZ) * SCALE;
    // Upper floors: where there's floor to stand on.
    g.fillStyle = 'rgba(40, 48, 58, 0.95)';
    for (const b of floors) g.fillRect(px(b.x - b.w / 2), pz(b.z - b.d / 2), b.w * SCALE, b.d * SCALE);

    // Draw lower things first so tall things end up on top.
    const sorted = [...boxes].filter((b) => b.y + b.h > levelY + 0.05).sort((a, b) => a.y + a.h - (b.y + b.h));
    for (const b of sorted) {
      const top = b.y + b.h - levelY;
      const area = b.w * b.d;
      if (b.material === 'glass') g.fillStyle = '#7fb2cc'; // windows and glass railings
      else if (top < 1.5) g.fillStyle = '#6d7480'; // low cover, furniture
      else if (area > 20 && b.h < 3.1) g.fillStyle = '#5a6472'; // raised floors (decks, roof)
      else g.fillStyle = '#b9c0c8'; // walls, pillars
      g.fillRect(px(b.x - b.w / 2), pz(b.z - b.d / 2), b.w * SCALE, b.d * SCALE);
    }
    g.fillStyle = '#4e5866';
    for (const r of ramps) g.fillRect(px(r.x - r.w / 2), pz(r.z - r.d / 2), r.w * SCALE, r.d * SCALE);
    return c;
  }

  /** Redraw centered on the player (x, z), turned by `yaw`. */
  draw(x: number, y: number, z: number, yaw: number, blips: RadarBlip[]): void {
    const g = this.ctx;
    const d = this.dpr;
    const r = SIZE / 2;
    g.setTransform(d, 0, 0, d, 0, 0);
    g.clearRect(0, 0, SIZE, SIZE);
    g.save();
    g.beginPath();
    g.arc(r, r, r - 1, 0, Math.PI * 2);
    g.clip();
    const bg = g.createRadialGradient(r, r, 0, r, r, r);
    bg.addColorStop(0, 'rgba(26, 31, 40, 0.82)');
    bg.addColorStop(1, 'rgba(12, 15, 20, 0.88)');
    g.fillStyle = bg;
    g.fillRect(0, 0, SIZE, SIZE);

    // World → radar: move the player to the center, then turn so "forward" is up.
    g.translate(r, r);
    g.rotate(yaw);
    // Multi-story maps: show the floor you're on.
    if (this.levelLayouts.length) {
      let pick = this.levelLayouts[0];
      for (const l of this.levelLayouts) if (y >= l.y - 0.6) pick = l;
      this.layout = pick.canvas;
    }
    if (this.layout) g.drawImage(this.layout, (this.originX - x) * SCALE, (this.originZ - z) * SCALE);

    for (const b of blips) {
      const bx = (b.x - x) * SCALE, bz = (b.z - z) * SCALE;
      if (bx * bx + bz * bz > (r - 6) * (r - 6)) continue;
      g.save();
      g.translate(bx, bz);
      g.rotate(-yaw); // keep icons upright
      if (b.kind === 'enemy') {
        g.fillStyle = '#ff3b30';
        g.strokeStyle = '#000';
        g.lineWidth = 1.5;
        g.beginPath();
        // Triangle pointing up/down if the enemy is above/below you.
        const dy = b.y - y;
        if (dy > 2) { g.moveTo(0, -5); g.lineTo(5, 4); g.lineTo(-5, 4); g.closePath(); }
        else if (dy < -2) { g.moveTo(0, 5); g.lineTo(5, -4); g.lineTo(-5, -4); g.closePath(); }
        else g.arc(0, 0, 4.5, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      } else {
        g.fillStyle = b.kind === 'health' ? '#ff6a5e' : b.kind === 'armor' ? '#5fb4ff' : '#e0b33a';
        g.fillRect(-3, -3, 6, 6);
      }
      g.restore();
    }
    g.restore();

    // Range rings (every 10 m) and your view cone.
    g.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    g.lineWidth = 1;
    for (let m = 10; m * SCALE < r; m += 10) {
      g.beginPath();
      g.arc(r, r, m * SCALE, 0, Math.PI * 2);
      g.stroke();
    }
    const cone = g.createRadialGradient(r, r, 4, r, r, r * 0.85);
    cone.addColorStop(0, 'rgba(232, 185, 58, 0.28)');
    cone.addColorStop(1, 'rgba(232, 185, 58, 0)');
    g.fillStyle = cone;
    g.beginPath();
    g.moveTo(r, r);
    g.arc(r, r, r * 0.85, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62);
    g.closePath();
    g.fill();

    // You: an arrow in the middle, pointing up.
    g.fillStyle = '#e8b93a';
    g.strokeStyle = '#000';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(r, r - 7);
    g.lineTo(r + 5, r + 5);
    g.lineTo(r, r + 2);
    g.lineTo(r - 5, r + 5);
    g.closePath();
    g.fill();
    g.stroke();
    // Rim: a dark ring with a thin gold line, plus a marker showing north.
    g.strokeStyle = 'rgba(8, 10, 14, 0.9)';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(r, r, r - 2, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = 'rgba(232, 185, 58, 0.55)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(r, r, r - 4.5, 0, Math.PI * 2);
    g.stroke();
    // North (-Z in the world) turns with you, like the map.
    const nx = r + Math.sin(yaw) * (r - 14), ny = r - Math.cos(yaw) * (r - 14);
    g.fillStyle = 'rgba(8, 10, 14, 0.85)';
    g.beginPath();
    g.arc(nx, ny, 8, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#e8b93a';
    g.font = '700 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', nx, ny + 0.5);
  }
}
