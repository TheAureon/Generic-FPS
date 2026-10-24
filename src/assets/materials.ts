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
export type SurfaceId = MaterialId | 'brick' | 'mortar' | 'panel' | 'seam' | 'concreteWall' | 'crateFrame' | 'tread' | 'steel'
  // Neutral (light) surfaces for models, colored by each part's tint:
  | 'fabric' | 'chrome' | 'plastic' | 'rubber' | 'corrugated'
  // Cut-out pictures on flat cards (leaf clusters, pine branches, grass tufts and flowers):
  | 'leafCard' | 'needleCard' | 'grassCard';

interface MaterialStyle {
  base: string;
  line: string;
  /** Texture tiles every N meters. */
  tileSize: number;
  pattern: 'forestFloor' | 'rock' | 'oldBlocks' | 'plaster' | 'bark' | 'logs' | 'marble' | 'blocks' | 'grass' | 'leaves' | 'water' | 'art' | 'tiles' | 'ceiling' | 'dirt' | 'ribs' | 'slabs' | 'bricks' | 'planks' | 'grain' | 'plates' | 'diamond' | 'concrete' | 'concretePanels' | 'speckle' | 'chipped' | 'plain';
  /** Texture resolution (pixels); bigger for textures covering a large area. */
  pixels?: number;
  roughness: number;
  metalness: number;
  /**
   * Surface relief from the texture's light and dark (bump mapping, Medium
   * and High graphics): 0 = smooth, ~1 = normal, 2+ = deep (rock, bark).
   */
  bump?: number;
}

/** Relief per material (anything not listed gets BUMP_DEFAULT). */
const BUMP: Partial<Record<SurfaceId, number>> = {
  glass: 0, paint: 0.15, carpaint: 0, gold: 0.2, marble: 0.35, tile: 0.6, ceiling: 0.6, drywall: 0.7, art: 0,
  rock: 2.6, bark: 3, ruin: 2.2, stone: 1.6, timber: 2.2, planks: 1.6, barnwood: 1.6, crate: 1.4, crateFrame: 1.2,
  brick: 1.4, mortar: 1.2, concrete: 1.2, panel: 1.1, concreteWall: 1.4, floor: 1.0, asphalt: 1.4, dirt: 1.8,
  forest: 1.6, grass: 1.3, hedge: 2.4, needles: 2.2, foliage: 2.2, hay: 2.4, canvas: 1.0, carpet: 1.4, velvet: 0.8,
  desk: 0.8, water: 1.6, snow: 0.8, tread: 1.6, container: 1.4, metal: 0.8, steel: 0.5, trim: 1.0, stairs: 1.0,
};
const BUMP_DEFAULT = 1.0;

const STYLES: Record<SurfaceId, MaterialStyle> = {
  leafCard: { base: '#5a7a34', line: '#3d5a22', tileSize: 1, pattern: 'plain', roughness: 0.9, metalness: 0, bump: 0 },
  needleCard: { base: '#34563a', line: '#203a26', tileSize: 1, pattern: 'plain', roughness: 0.95, metalness: 0, bump: 0 },
  grassCard: { base: '#5f8a3a', line: '#42662a', tileSize: 1, pattern: 'plain', roughness: 1, metalness: 0, bump: 0 },
  // Industrial concrete floor: 2 x 2 m slabs (the texture covers 8 x 8 m, each slab a bit different).
  floor: { base: '#686d72', line: '#3d4044', tileSize: 8, pattern: 'slabs', roughness: 0.85, metalness: 0, pixels: 1024 },
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
  // ---- Indoors ----
  carpet: { base: '#66707c', line: '#555e6a', tileSize: 2, pattern: 'speckle', roughness: 1, metalness: 0 },
  tile: { base: '#cfccc3', line: '#a9a69e', tileSize: 1.2, pattern: 'tiles', roughness: 0.35, metalness: 0 },
  // Painted plaster: warm off-white with a faint orange-peel texture.
  drywall: { base: '#e3ddd1', line: '#d2cbbd', tileSize: 1.5, pattern: 'plaster', roughness: 0.85, metalness: 0 },
  ceiling: { base: '#f2f1ed', line: '#d3d1ca', tileSize: 1.2, pattern: 'ceiling', roughness: 1, metalness: 0 },
  desk: { base: '#8a6a48', line: '#6b5136', tileSize: 1, pattern: 'grain', roughness: 0.55, metalness: 0 },
  partition: { base: '#5d6876', line: '#4f5965', tileSize: 1, pattern: 'speckle', roughness: 1, metalness: 0 },
  glass: { base: '#a9c8d8', line: '#a9c8d8', tileSize: 1, pattern: 'plain', roughness: 0.05, metalness: 0.1 },
  stairs: { base: '#b9b6ad', line: '#8f8c84', tileSize: 1, pattern: 'speckle', roughness: 0.7, metalness: 0 },
  // ---- Town ----
  asphalt: { base: '#45474b', line: '#36383b', tileSize: 4, pattern: 'speckle', roughness: 0.95, metalness: 0, pixels: 512 },
  paint: { base: '#ece9df', line: '#ece9df', tileSize: 1, pattern: 'plain', roughness: 0.8, metalness: 0 },
  // Car paint: light, so each car's tint gives its color.
  carpaint: { base: '#e4e6e8', line: '#c8ccd0', tileSize: 1, pattern: 'plain', roughness: 0.28, metalness: 0.5 },
  // ---- Museum and gardens ----
  marble: { base: '#e3e0d8', line: '#a8a39a', tileSize: 2.4, pattern: 'marble', roughness: 0.18, metalness: 0, pixels: 512 },
  stone: { base: '#cbbd9f', line: '#a99b7e', tileSize: 3, pattern: 'blocks', roughness: 0.85, metalness: 0, pixels: 512 },
  grass: { base: '#5d7a3a', line: '#45602a', tileSize: 4, pattern: 'grass', roughness: 1, metalness: 0, pixels: 512 },
  hedge: { base: '#3f5a2a', line: '#2c421c', tileSize: 1.5, pattern: 'leaves', roughness: 1, metalness: 0 },
  water: { base: '#3d6f80', line: '#a9d3df', tileSize: 3, pattern: 'water', roughness: 0.05, metalness: 0.3 },
  art: { base: '#d8cfb8', line: '#2b2b2b', tileSize: 6.4, pattern: 'art', roughness: 0.7, metalness: 0, pixels: 1024 },
  gold: { base: '#b8903a', line: '#8c6b26', tileSize: 1, pattern: 'plain', roughness: 0.3, metalness: 0.85 },
  velvet: { base: '#7a1f27', line: '#5c151c', tileSize: 1, pattern: 'speckle', roughness: 1, metalness: 0 },
  // ---- Forest and mountains ----
  // Forest floor: grass, moss, fallen needles and leaves.
  forest: { base: '#566b36', line: '#3e4f26', tileSize: 6, pattern: 'forestFloor', roughness: 1, metalness: 0, pixels: 512 },
  rock: { base: '#7d7b74', line: '#4f4d48', tileSize: 4, pattern: 'rock', roughness: 0.92, metalness: 0, pixels: 512 },
  bark: { base: '#5a4433', line: '#2f231a', tileSize: 1.5, pattern: 'bark', roughness: 1, metalness: 0 },
  needles: { base: '#38593b', line: '#253f29', tileSize: 2, pattern: 'leaves', roughness: 1, metalness: 0 },
  foliage: { base: '#4c6d2c', line: '#34501c', tileSize: 2, pattern: 'leaves', roughness: 1, metalness: 0 },
  // Log cabin walls: stacked round logs.
  timber: { base: '#8a6440', line: '#4a331d', tileSize: 1.2, pattern: 'logs', roughness: 0.9, metalness: 0 },
  canvas: { base: '#a88a5c', line: '#86704a', tileSize: 1, pattern: 'speckle', roughness: 1, metalness: 0 },
  snow: { base: '#e8edf2', line: '#c4cfdb', tileSize: 5, pattern: 'speckle', roughness: 0.6, metalness: 0, pixels: 256 },
  // Wooden boards (decks, platforms, sheds) and red-painted barn boards.
  planks: { base: '#8d6a45', line: '#4f3a24', tileSize: 1.5, pattern: 'planks', roughness: 0.85, metalness: 0 },
  barnwood: { base: '#8a3528', line: '#4f1d16', tileSize: 1.5, pattern: 'planks', roughness: 0.85, metalness: 0 },
  // ---- Model surfaces (light, so a tint gives the color) ----
  fabric: { base: '#d6d6d6', line: '#b8b8b8', tileSize: 0.5, pattern: 'speckle', roughness: 1, metalness: 0, bump: 0.8 },
  chrome: { base: '#d4d8dc', line: '#b0b6bc', tileSize: 1, pattern: 'plain', roughness: 0.25, metalness: 0.75, bump: 0 },
  plastic: { base: '#d0d0d0', line: '#c0c0c0', tileSize: 1, pattern: 'plain', roughness: 0.5, metalness: 0, bump: 0 },
  rubber: { base: '#3a3a3a', line: '#303030', tileSize: 1, pattern: 'speckle', roughness: 0.9, metalness: 0, bump: 0.4 },
  corrugated: { base: '#c9ced3', line: '#9aa1a8', tileSize: 1, pattern: 'ribs', roughness: 0.6, metalness: 0.15, bump: 1.6 },
  // Hay bales: dry yellow straw.
  hay: { base: '#c9a95a', line: '#a3843e', tileSize: 1, pattern: 'grain', roughness: 1, metalness: 0 },
  // Old weathered stone blocks with moss.
  ruin: { base: '#8f8a7c', line: '#5d594f', tileSize: 3, pattern: 'oldBlocks', roughness: 0.95, metalness: 0, pixels: 512 },
  // Outdoor ground: packed dirt and gravel.
  dirt: { base: '#857a66', line: '#5e5546', tileSize: 6, pattern: 'dirt', roughness: 1, metalness: 0, pixels: 512 },
  // Shipping containers: corrugated, painted steel.
  container: { base: '#8a3b2c', line: '#5e271d', tileSize: 1, pattern: 'ribs', roughness: 0.6, metalness: 0.3 },
  metal: { base: '#66737e', line: '#48535d', tileSize: 2, pattern: 'plates', roughness: 0.55, metalness: 0.25 },
  // Diamond-plate steel on top of ramps and metal floors.
  tread: { base: '#6f777e', line: '#4c5359', tileSize: 1, pattern: 'diamond', roughness: 0.42, metalness: 0.6, pixels: 256 },
  // Painted steel for ramp rails, beams and posts.
  steel: { base: '#3f474e', line: '#30363b', tileSize: 1, pattern: 'speckle', roughness: 0.55, metalness: 0.5 },
  // Jersey barriers: yellow paint over concrete, chipped and dirty.
  trim: { base: '#c9a23a', line: '#8a8378', tileSize: 1, pattern: 'chipped', roughness: 0.6, metalness: 0, bump: 0.25 },
};

function makeTexture(style: MaterialStyle): THREE.Texture {
  const size = style.pixels ?? 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  // Drawn on the CPU (we read the pixels back to add noise, which is slow on the GPU).
  const g = c.getContext('2d', { willReadFrequently: true })!;
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

  const concrete = style.pattern === 'concrete' || style.pattern === 'concretePanels' || style.pattern === 'slabs';
  if (concrete || style.pattern === 'chipped') blotches(40, 0.06);
  // Painted steel: weathered in patches.
  if (style.pattern === 'plates') blotches(36, 0.07);

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
    case 'marble': {
      // Polished marble slabs (1.2 m) with soft grey veins.
      g.strokeStyle = 'rgba(110,105,98,0.35)';
      for (let k = 0; k < 14; k++) {
        g.lineWidth = rnd(0.6, 2.4);
        g.beginPath();
        let x = rnd(0, size), y = rnd(0, size);
        g.moveTo(x, y);
        for (let i = 0; i < 8; i++) {
          x += rnd(-size * 0.12, size * 0.12);
          y += rnd(size * 0.02, size * 0.1);
          g.lineTo(x, y);
        }
        g.stroke();
      }
      g.fillStyle = style.line;
      g.globalAlpha = 0.5;
      g.fillRect(0, 0, size, 2);
      g.fillRect(0, size / 2, size, 2);
      g.fillRect(0, 0, 2, size);
      g.fillRect(size / 2, 0, 2, size);
      g.globalAlpha = 1;
      break;
    }
    case 'oldBlocks':
    case 'blocks': {
      // Sandstone blocks in courses (0.6 m tall, 1.5 m long), each a bit different.
      const rows = 5, rh = size / rows;
      for (let r = 0; r < rows; r++) {
        const off = r % 2 ? size / 4 : 0;
        for (let x = -size / 2 + off; x < size; x += size / 2) {
          g.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${rnd(0.02, 0.08)})` : `rgba(255,250,235,${rnd(0.03, 0.08)})`;
          g.fillRect(x, r * rh, size / 2, rh);
        }
        g.fillStyle = style.line;
        g.fillRect(0, r * rh, size, 3);
        for (let x = off; x <= size; x += size / 2) g.fillRect(x, r * rh, 3, rh);
      }
      if (style.pattern === 'oldBlocks') {
        // Moss in the joints and spreading up from the bottom, a few dark stains.
        for (let i = 0; i < 1400; i++) {
          const y = size * (1 - Math.pow(Math.random(), 1.8));
          g.fillStyle = `rgba(${Math.floor(rnd(60, 95))},${Math.floor(rnd(85, 115))},${Math.floor(rnd(35, 55))},${rnd(0.12, 0.35)})`;
          g.beginPath();
          g.ellipse(rnd(0, size), y, rnd(1, 4), rnd(0.8, 2.5), rnd(0, 3), 0, Math.PI * 2);
          g.fill();
        }
        g.strokeStyle = 'rgba(30,28,24,0.18)';
        for (let i = 0; i < 12; i++) {
          // Streaks running down from the tops of blocks.
          const x = rnd(0, size), y = rnd(0, size);
          g.lineWidth = rnd(2, 6);
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + rnd(-3, 3), y + rnd(15, 45));
          g.stroke();
        }
      }
      break;
    }
    case 'grass': {
      // Lots of short blades in several greens, with lighter and darker patches.
      for (let i = 0; i < 18; i++) {
        const x = rnd(0, size), y = rnd(0, size), r = rnd(size * 0.06, size * 0.2);
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, Math.random() < 0.5 ? 'rgba(30,45,10,0.18)' : 'rgba(170,190,90,0.14)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      for (let i = 0; i < 5000; i++) {
        const x = rnd(0, size), y = rnd(0, size);
        g.strokeStyle = `rgba(${Math.floor(rnd(40, 120))},${Math.floor(rnd(90, 160))},${Math.floor(rnd(20, 60))},${rnd(0.3, 0.7)})`;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + rnd(-2, 2), y - rnd(3, 7));
        g.stroke();
      }
      break;
    }
    case 'leaves': {
      // Dense small leaves: dark and light green blobs.
      for (let i = 0; i < 900; i++) {
        g.fillStyle = `rgba(${Math.floor(rnd(30, 90))},${Math.floor(rnd(60, 120))},${Math.floor(rnd(20, 50))},${rnd(0.4, 0.9)})`;
        g.beginPath();
        g.ellipse(rnd(0, size), rnd(0, size), rnd(2, 6), rnd(1.5, 4), rnd(0, 3), 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'water': {
      // Ripples: soft light curves on a deep blue-green.
      g.strokeStyle = 'rgba(200,235,245,0.25)';
      for (let i = 0; i < 40; i++) {
        g.lineWidth = rnd(1, 2.5);
        g.beginPath();
        const x = rnd(0, size), y = rnd(0, size), w = rnd(20, 70);
        g.moveTo(x, y);
        g.quadraticCurveTo(x + w / 2, y - rnd(3, 8), x + w, y);
        g.stroke();
      }
      break;
    }
    case 'art': {
      // A 4 x 4 grid of different little paintings (each painting on a wall
      // shows a different part): landscapes, abstract shapes, portraits.
      const n = 4, s = size / n;
      const palette = ['#c0392b', '#2e86ab', '#f2c14e', '#3b7d4f', '#8e5ea2', '#e07a3f', '#1d3557', '#a8dadc', '#6d4c41', '#f4a261'];
      const pick = () => palette[Math.floor(Math.random() * palette.length)];
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const x = i * s, y = j * s;
        g.save();
        g.beginPath();
        g.rect(x, y, s, s);
        g.clip();
        const kind = (i + j * 3) % 3;
        if (kind === 0) {
          // Landscape: sky, sun, hills.
          const sky = g.createLinearGradient(0, y, 0, y + s);
          sky.addColorStop(0, pick());
          sky.addColorStop(1, '#f6e7c1');
          g.fillStyle = sky;
          g.fillRect(x, y, s, s);
          g.fillStyle = '#fff3c4';
          g.beginPath();
          g.arc(x + rnd(s * 0.2, s * 0.8), y + s * 0.3, s * 0.08, 0, Math.PI * 2);
          g.fill();
          for (let h = 0; h < 3; h++) {
            g.fillStyle = pick();
            g.beginPath();
            g.moveTo(x, y + s);
            for (let k = 0; k <= 6; k++) g.lineTo(x + (k / 6) * s, y + s * (0.55 + h * 0.12) + rnd(-s * 0.08, s * 0.08));
            g.lineTo(x + s, y + s);
            g.fill();
          }
        } else if (kind === 1) {
          // Abstract: blocks and circles of color.
          g.fillStyle = pick();
          g.fillRect(x, y, s, s);
          for (let k = 0; k < 7; k++) {
            g.fillStyle = pick();
            if (Math.random() < 0.5) g.fillRect(x + rnd(0, s * 0.7), y + rnd(0, s * 0.7), rnd(s * 0.15, s * 0.5), rnd(s * 0.15, s * 0.5));
            else {
              g.beginPath();
              g.arc(x + rnd(0, s), y + rnd(0, s), rnd(s * 0.06, s * 0.25), 0, Math.PI * 2);
              g.fill();
            }
          }
        } else {
          // Portrait: dark background, a figure.
          g.fillStyle = '#2d2620';
          g.fillRect(x, y, s, s);
          g.fillStyle = pick();
          g.beginPath();
          g.ellipse(x + s / 2, y + s * 0.95, s * 0.32, s * 0.4, 0, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = '#d9b48f';
          g.beginPath();
          g.ellipse(x + s / 2, y + s * 0.42, s * 0.14, s * 0.18, 0, 0, Math.PI * 2);
          g.fill();
        }
        g.restore();
        g.strokeStyle = style.line;
        g.lineWidth = 4;
        g.strokeRect(x + 2, y + 2, s - 4, s - 4);
      }
      break;
    }
    case 'tiles': {
      // 2 x 2 floor tiles per texture with grout lines; each tile a slightly different shade.
      const n = 2, s = size / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        g.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${rnd(0.02, 0.06)})` : `rgba(255,255,255,${rnd(0.02, 0.06)})`;
        g.fillRect(i * s, j * s, s, s);
      }
      g.fillStyle = style.line;
      for (let i = 0; i < n; i++) {
        g.fillRect(i * s, 0, 3, size);
        g.fillRect(0, i * s, size, 3);
      }
      break;
    }
    case 'ceiling': {
      // Acoustic ceiling tiles: a light grid with tiny pores.
      g.fillStyle = 'rgba(0,0,0,0.12)';
      for (let i = 0; i < 700; i++) g.fillRect(rnd(0, size), rnd(0, size), 1.5, 1.5);
      g.fillStyle = style.line;
      for (let i = 0; i < 2; i++) {
        g.fillRect((i * size) / 2, 0, 4, size);
        g.fillRect(0, (i * size) / 2, size, 4);
      }
      break;
    }
    case 'plaster': {
      // Faint blotches and fine bumps (orange peel), as on painted walls.
      for (let i = 0; i < 30; i++) {
        const x = rnd(0, size), y = rnd(0, size), r = rnd(size * 0.05, size * 0.2);
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, Math.random() < 0.5 ? 'rgba(0,0,0,0.016)' : 'rgba(255,255,255,0.022)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      for (let i = 0; i < 2500; i++) {
        g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)';
        g.beginPath();
        g.arc(rnd(0, size), rnd(0, size), rnd(0.6, 1.6), 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'forestFloor': {
      // Patches of brown litter and lighter moss, then grass blades, needles, leaves and twigs.
      for (let i = 0; i < 30; i++) {
        const x = rnd(0, size), y = rnd(0, size), r = rnd(size * 0.05, size * 0.18);
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, Math.random() < 0.55 ? 'rgba(95,70,40,0.32)' : 'rgba(150,170,80,0.18)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      for (let i = 0; i < 2600; i++) {
        const x = rnd(0, size), y = rnd(0, size);
        g.strokeStyle = `rgba(${Math.floor(rnd(50, 110))},${Math.floor(rnd(85, 140))},${Math.floor(rnd(25, 55))},${rnd(0.3, 0.6)})`;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + rnd(-2, 2), y - rnd(2, 6));
        g.stroke();
      }
      for (let i = 0; i < 700; i++) {
        // Fallen pine needles.
        const x = rnd(0, size), y = rnd(0, size), a = rnd(0, Math.PI), l = rnd(2, 5);
        g.strokeStyle = `rgba(${Math.floor(rnd(110, 150))},${Math.floor(rnd(80, 105))},${Math.floor(rnd(45, 65))},${rnd(0.4, 0.8)})`;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
        g.stroke();
      }
      for (let i = 0; i < 140; i++) {
        // Dead leaves.
        g.fillStyle = `rgba(${Math.floor(rnd(120, 170))},${Math.floor(rnd(80, 115))},${Math.floor(rnd(30, 50))},${rnd(0.5, 0.85)})`;
        g.beginPath();
        g.ellipse(rnd(0, size), rnd(0, size), rnd(2, 4), rnd(1, 2.2), rnd(0, 3), 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = 'rgba(60,45,30,0.6)';
      g.lineWidth = 1.5;
      for (let i = 0; i < 25; i++) {
        // Twigs.
        const x = rnd(0, size), y = rnd(0, size), a = rnd(0, Math.PI);
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(a) * rnd(6, 16), y + Math.sin(a) * rnd(6, 16));
        g.stroke();
      }
      break;
    }
    case 'rock': {
      // Light and dark patches, cracks, a few spots of lichen.
      for (let i = 0; i < 40; i++) {
        const x = rnd(0, size), y = rnd(0, size), r = rnd(size * 0.04, size * 0.16);
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, Math.random() < 0.5 ? 'rgba(40,38,34,0.22)' : 'rgba(210,205,195,0.16)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      g.strokeStyle = 'rgba(40,38,34,0.55)';
      for (let k = 0; k < 18; k++) {
        g.lineWidth = rnd(0.8, 2);
        g.beginPath();
        let x = rnd(0, size), y = rnd(0, size);
        g.moveTo(x, y);
        for (let i = 0; i < 5; i++) {
          x += rnd(-size * 0.08, size * 0.08);
          y += rnd(-size * 0.08, size * 0.08);
          g.lineTo(x, y);
        }
        g.stroke();
      }
      for (let i = 0; i < 60; i++) {
        g.fillStyle = Math.random() < 0.5 ? `rgba(150,160,90,${rnd(0.25, 0.5)})` : `rgba(190,185,150,${rnd(0.2, 0.4)})`;
        g.beginPath();
        g.ellipse(rnd(0, size), rnd(0, size), rnd(2, 7), rnd(2, 5), rnd(0, 3), 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'bark': {
      // Deep vertical furrows.
      for (let k = 0; k < 22; k++) {
        const x = rnd(0, size);
        g.strokeStyle = Math.random() < 0.7 ? `rgba(25,18,12,${rnd(0.4, 0.8)})` : `rgba(150,125,100,${rnd(0.2, 0.4)})`;
        g.lineWidth = rnd(1.5, 5);
        g.beginPath();
        g.moveTo(x, 0);
        g.bezierCurveTo(x + rnd(-10, 10), size * 0.33, x + rnd(-10, 10), size * 0.66, x, size);
        g.stroke();
      }
      break;
    }
    case 'logs': {
      // Four round logs stacked: shaded like cylinders, dark gaps between, grain along them.
      const n = 4, lh = size / n;
      for (let r = 0; r < n; r++) {
        const grad = g.createLinearGradient(0, r * lh, 0, (r + 1) * lh);
        grad.addColorStop(0, 'rgba(0,0,0,0.35)');
        grad.addColorStop(0.3, 'rgba(255,230,190,0.12)');
        grad.addColorStop(0.75, 'rgba(0,0,0,0.05)');
        grad.addColorStop(1, 'rgba(0,0,0,0.45)');
        g.fillStyle = grad;
        g.fillRect(0, r * lh, size, lh);
        g.strokeStyle = 'rgba(60,40,20,0.35)';
        g.lineWidth = 1;
        for (let k = 0; k < 6; k++) {
          const y = r * lh + rnd(4, lh - 4);
          g.beginPath();
          g.moveTo(0, y);
          g.bezierCurveTo(size * 0.33, y + rnd(-3, 3), size * 0.66, y + rnd(-3, 3), size, y);
          g.stroke();
        }
        g.fillStyle = style.line;
        g.fillRect(0, r * lh, size, 3);
      }
      break;
    }
    case 'dirt': {
      // Pebbles (light and dark), patches of darker earth, a few tire ruts.
      for (let i = 0; i < 26; i++) {
        const x = rnd(0, size), y = rnd(0, size), r = rnd(size * 0.04, size * 0.14);
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, Math.random() < 0.5 ? 'rgba(60,48,32,0.18)' : 'rgba(200,190,170,0.12)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      for (let i = 0; i < 900; i++) {
        const r = rnd(0.6, 2.4);
        g.fillStyle = Math.random() < 0.5 ? `rgba(40,34,26,${rnd(0.25, 0.6)})` : `rgba(220,212,195,${rnd(0.2, 0.5)})`;
        g.beginPath();
        g.ellipse(rnd(0, size), rnd(0, size), r, r * rnd(0.6, 1), rnd(0, 3), 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = 'rgba(50,42,30,0.12)';
      g.lineWidth = size * 0.035;
      for (const x of [rnd(0, size), rnd(0, size)]) {
        g.beginPath();
        g.moveTo(x, 0);
        g.bezierCurveTo(x + rnd(-40, 40), size * 0.33, x + rnd(-40, 40), size * 0.66, x, size);
        g.stroke();
      }
      break;
    }
    case 'ribs': {
      // Vertical corrugation: alternating light and dark stripes, with rust streaks.
      const n = 8, w = size / n;
      for (let i = 0; i < n; i++) {
        const grad = g.createLinearGradient(i * w, 0, (i + 1) * w, 0);
        grad.addColorStop(0, 'rgba(0,0,0,0.28)');
        grad.addColorStop(0.35, 'rgba(255,255,255,0.12)');
        grad.addColorStop(0.65, 'rgba(255,255,255,0.05)');
        grad.addColorStop(1, 'rgba(0,0,0,0.28)');
        g.fillStyle = grad;
        g.fillRect(i * w, 0, w, size);
      }
      for (let i = 0; i < 10; i++) {
        g.fillStyle = `rgba(90,45,20,${rnd(0.1, 0.25)})`;
        g.fillRect(rnd(0, size), rnd(0, size * 0.5), rnd(2, 5), rnd(30, 120));
      }
      break;
    }
    case 'slabs': {
      // 4 x 4 slabs, each a slightly different shade, some with stains or cracks.
      const n = 4, s = size / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const x = i * s, y = j * s;
        g.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${rnd(0.02, 0.09)})` : `rgba(255,255,255,${rnd(0.02, 0.06)})`;
        g.fillRect(x, y, s, s);
        // Trowel swirls: faint arcs.
        g.strokeStyle = 'rgba(255,255,255,0.025)';
        g.lineWidth = 6;
        for (let k = 0; k < 3; k++) {
          g.beginPath();
          g.arc(x + rnd(0, s), y + rnd(0, s), rnd(s * 0.2, s * 0.5), rnd(0, 6), rnd(0, 6) + 1.2);
          g.stroke();
        }
        // Oil/water stains.
        if (Math.random() < 0.45) {
          const cx = x + rnd(s * 0.2, s * 0.8), cy = y + rnd(s * 0.2, s * 0.8), r = rnd(s * 0.08, s * 0.25);
          const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
          grad.addColorStop(0, `rgba(20,18,15,${rnd(0.12, 0.25)})`);
          grad.addColorStop(1, 'rgba(20,18,15,0)');
          g.fillStyle = grad;
          g.beginPath();
          g.ellipse(cx, cy, r, r * rnd(0.5, 1), rnd(0, 3), 0, Math.PI * 2);
          g.fill();
        }
        // Hairline cracks.
        if (Math.random() < 0.3) {
          g.strokeStyle = 'rgba(25,25,25,0.45)';
          g.lineWidth = 1.2;
          g.beginPath();
          let px = x + rnd(0, s), py = y + (Math.random() < 0.5 ? 2 : s - 2);
          g.moveTo(px, py);
          for (let k = 0; k < 7; k++) {
            px += rnd(-s * 0.08, s * 0.08);
            py += (py < y + s / 2 ? 1 : -1) * rnd(s * 0.03, s * 0.09);
            g.lineTo(px, py);
          }
          g.stroke();
        }
      }
      // Saw-cut joints between slabs: a dark groove with a light edge.
      for (let i = 0; i < n; i++) {
        g.fillStyle = style.line;
        g.fillRect(i * s, 0, 3, size);
        g.fillRect(0, i * s, size, 3);
        g.fillStyle = 'rgba(255,255,255,0.12)';
        g.fillRect(i * s + 3, 0, 1, size);
        g.fillRect(0, i * s + 3, size, 1);
      }
      break;
    }
    case 'diamond': {
      // Raised diamond-plate lugs in a herringbone pattern, with light and shadow edges.
      const n = 8, s = size / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const cx = (i + 0.5) * s, cy = (j + 0.5) * s;
        const angle = (i + j) % 2 === 0 ? Math.PI / 4 : -Math.PI / 4;
        for (const [dx, dy, color] of [[1.2, 1.2, 'rgba(0,0,0,0.45)'], [-0.8, -0.8, 'rgba(255,255,255,0.45)'], [0, 0, style.base]] as const) {
          g.save();
          g.translate(cx + dx, cy + dy);
          g.rotate(angle);
          g.fillStyle = color;
          g.beginPath();
          g.ellipse(0, 0, s * 0.36, s * 0.09, 0, 0, Math.PI * 2);
          g.fill();
          g.restore();
        }
      }
      // Scuffs where boots wear the plate shiny.
      g.fillStyle = 'rgba(255,255,255,0.05)';
      for (let i = 0; i < 12; i++) g.fillRect(rnd(0, size), rnd(0, size), rnd(10, 40), rnd(3, 8));
      break;
    }
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

/**
 * Cut-out pictures (transparent around the shape) for leaves, pine branches
 * and grass: drawn once, then shown on flat cards.
 */
const CARDS = new Set<SurfaceId>(['leafCard', 'needleCard', 'grassCard']);

function makeCardTexture(id: SurfaceId): THREE.Texture {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const green = (h0: number, h1: number, l0: number, l1: number) => `hsl(${rnd(h0, h1)},${rnd(38, 58)}%,${rnd(l0, l1)}%)`;
  // A pointed leaf shape at (x, y), pointing along angle a.
  const leaf = (x: number, y: number, len: number, wid: number, a: number, color: string) => {
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(len * 0.45, -wid, len, 0);
    g.quadraticCurveTo(len * 0.45, wid, 0, 0);
    g.fill();
    // Midrib, a little lighter.
    g.strokeStyle = 'rgba(220,240,180,0.25)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(len * 0.9, 0);
    g.stroke();
    g.restore();
  };
  if (id === 'leafCard') {
    // A cluster of leaves on a few twigs, roughly round, with ragged edges.
    const cx = size / 2, cy = size / 2;
    g.strokeStyle = '#4a3a28';
    g.lineCap = 'round';
    const tips: [number, number][] = [];
    for (let k = 0; k < 7; k++) {
      const a = rnd(-Math.PI * 0.95, -Math.PI * 0.05), r = rnd(size * 0.25, size * 0.42);
      const tx = cx + Math.cos(a) * r, ty = cy + 40 + Math.sin(a) * r;
      g.lineWidth = rnd(3, 6);
      g.beginPath();
      g.moveTo(cx, size * 0.98);
      g.quadraticCurveTo(cx + rnd(-40, 40), cy + 60, tx, ty);
      g.stroke();
      tips.push([tx, ty]);
    }
    for (let i = 0; i < 420; i++) {
      // Leaves crowd toward the middle and thin out at the edge.
      const a = rnd(0, Math.PI * 2), r = Math.pow(Math.random(), 0.7) * size * 0.43;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.92;
      const out = r / (size * 0.43);
      leaf(x, y, rnd(26, 42), rnd(8, 13), a + rnd(-0.9, 0.9), green(78, 108, 20 + out * 8, 34 + out * 12));
    }
  } else if (id === 'needleCard') {
    // A drooping pine branch: a stem across the card, tufts of needles along it.
    g.lineCap = 'round';
    for (let b = 0; b < 3; b++) {
      const y0 = size * (0.3 + b * 0.2) + rnd(-20, 20);
      g.strokeStyle = '#3e3022';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(4, y0);
      g.quadraticCurveTo(size * 0.5, y0 + rnd(10, 30), size - 10, y0 + rnd(30, 60));
      g.stroke();
      for (let i = 0; i < 300; i++) {
        const t = Math.random(), x = 4 + t * (size - 14);
        const y = y0 + t * t * 45 + rnd(-3, 3);
        const len = (1 - t * 0.6) * rnd(30, 70), a = (Math.random() < 0.5 ? -1 : 1) * rnd(0.5, 1.4) + 0.3;
        g.strokeStyle = green(110, 140, 16, 30);
        g.lineWidth = rnd(1.5, 3);
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len);
        g.stroke();
      }
    }
  } else {
    // 2 x 2 pictures: two kinds of grass tuft, and two of grass with flowers.
    const half = size / 2;
    const flowers = [null, null, ['#f4d63a', '#f8e88a'], ['#f4f2ea', '#c9a8e8']];
    for (let cell = 0; cell < 4; cell++) {
      const ox = (cell % 2) * half, oy = Math.floor(cell / 2) * half;
      g.save();
      g.beginPath();
      g.rect(ox + 2, oy + 2, half - 4, half - 4);
      g.clip();
      const blades = cell < 2 ? 70 : 45;
      const tops: [number, number][] = [];
      for (let i = 0; i < blades; i++) {
        const bx = ox + half * 0.5 + rnd(-half * 0.3, half * 0.3), by = oy + half - 3;
        const h = rnd(half * 0.45, half * 0.95) * (cell === 1 ? 0.75 : 1), lean = rnd(-half * 0.28, half * 0.28);
        const w = rnd(3, 6);
        g.fillStyle = green(70, 105, 22, 42);
        g.beginPath();
        g.moveTo(bx - w, by);
        g.quadraticCurveTo(bx + lean * 0.3, by - h * 0.6, bx + lean, by - h);
        g.quadraticCurveTo(bx + lean * 0.3 + w * 0.3, by - h * 0.6, bx + w, by);
        g.fill();
        tops.push([bx + lean, by - h]);
      }
      const f = flowers[cell];
      if (f) {
        for (let i = 0; i < 9; i++) {
          const [x, y] = tops[Math.floor(rnd(0, tops.length))];
          g.fillStyle = f[i % 2];
          for (let k = 0; k < 5; k++) {
            const a = (k / 5) * Math.PI * 2;
            g.beginPath();
            g.ellipse(x + Math.cos(a) * 5, y + Math.sin(a) * 5, 5, 3, a, 0, Math.PI * 2);
            g.fill();
          }
          g.fillStyle = '#d89a2a';
          g.beginPath();
          g.arc(x, y, 3, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.restore();
    }
  }
  const tex = new THREE.CanvasTexture(c);
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
    if (!tex) textures.set(id, (tex = CARDS.has(id) ? makeCardTexture(id) : makeTexture(s)));
    if (CARDS.has(id)) {
      // Cut-out cards: see-through around the shape, visible from both sides,
      // and lit as if part of a rounded crown (no flipping for the back side).
      const card =
        kind === 'lambert'
          ? new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.45, side: THREE.DoubleSide })
          : new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: s.roughness, metalness: 0 });
      addBakedLighting(card, true);
      cache.set(key, (m = card));
      return m;
    }
    if (id === 'glass') {
      // See-through glass: no texture, faint tint, shiny.
      const glass =
        kind === 'lambert'
          ? new THREE.MeshLambertMaterial({ color: s.base, transparent: true, opacity: 0.22, depthWrite: false })
          : new THREE.MeshStandardMaterial({ color: s.base, transparent: true, opacity: 0.2, roughness: s.roughness, metalness: s.metalness, depthWrite: false });
      addBakedLighting(glass);
      cache.set(key, (m = glass));
      return m;
    }
    const bump = s.bump ?? BUMP[id] ?? BUMP_DEFAULT;
    let mat: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;
    if (kind === 'lambert') mat = new THREE.MeshLambertMaterial({ map: tex });
    else {
      mat = new THREE.MeshStandardMaterial({ map: tex, roughness: s.roughness, metalness: s.metalness });
      if (bump > 0) {
        mat.bumpMap = tex;
        mat.bumpScale = bump;
      }
    }
    if (id === 'water') {
      // Slightly see-through, glossy, gently moving.
      mat.transparent = true;
      mat.opacity = kind === 'lambert' ? 0.85 : 0.8;
      if (mat instanceof THREE.MeshStandardMaterial) {
        mat.roughness = 0.1;
        mat.metalness = 0.15;
      }
    }
    addBakedLighting(mat);
    cache.set(key, (m = mat));
  }
  return m;
}

/** Moving textures (water ripples drift). Call once per frame with the time in seconds. */
export function animateMaterials(t: number): void {
  const water = textures.get('water');
  if (water) water.offset.set(t * 0.018, t * 0.011);
}

/** How many meters one texture tile covers, for the given material. */
export function getTileSize(id: SurfaceId): number {
  return STYLES[id].tileSize;
}
