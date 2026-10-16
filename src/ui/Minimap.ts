import type * as THREE from 'three';
import type { MapDef, PickupType } from '../map/MapTypes';

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
    const w = Math.ceil((bounds.max.x - bounds.min.x) * SCALE);
    const h = Math.ceil((bounds.max.z - bounds.min.z) * SCALE);
    this.originX = bounds.min.x;
    this.originZ = bounds.min.z;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(40, 48, 58, 0.9)';
    g.fillRect(0, 0, w, h);
    const px = (x: number) => (x - this.originX) * SCALE;
    const pz = (z: number) => (z - this.originZ) * SCALE;

    // Draw lower things first so tall things end up on top.
    const boxes = [...def.boxes].filter((b) => b.y + b.h > 0.05).sort((a, b) => a.y + a.h - (b.y + b.h));
    for (const b of boxes) {
      const top = b.y + b.h;
      const area = b.w * b.d;
      if (top < 1.5) g.fillStyle = '#6d7480'; // low cover
      else if (area > 20 && b.h < 3.1) g.fillStyle = '#5a6472'; // raised floors (decks, roof)
      else g.fillStyle = '#b9c0c8'; // walls, pillars
      g.fillRect(px(b.x - b.w / 2), pz(b.z - b.d / 2), b.w * SCALE, b.d * SCALE);
    }
    g.fillStyle = '#4e5866';
    for (const r of def.ramps) g.fillRect(px(r.x - r.w / 2), pz(r.z - r.d / 2), r.w * SCALE, r.d * SCALE);
    this.layout = c;
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
    g.fillStyle = 'rgba(20, 24, 30, 0.75)';
    g.fillRect(0, 0, SIZE, SIZE);

    // World → radar: move the player to the center, then turn so "forward" is up.
    g.translate(r, r);
    g.rotate(yaw);
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

    // You: an arrow in the middle, pointing up.
    g.fillStyle = '#ffd23a';
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
    // Border.
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(r, r, r - 1, 0, Math.PI * 2);
    g.stroke();
  }
}
