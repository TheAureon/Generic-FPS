import * as THREE from 'three';

/**
 * Small textures drawn in code. Replace these with image files later if you
 * like (e.g. `new THREE.TextureLoader().load('/textures/flash.png')`).
 */

let flashTex: THREE.Texture | null = null;
let holeTex: THREE.Texture | null = null;

/** Star-shaped muzzle flash. */
export function getFlashTexture(): THREE.Texture {
  return (flashTex ??= makeFlashTexture());
}

/** Bullet hole decal. */
export function getHoleTexture(): THREE.Texture {
  return (holeTex ??= makeHoleTexture());
}

function makeFlashTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,230,1)');
  grad.addColorStop(0.25, 'rgba(255,210,120,0.9)');
  grad.addColorStop(0.6, 'rgba(255,140,40,0.35)');
  grad.addColorStop(1, 'rgba(255,100,0,0)');
  g.fillStyle = grad;
  // A star shape: a circle plus spikes.
  g.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const r = i % 2 === 0 ? 64 : 26;
    g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
  }
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeHoleTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(10,10,10,1)');
  grad.addColorStop(0.3, 'rgba(25,22,20,0.95)');
  grad.addColorStop(0.55, 'rgba(50,45,40,0.5)');
  grad.addColorStop(1, 'rgba(60,55,50,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
