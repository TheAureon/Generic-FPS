import * as THREE from 'three';

/**
 * Builds a detailed model out of many simple shapes, then merges them into
 * ONE geometry (one draw call) with a color per part. Parts can also glow
 * (`glow`, used with the character/prop material from render/shaders.ts).
 */
export interface PartOptions {
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  glow?: number;
}

export class Parts {
  private list: THREE.BufferGeometry[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();

  /** Add a shape (it's consumed: don't reuse `geo`). */
  add(geo: THREE.BufferGeometry, color: number, o: PartOptions = {}): this {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    g.deleteAttribute('uv');
    this.e.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
    this.m.compose(new THREE.Vector3(o.x ?? 0, o.y ?? 0, o.z ?? 0), this.q.setFromEuler(this.e), new THREE.Vector3(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1));
    g.applyMatrix4(this.m);
    const n = g.getAttribute('position').count;
    const c = new THREE.Color(color);
    const col = new Float32Array(n * 3);
    const glow = new Float32Array(n).fill(o.glow ?? 0);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
    this.list.push(g);
    return this;
  }

  box(w: number, h: number, d: number, color: number, o: PartOptions = {}): this {
    return this.add(new THREE.BoxGeometry(w, h, d), color, o);
  }

  /** Cylinder standing along Y. */
  cyl(rTop: number, rBottom: number, h: number, color: number, o: PartOptions = {}, segments = 12): this {
    return this.add(new THREE.CylinderGeometry(rTop, rBottom, h, segments), color, o);
  }

  /** Merge everything added so far into one geometry. */
  build(): THREE.BufferGeometry {
    const names = ['position', 'normal', 'color', 'aGlow'];
    const total = this.list.reduce((s, g) => s + g.getAttribute('position').count, 0);
    const out = new THREE.BufferGeometry();
    for (const name of names) {
      const size = (this.list[0].getAttribute(name) as THREE.BufferAttribute).itemSize;
      const arr = new Float32Array(total * size);
      let off = 0;
      for (const g of this.list) {
        const a = g.getAttribute(name).array as Float32Array;
        arr.set(a, off);
        off += a.length;
      }
      out.setAttribute(name, new THREE.BufferAttribute(arr, size));
    }
    for (const g of this.list) g.dispose();
    this.list = [];
    out.computeBoundingSphere();
    return out;
  }
}

/** A flat 2D outline, extruded `depth` along Z (centered), with softly rounded edges. */
export function extrude(shape: THREE.Shape, depth: number, bevel = 0.008): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, depth - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 6,
  });
  g.translate(0, 0, -(depth - bevel * 2) / 2);
  return g;
}

/** Rectangle with rounded corners (for extruding). */
export function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
