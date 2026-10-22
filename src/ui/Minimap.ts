import type * as THREE from 'three';
import type { BoxDef, MapDef, PickupType, RampDef } from '../map/MapTypes';
import { terrainHeightAt } from '../map/terrain';

/** Terrain shading per map (it's the same every match). */
const terrainShadeCache = new Map<string, HTMLCanvasElement>();

/** Pixels per meter on the radar, and how far it shows (meters). */
const SCALE = 3.2;
const SIZE = 190;

export interface RadarBlip {
  x: number;
  y: number;
  z: number;
  /** enemy, teammate, pickup, or a game-mode mark (hill, zone, flag). */
  kind: 'enemy' | 'ally' | 'mark' | PickupType;
  /** Marks: CSS color, a short label, and a radius (meters) to draw a ring instead of a dot. */
  color?: string;
  label?: string;
  radius?: number;
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
  private def: MapDef | null = null;
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
    this.def = def;
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
    const terrain = this.def?.terrain;
    if (terrain && levelY <= 0) this.drawTerrain(g, w, h);
    // Height of the ground under a box (on hilly maps, so a crate on a hill still reads as a crate).
    const groundUnder = (b: BoxDef) => (terrain ? Math.max(levelY, terrainHeightAt(terrain, b.x, b.z)) : levelY);
    // Upper floors: where there's floor to stand on.
    g.fillStyle = 'rgba(40, 48, 58, 0.95)';
    for (const b of floors) g.fillRect(px(b.x - b.w / 2), pz(b.z - b.d / 2), b.w * SCALE, b.d * SCALE);

    // Draw lower things first so tall things end up on top.
    const sorted = [...boxes].filter((b) => !b.hidden && b.y + b.h > levelY + 0.05).sort((a, b) => a.y + a.h - (b.y + b.h));
    for (const b of sorted) {
      const top = b.y + b.h - groundUnder(b);
      const area = b.w * b.d;
      if (b.material === 'glass') g.fillStyle = '#7fb2cc'; // windows and glass railings
      else if (b.material === 'water') g.fillStyle = '#3f7896';
      else if (top < 1.5) g.fillStyle = '#6d7480'; // low cover, furniture
      else if (area > 20 && b.h < 3.1) g.fillStyle = '#5a6472'; // raised floors (decks, roof)
      else g.fillStyle = '#b9c0c8'; // walls, pillars
      g.fillRect(px(b.x - b.w / 2), pz(b.z - b.d / 2), b.w * SCALE, b.d * SCALE);
    }
    for (const r of ramps) {
      g.fillStyle = r.material === 'water' ? '#3f7896' : '#4e5866';
      g.fillRect(px(r.x - r.w / 2), pz(r.z - r.d / 2), r.w * SCALE, r.d * SCALE);
    }
    // Trees and rocks: small dots.
    for (const p of this.def?.props ?? []) {
      if (p.kind === 'bush') continue;
      g.fillStyle = p.kind === 'rock' ? '#8a8d90' : p.kind === 'log' || p.kind === 'stump' ? '#6b5a44' : '#1d2b1c';
      const r = (p.kind === 'rock' ? 1.0 : p.kind === 'log' ? 0.6 : 0.9) * (p.size ?? 1) * SCALE;
      g.beginPath();
      g.arc(px(p.x), pz(p.z), Math.max(1.5, r), 0, Math.PI * 2);
      g.fill();
    }
    return c;
  }

  /** Hilly ground: greener low, lighter high, gray where steep, with contour lines every 2 m and dirt paths. */
  private drawTerrain(g: CanvasRenderingContext2D, w: number, h: number): void {
    const t = this.def!.terrain!;
    // Shaded at 1 pixel per meter (then scaled up smoothly): quick to make, and kept for the next match.
    const key = `${this.def!.id}:${this.originX}:${this.originZ}:${w}:${h}`;
    let shade = terrainShadeCache.get(key);
    if (!shade) {
      let lo = Infinity, hi = -Infinity;
      for (const v of t.heights) { if (v < lo) lo = v; if (v > hi) hi = v; }
      const sw = Math.ceil(w / SCALE), sh = Math.ceil(h / SCALE);
      shade = document.createElement('canvas');
      shade.width = sw;
      shade.height = sh;
      const sg = shade.getContext('2d', { willReadFrequently: true })!;
      const img = sg.createImageData(sw, sh);
      const d = img.data;
      const heightAt = (px: number, pz: number) => terrainHeightAt(t, this.originX + px, this.originZ + pz);
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          const hv = heightAt(x, y);
          if (!Number.isFinite(hv)) continue;
          const hr = heightAt(x + 1, y), hd = heightAt(x, y + 1);
          const slope = Math.max(Math.abs(hr - hv), Math.abs(hd - hv)) || 0;
          const k = (hv - lo) / Math.max(1, hi - lo);
          let r = 44 + k * 46, gg = 58 + k * 44, b = 40 + k * 30;
          if (slope > 0.85) { r = gg = b = 96 + k * 30; }
          // Contour line where the 2 m band changes.
          if (Math.floor(hv / 2) !== Math.floor(hr / 2) || Math.floor(hv / 2) !== Math.floor(hd / 2)) { r *= 0.72; gg *= 0.72; b *= 0.72; }
          const i = (y * sw + x) * 4;
          d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 240;
        }
      }
      sg.putImageData(img, 0, 0);
      terrainShadeCache.set(key, shade);
    }
    g.imageSmoothingEnabled = true;
    g.drawImage(shade, 0, 0, shade.width * SCALE, shade.height * SCALE);
    g.strokeStyle = 'rgba(150, 128, 92, 0.85)';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const path of t.paths ?? []) {
      g.lineWidth = path.width * SCALE;
      g.beginPath();
      path.points.forEach(([x, z], i) => (i ? g.lineTo : g.moveTo).call(g, (x - this.originX) * SCALE, (z - this.originZ) * SCALE));
      g.stroke();
    }
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

    // Rings first (zones, the Battle Royale circle), under everything else.
    for (const b of blips) {
      if (b.kind !== 'mark' || !b.radius) continue;
      g.strokeStyle = b.color ?? '#fff';
      g.lineWidth = 2;
      g.globalAlpha = 0.85;
      g.beginPath();
      g.arc((b.x - x) * SCALE, (b.z - z) * SCALE, b.radius * SCALE, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 0.14;
      g.fillStyle = b.color ?? '#fff';
      g.fill();
      g.globalAlpha = 1;
    }
    for (const b of blips) {
      let bx = (b.x - x) * SCALE, bz = (b.z - z) * SCALE;
      const far = bx * bx + bz * bz > (r - 8) * (r - 8);
      if (far) {
        // Objectives stay on the radar's rim, pointing the way.
        if (b.kind !== 'mark' || !b.label) continue;
        const k = (r - 9) / Math.hypot(bx, bz);
        bx *= k;
        bz *= k;
      }
      g.save();
      g.translate(bx, bz);
      g.rotate(-yaw); // keep icons upright
      if (b.kind === 'mark') {
        if (b.label) {
          g.fillStyle = b.color ?? '#fff';
          g.strokeStyle = '#000';
          g.lineWidth = 1.5;
          g.beginPath();
          g.arc(0, 0, 7, 0, Math.PI * 2);
          g.fill();
          g.stroke();
          g.fillStyle = '#111';
          g.font = 'bold 9px system-ui, sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(b.label.length > 2 ? b.label[0] : b.label, 0, 0.5);
        }
      } else if (b.kind === 'ally') {
        g.fillStyle = '#5aa6ff';
        g.strokeStyle = '#000';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(0, 0, 4, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      } else if (b.kind === 'enemy') {
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
