import * as THREE from 'three';
import type { MaterialId } from '../map/MapTypes';
import { addBakedLighting } from '../render/shaders';

/**
 * Materials for map surfaces. Textures are drawn in code on a canvas.
 * To use real image textures later, replace `makeTexture` with
 * `new THREE.TextureLoader().load('/textures/xyz.png')` for that material.
 */

/**
 * Every kind of surface: the map's own materials plus the detail parts the
 * map builder adds (bricks, mortar, concrete panels, crate frames).
 */
export type SurfaceId = MaterialId | 'brick' | 'mortar' | 'panel' | 'seam' | 'concreteWall' | 'crateFrame';

interface MaterialStyle {
  base: string;
  line: string;
  /** Texture tiles every N meters. */
  tileSize: number;
  pattern: 'grid' | 'bricks' | 'planks' | 'grain' | 'plates' | 'concrete' | 'concretePanels' | 'speckle' | 'chipped' | 'plain';
  roughness: number;
  metalness: number;
}

const STYLES: Record<SurfaceId, MaterialStyle> = {
  floor: { base: '#5d636b', line: '#4b5057', tileSize: 2, pattern: 'grid', roughness: 0.9, metalness: 0 },
  // Brick walls on Low graphics (flat texture); Medium/High use real bricks + mortar.
  wall: { base: '#8f5844', line: '#b3a996', tileSize: 2, pattern: 'bricks', roughness: 0.95, metalness: 0 },
  brick: { base: '#93573f', line: '#6e3f2d', tileSize: 1, pattern: 'speckle', roughness: 0.92, metalness: 0 },
  mortar: { base: '#b3aa9b', line: '#9a9284', tileSize: 1, pattern: 'speckle', roughness: 1, metalness: 0 },
  concrete: { base: '#8c8f93', line: '#74777b', tileSize: 4, pattern: 'concrete', roughness: 0.9, metalness: 0 },
  seam: { base: '#55585c', line: '#46494d', tileSize: 1, pattern: 'speckle', roughness: 1, metalness: 0 },
  // Concrete walls on Low graphics: the panel seams and tie holes are painted on.
  concreteWall: { base: '#8c8f93', line: '#55585c', tileSize: 4, pattern: 'concretePanels', roughness: 0.9, metalness: 0 },
  panel: { base: '#8f9296', line: '#76797d', tileSize: 4, pattern: 'concrete', roughness: 0.9, metalness: 0 },
  crate: { base: '#9a7446', line: '#5e4326', tileSize: 1.5, pattern: 'planks', roughness: 0.8, metalness: 0 },
  crateFrame: { base: '#7d5a33', line: '#5a3f22', tileSize: 1, pattern: 'grain', roughness: 0.8, metalness: 0 },
  metal: { base: '#5f6e7a', line: '#4a5661', tileSize: 2, pattern: 'plates', roughness: 0.5, metalness: 0.4 },
  // Jersey barriers: yellow paint over concrete, chipped and dirty.
  trim: { base: '#c9a23a', line: '#8a8378', tileSize: 1, pattern: 'chipped', roughness: 0.75, metalness: 0 },
};

function makeTexture(style: MaterialStyle): THREE.Texture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = style.base;
  g.fillRect(0, 0, size, size);
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);

  // Soft blotches (concrete, paint): large faint patches of lighter/darker.
  const blotches = (count: number, alpha: number) => {
    for (let i = 0; i < count; i++) {
      const x = rnd(0, size), y = rnd(0, size), r = rnd(10, 50);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      const v = Math.random() < 0.5 ? 0 : 255;
      grad.addColorStop(0, `rgba(${v},${v},${v},${alpha})`);
      grad.addColorStop(1, `rgba(${v},${v},${v},0)`);
      g.fillStyle = grad;
      // Draw wrapped so the texture tiles without seams.
      for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
        g.save();
        g.translate(dx, dy);
        g.fillRect(x - r, y - r, r * 2, r * 2);
        g.restore();
      }
    }
  };

  const concrete = style.pattern === 'concrete' || style.pattern === 'concretePanels';
  if (concrete || style.pattern === 'chipped') blotches(40, 0.06);

  // Fine noise so surfaces don't look perfectly flat.
  const noise = style.pattern === 'speckle' || concrete ? 26 : 14;
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * noise;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);

  g.strokeStyle = style.line;
  g.fillStyle = style.line;
  switch (style.pattern) {
    case 'grid':
      g.lineWidth = 4;
      g.strokeRect(0, 0, size, size);
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(size / 2, 0); g.lineTo(size / 2, size);
      g.moveTo(0, size / 2); g.lineTo(size, size / 2);
      g.stroke();
      break;
    case 'bricks': {
      g.lineWidth = 3;
      const rows = 8;
      const rh = size / rows;
      for (let r = 0; r < rows; r++) {
        g.beginPath();
        g.moveTo(0, r * rh); g.lineTo(size, r * rh);
        g.stroke();
        const off = r % 2 === 0 ? 0 : size / 4;
        for (let x = off; x <= size; x += size / 2) {
          g.beginPath();
          g.moveTo(x, r * rh); g.lineTo(x, (r + 1) * rh);
          g.stroke();
        }
      }
      break;
    }
    case 'speckle':
      // Small darker grains and pits.
      for (let i = 0; i < 260; i++) {
        g.globalAlpha = rnd(0.15, 0.45);
        g.fillRect(rnd(0, size), rnd(0, size), rnd(1, 3), rnd(1, 3));
      }
      g.globalAlpha = 1;
      break;
    case 'concrete':
    case 'concretePanels':
      // Air pockets, plus faint rain streaks running down.
      for (let i = 0; i < 160; i++) {
        g.globalAlpha = rnd(0.2, 0.5);
        g.beginPath();
        g.arc(rnd(0, size), rnd(0, size), rnd(0.6, 1.8), 0, Math.PI * 2);
        g.fill();
      }
      for (let i = 0; i < 14; i++) {
        const x = rnd(0, size), len = rnd(40, 160), y = rnd(0, size);
        const grad = g.createLinearGradient(0, y, 0, y + len);
        grad.addColorStop(0, 'rgba(40,40,40,0.12)');
        grad.addColorStop(1, 'rgba(40,40,40,0)');
        g.globalAlpha = 1;
        g.fillStyle = grad;
        g.fillRect(x, y, rnd(2, 6), len);
        if (y + len > size) g.fillRect(x, y - size, rnd(2, 6), len);
      }
      g.globalAlpha = 1;
      if (style.pattern === 'concretePanels') {
        // 2 x 1 m panels (the texture covers 4 x 4 m) with seams and form-tie holes.
        g.fillStyle = style.line;
        for (let i = 0; i < 4; i++) g.fillRect(0, (i * size) / 4, size, 3);
        for (let i = 0; i < 2; i++) g.fillRect((i * size) / 2, 0, 3, size);
        g.fillStyle = 'rgba(30,30,30,0.6)';
        for (let px = 0; px < 2; px++) for (let py = 0; py < 4; py++) {
          for (const [fx, fy] of [[0.18, 0.25], [0.82, 0.25], [0.18, 0.75], [0.82, 0.75]]) {
            g.fillRect((px + fx) * (size / 2) - 2, (py + fy) * (size / 4) - 2, 4, 4);
          }
        }
      }
      break;
    case 'planks': {
      // Vertical boards with dark gaps and wood grain.
      const boards = 5;
      const bw = size / boards;
      for (let i = 0; i < boards; i++) {
        // Each board a slightly different shade of wood.
        g.fillStyle = Math.random() < 0.5 ? `rgba(60,30,5,${rnd(0.04, 0.14)})` : `rgba(255,225,170,${rnd(0.04, 0.12)})`;
        g.fillRect(i * bw, 0, bw, size);
        g.strokeStyle = style.line;
        g.globalAlpha = 0.35;
        g.lineWidth = 1;
        for (let k = 0; k < 6; k++) {
          const x = i * bw + rnd(4, bw - 4);
          g.beginPath();
          g.moveTo(x, 0);
          g.bezierCurveTo(x + rnd(-4, 4), size * 0.33, x + rnd(-4, 4), size * 0.66, x, size);
          g.stroke();
        }
        g.globalAlpha = 1;
        g.fillStyle = style.line;
        g.fillRect(i * bw, 0, 3, size);
        // Nail heads near the ends.
        g.fillStyle = '#3a3a3a';
        for (const y of [10, size - 12]) g.fillRect(i * bw + bw / 2 - 2, y, 4, 4);
      }
      break;
    }
    case 'grain':
      g.globalAlpha = 0.35;
      g.lineWidth = 1;
      for (let k = 0; k < 40; k++) {
        const y = rnd(0, size);
        g.beginPath();
        g.moveTo(0, y);
        g.bezierCurveTo(size * 0.33, y + rnd(-5, 5), size * 0.66, y + rnd(-5, 5), size, y);
        g.stroke();
      }
      g.globalAlpha = 1;
      break;
    case 'plates':
      g.lineWidth = 3;
      g.strokeRect(0, 0, size, size);
      for (const [x, y] of [[12, 12], [size - 12, 12], [12, size - 12], [size - 12, size - 12]]) {
        g.beginPath();
        g.arc(x, y, 4, 0, Math.PI * 2);
        g.fill();
      }
      break;
    case 'chipped':
      // Paint chipped off (grey concrete showing) and grime.
      g.fillStyle = style.line;
      for (let i = 0; i < 45; i++) {
        const x = rnd(0, size), y = rnd(0, size);
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 6; k++) g.lineTo(x + rnd(-9, 9), y + rnd(-6, 6));
        g.closePath();
        g.fill();
      }
      g.fillStyle = 'rgba(30,25,15,0.08)';
      for (let i = 0; i < 20; i++) g.fillRect(rnd(0, size), rnd(0, size), rnd(20, 60), rnd(4, 14));
      break;
    case 'plain':
      break;
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const textures = new Map<SurfaceId, THREE.Texture>();
const cache = new Map<string, THREE.Material>();

/**
 * Material for a map surface. 'standard' looks better (reflections, metal);
 * 'lambert' is a cheaper shader for the Low graphics setting. Both include
 * the baked lighting (corner shading + lamp light).
 */
export function getMaterial(id: SurfaceId, kind: 'standard' | 'lambert' = 'standard'): THREE.Material {
  const key = `${id}:${kind}`;
  let m = cache.get(key);
  if (!m) {
    const s = STYLES[id];
    let tex = textures.get(id);
    if (!tex) textures.set(id, (tex = makeTexture(s)));
    const mat =
      kind === 'lambert'
        ? new THREE.MeshLambertMaterial({ map: tex })
        : new THREE.MeshStandardMaterial({ map: tex, roughness: s.roughness, metalness: s.metalness });
    addBakedLighting(mat);
    cache.set(key, (m = mat));
  }
  return m;
}

/** How many meters one texture tile covers, for the given material. */
export function getTileSize(id: SurfaceId): number {
  return STYLES[id].tileSize;
}
