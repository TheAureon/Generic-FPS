import * as THREE from 'three';
import type { MaterialId } from '../map/MapTypes';

/**
 * Materials for map surfaces. Textures are drawn in code on a canvas.
 * To use real image textures later, replace `makeTexture` with
 * `new THREE.TextureLoader().load('/textures/xyz.png')` for that material.
 */

interface MaterialStyle {
  base: string;
  line: string;
  /** Texture tiles every N meters. */
  tileSize: number;
  pattern: 'grid' | 'bricks' | 'crate' | 'plates' | 'plain';
  roughness: number;
  metalness: number;
}

const STYLES: Record<MaterialId, MaterialStyle> = {
  floor: { base: '#5d636b', line: '#4b5057', tileSize: 2, pattern: 'grid', roughness: 0.9, metalness: 0 },
  wall: { base: '#a39b8e', line: '#8a8275', tileSize: 2, pattern: 'bricks', roughness: 0.95, metalness: 0 },
  concrete: { base: '#8c8f93', line: '#7b7e82', tileSize: 4, pattern: 'plates', roughness: 0.9, metalness: 0 },
  crate: { base: '#9a7446', line: '#6e4f2c', tileSize: 1.5, pattern: 'crate', roughness: 0.8, metalness: 0 },
  metal: { base: '#5f6e7a', line: '#4a5661', tileSize: 2, pattern: 'plates', roughness: 0.5, metalness: 0.4 },
  trim: { base: '#c9a23a', line: '#a9852a', tileSize: 1, pattern: 'plain', roughness: 0.6, metalness: 0.2 },
};

function makeTexture(style: MaterialStyle): THREE.Texture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = style.base;
  g.fillRect(0, 0, size, size);

  // Subtle noise so surfaces don't look perfectly flat.
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
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
    case 'crate':
      g.lineWidth = 14;
      g.strokeRect(7, 7, size - 14, size - 14);
      g.lineWidth = 10;
      g.beginPath();
      g.moveTo(10, 10); g.lineTo(size - 10, size - 10);
      g.stroke();
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
    case 'plain':
      break;
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const cache = new Map<MaterialId, THREE.MeshStandardMaterial>();

export function getMaterial(id: MaterialId): THREE.MeshStandardMaterial {
  let m = cache.get(id);
  if (!m) {
    const s = STYLES[id];
    m = new THREE.MeshStandardMaterial({
      map: makeTexture(s),
      roughness: s.roughness,
      metalness: s.metalness,
    });
    cache.set(id, m);
  }
  return m;
}

/** How many meters one texture tile covers, for the given material. */
export function getTileSize(id: MaterialId): number {
  return STYLES[id].tileSize;
}
