import * as THREE from 'three';

/**
 * Grass tufts and wild flowers: two crossed cut-out cards each, scattered
 * over grassy ground (Medium and High graphics). Purely for looks: they
 * aren't solid and don't hide anyone.
 *
 * Tufts are grouped by area so the game only draws the groups in view.
 */
export class Tufts {
  private chunks = new Map<string, { pos: number[]; nrm: number[]; col: number[]; light: number[]; uv: number[] }>();
  constructor(private chunkSize = 24) {}

  /**
   * One tuft standing at (x, y, z). `flowers`: 0 = plain grass, 1 = with
   * flowers. `color` = the ground's shading there, `light` = lamp light.
   */
  add(x: number, y: number, z: number, n: THREE.Vector3, color: THREE.Color, light: THREE.Color, rnd: () => number, flowers: boolean, scale = 1): void {
    const key = `${Math.floor(x / this.chunkSize)},${Math.floor(z / this.chunkSize)}`;
    let c = this.chunks.get(key);
    if (!c) this.chunks.set(key, (c = { pos: [], nrm: [], col: [], light: [], uv: [] }));
    // Which of the four pictures (2 x 2 in the texture): grass, short grass, yellow or white/purple flowers.
    const cell = flowers ? 2 + (rnd() < 0.5 ? 0 : 1) : rnd() < 0.6 ? 0 : 1;
    const u0 = (cell % 2) * 0.5, v0 = 1 - (Math.floor(cell / 2) + 1) * 0.5;
    const w = (0.55 + rnd() * 0.4) * scale, h = (0.38 + rnd() * 0.3) * scale * (flowers ? 1.15 : 1);
    const yaw = rnd() * Math.PI;
    // Light at the root (shaded by the ground and neighbors), brighter at the tips.
    const lo = 0.55, hi = 1.08;
    for (let k = 0; k < 2; k++) {
      const a = yaw + k * (Math.PI / 2);
      const dx = (Math.cos(a) * w) / 2, dz = (Math.sin(a) * w) / 2;
      // Lean the tips a little, all the same way per tuft (like a breeze).
      const lx = (rnd() - 0.5) * 0.12, lz = (rnd() - 0.5) * 0.12;
      const P = [
        [x - dx, y, z - dz, u0, v0, lo],
        [x + dx, y, z + dz, u0 + 0.5, v0, lo],
        [x + dx + lx, y + h, z + dz + lz, u0 + 0.5, v0 + 0.5, hi],
        [x - dx + lx, y + h, z - dz + lz, u0, v0 + 0.5, hi],
      ];
      for (const i of [0, 1, 2, 0, 2, 3]) {
        const p = P[i];
        c.pos.push(p[0], p[1], p[2]);
        // Lit like the ground beneath (so tufts blend in instead of standing out as flat cards).
        c.nrm.push(n.x, n.y, n.z);
        c.col.push(color.r * p[5], color.g * p[5], color.b * p[5]);
        c.light.push(light.r, light.g, light.b);
        c.uv.push(p[3], p[4] * 0.995 + 0.0025);
      }
    }
  }

  build(): THREE.BufferGeometry[] {
    const out: THREE.BufferGeometry[] = [];
    for (const c of this.chunks.values()) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(c.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(c.nrm, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(c.col, 3));
      g.setAttribute('aLight', new THREE.Float32BufferAttribute(c.light, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(c.uv, 2));
      out.push(g);
    }
    return out;
  }
}
