import * as THREE from 'three';
import type { Camo } from '../core/Cosmetics';

/**
 * Camo patterns, drawn in code: blotchy woodland/desert/arctic, digital
 * pixels, tiger stripes, carbon fiber weave, glowing neon lines, faceted
 * gems and royal gold filigree. Each is a small tiling picture.
 */

const cache = new Map<string, { map: THREE.Texture | null; glow: THREE.Texture | null; swatch: string }>();

/** The picture for a camo (and a glow picture for the ones that light up). Cached. */
export function camoTextures(c: Camo): { map: THREE.Texture | null; glow: THREE.Texture | null; swatch: string } {
  let t = cache.get(c.id);
  if (!t) cache.set(c.id, (t = draw(c)));
  return t;
}

function draw(c: Camo): { map: THREE.Texture | null; glow: THREE.Texture | null; swatch: string } {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const g = canvas.getContext('2d')!;
  g.fillStyle = c.color;
  g.fillRect(0, 0, S, S);
  let glowCanvas: HTMLCanvasElement | null = null;
  const cols = c.colors ?? [];
  const rnd = seeded(c.id);
  // Draw a shape at x and x±S (and y±S) so the picture tiles without seams.
  const wrap = (f: (dx: number, dy: number) => void) => {
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) f(dx, dy);
  };
  switch (c.pattern) {
    case 'blobs': {
      for (let i = 0; i < 55; i++) {
        const x = rnd() * S, y = rnd() * S, r = 10 + rnd() * 30;
        g.fillStyle = cols[i % cols.length];
        const pts = Array.from({ length: 9 }, (_, k) => {
          const a = (k / 9) * Math.PI * 2, rr = r * (0.55 + rnd() * 0.7);
          return [Math.cos(a) * rr * 1.4, Math.sin(a) * rr];
        });
        wrap((dx, dy) => {
          g.beginPath();
          pts.forEach(([px, py], k) => (k ? g.lineTo(x + px + dx, y + py + dy) : g.moveTo(x + px + dx, y + py + dy)));
          g.closePath();
          g.fill();
        });
      }
      break;
    }
    case 'digital': {
      const P = 8;
      for (let i = 0; i < 260; i++) {
        // Clusters of pixels.
        const x = Math.floor(rnd() * (S / P)), y = Math.floor(rnd() * (S / P));
        g.fillStyle = cols[i % cols.length];
        for (let k = 0; k < 4; k++) g.fillRect(((x + Math.floor(rnd() * 3)) % (S / P)) * P, ((y + Math.floor(rnd() * 3)) % (S / P)) * P, P, P);
      }
      break;
    }
    case 'tiger': {
      g.fillStyle = cols[0];
      for (let i = 0; i < 16; i++) {
        const y = (i / 16) * S + rnd() * 8, w = 4 + rnd() * 9;
        wrap((dx, dy) => {
          g.beginPath();
          g.moveTo(dx, y + dy);
          for (let x = 0; x <= S; x += 16) g.lineTo(x + dx, y + dy + Math.sin(x * 0.05 + i) * 8 + rnd() * 4);
          for (let x = S; x >= 0; x -= 16) g.lineTo(x + dx, y + dy + w + Math.sin(x * 0.05 + i) * 6);
          g.closePath();
          g.fill();
        });
      }
      break;
    }
    case 'carbon': {
      const P = 16;
      for (let y = 0; y < S; y += P) for (let x = 0; x < S; x += P) {
        const grad = ((x + y) / P) % 2 === 0 ? g.createLinearGradient(x, y, x + P, y) : g.createLinearGradient(x, y, x, y + P);
        grad.addColorStop(0, cols[0]);
        grad.addColorStop(0.5, cols[1]);
        grad.addColorStop(1, cols[0]);
        g.fillStyle = grad;
        g.fillRect(x + 1, y + 1, P - 2, P - 2);
      }
      break;
    }
    case 'neon': {
      // Thin bright lines on a dark base; the same lines glow.
      glowCanvas = document.createElement('canvas');
      glowCanvas.width = glowCanvas.height = S;
      const gg = glowCanvas.getContext('2d')!;
      gg.fillStyle = '#000';
      gg.fillRect(0, 0, S, S);
      for (const ctx of [g, gg]) {
        ctx.lineWidth = 2.5;
        for (let i = 0; i < 14; i++) {
          ctx.strokeStyle = cols[i % cols.length];
          const x0 = rnd() * S, y0 = rnd() * S, len = 40 + rnd() * 90, horiz = rnd() < 0.5;
          wrap((dx, dy) => {
            ctx.beginPath();
            ctx.moveTo(x0 + dx, y0 + dy);
            ctx.lineTo(x0 + dx + (horiz ? len : len * 0.4), y0 + dy + (horiz ? 0 : len));
            ctx.lineTo(x0 + dx + (horiz ? len + 20 : len * 0.4 + 20), y0 + dy + (horiz ? 20 : len));
            ctx.stroke();
          });
        }
      }
      break;
    }
    case 'facets': {
      for (let i = 0; i < 70; i++) {
        const x = rnd() * S, y = rnd() * S, r = 14 + rnd() * 26;
        const a0 = rnd() * Math.PI * 2;
        g.fillStyle = rnd() < 0.5 ? cols[0] : cols[1];
        g.globalAlpha = 0.25 + rnd() * 0.5;
        wrap((dx, dy) => {
          g.beginPath();
          for (let k = 0; k < 3; k++) g.lineTo(x + dx + Math.cos(a0 + k * 2.1) * r, y + dy + Math.sin(a0 + k * 2.1) * r);
          g.closePath();
          g.fill();
        });
      }
      g.globalAlpha = 1;
      break;
    }
    case 'royal': {
      g.strokeStyle = cols[0];
      g.lineWidth = 2;
      for (let i = 0; i < 18; i++) {
        const x = rnd() * S, y = rnd() * S, r = 10 + rnd() * 20;
        wrap((dx, dy) => {
          g.beginPath();
          g.arc(x + dx, y + dy, r, rnd() * 3, rnd() * 3 + 3.5);
          g.stroke();
          g.beginPath();
          g.arc(x + dx + r, y + dy, r * 0.5, 0, Math.PI * 1.4);
          g.stroke();
        });
      }
      break;
    }
    default:
      // Plain finishes (factory, gold, cobalt): fine brushed lines, no texture needed for the gun.
      return { map: null, glow: null, swatch: swatch(canvas, c) };
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(2, 2);
  let glow: THREE.Texture | null = null;
  if (glowCanvas) {
    glow = new THREE.CanvasTexture(glowCanvas);
    glow.wrapS = glow.wrapT = THREE.RepeatWrapping;
    glow.colorSpace = THREE.SRGBColorSpace;
    glow.repeat.set(2, 2);
  }
  return { map: tex, glow, swatch: swatch(canvas, c) };
}

/** A small preview picture for the menus (with a metallic sheen for metal finishes). */
function swatch(src: HTMLCanvasElement, c: Camo): string {
  const S = 96;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  g.drawImage(src, 0, 0, S * 1.6, S * 1.6);
  const sheen = g.createLinearGradient(0, 0, S, S);
  sheen.addColorStop(0, `rgba(255,255,255,${0.05 + c.metalness * 0.35})`);
  sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
  sheen.addColorStop(1, `rgba(0,0,0,${0.2 + c.metalness * 0.2})`);
  g.fillStyle = sheen;
  g.fillRect(0, 0, S, S);
  return cv.toDataURL();
}

function seeded(id: string): () => number {
  let s = [...id].reduce((h, ch) => (Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0), 2166136261) || 1;
  return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) >>> 0), (s >>> 8) / 16777216);
}
