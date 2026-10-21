import * as THREE from 'three';
import type { SkyDef } from '../map/MapTypes';

/**
 * The sky: a color gradient from the horizon up, a sun with a soft glow,
 * slowly drifting clouds, and (optionally) a skyline of distant factory
 * buildings and smokestacks around the arena. Everything is computed in one
 * small shader on one big sphere, so it costs about as much as one wall.
 *
 * The sun in the sky is in the same place as the light that casts shadows.
 */

/** Direction toward the sun (unit vector). Azimuth 0 = north (-Z), 90 = east (+X). */
export function sunDirection(def: SkyDef, out = new THREE.Vector3()): THREE.Vector3 {
  const el = THREE.MathUtils.degToRad(def.sunElevation);
  const az = THREE.MathUtils.degToRad(def.sunAzimuth);
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}

const VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always at the very back
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform vec3 uCloudColor;
uniform float uClouds;
uniform float uTime;
uniform float uSunDisc;
varying vec3 vDir;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  // Sky gradient (and a darker band below the horizon).
  float t = pow(clamp(h, 0.0, 1.0), 0.4);
  vec3 col = t < 0.5 ? mix(uHorizon, uMid, t * 2.0) : mix(uMid, uZenith, t * 2.0 - 1.0);
  if (h < 0.0) col = mix(uHorizon, uGround, clamp(-h * 5.0, 0.0, 1.0));

  // Glow around the sun, and the horizon brightening on the sun's side.
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 6.0) * 0.22 + pow(sd, 90.0) * 0.7);
  col += uSunColor * pow(1.0 - abs(h), 8.0) * sd * sd * 0.3;

  // Clouds: noise projected on a flat layer high above, drifting with the wind.
  if (h > 0.0 && uClouds > 0.0) {
    vec2 uv = d.xz / (h + 0.12) * 0.8 + vec2(uTime * 0.006, uTime * 0.0025);
    float n = fbm(uv * 1.5);
    float cover = smoothstep(1.0 - uClouds, 1.0 - uClouds + 0.32, n);
    // Sample a little toward the sun: thicker there means a shaded underside.
    float toward = fbm(uv * 1.5 + uSunDir.xz * 0.12);
    float shade = clamp(0.75 + (n - toward) * 3.0, 0.45, 1.15);
    vec3 cloud = uCloudColor * shade + uSunColor * pow(sd, 10.0) * 0.5;
    col = mix(col, cloud, cover * smoothstep(0.0, 0.22, h) * 0.92);
  }

  // The sun itself (bright enough to glow on High graphics).
  col += uSunColor * smoothstep(0.99935, 0.9997, sd) * 14.0 * uSunDisc;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Sky {
  readonly group = new THREE.Group();
  readonly sunDir: THREE.Vector3;
  private material: THREE.ShaderMaterial;

  constructor(readonly def: SkyDef, center: THREE.Vector3, arenaRadius: number) {
    this.sunDir = sunDirection(def);
    this.material = makeSkyMaterial(def, this.sunDir, 1);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), this.material);
    dome.frustumCulled = false;
    dome.renderOrder = -1000;
    dome.name = 'sky';
    // Follow the camera, so the sky is always "infinitely" far away.
    dome.onBeforeRender = (_r, _s, camera) => {
      dome.position.copy(camera.position);
      dome.updateMatrixWorld();
      this.material.uniforms.uTime.value = performance.now() / 1000;
    };
    this.group.add(dome);
    if (def.skyline !== false) this.group.add(buildSkyline(center, arenaRadius, def, this.sunDir));
  }

  /** A scene with just the sky (no sun disc, no skyline), for capturing reflections. */
  reflectionScene(): THREE.Scene {
    const s = new THREE.Scene();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), makeSkyMaterial(this.def, this.sunDir, 0));
    s.add(dome);
    return s;
  }
}

function makeSkyMaterial(def: SkyDef, sunDir: THREE.Vector3, disc: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uZenith: { value: new THREE.Color(def.zenith) },
      uHorizon: { value: new THREE.Color(def.horizon) },
      uMid: { value: def.mid !== undefined ? new THREE.Color(def.mid) : new THREE.Color(def.horizon).lerp(new THREE.Color(def.zenith), 0.5) },
      uGround: { value: new THREE.Color(def.ground ?? 0x4a4640) },
      uSunColor: { value: new THREE.Color(def.sunColor) },
      uSunDir: { value: sunDir.clone() },
      uCloudColor: { value: new THREE.Color(def.cloudColor ?? 0xf4f6fa) },
      uClouds: { value: def.clouds ?? 0.4 },
      uTime: { value: 0 },
      uSunDisc: { value: disc },
    },
  });
}

/** Simple repeatable random numbers. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/**
 * Distant industrial skyline: warehouses with sawtooth roofs, blocks, and
 * smokestacks in a ring well outside the arena. The fog fades them into the
 * horizon haze. One mesh (plus one for lit windows at dusk).
 */
function buildSkyline(center: THREE.Vector3, arenaRadius: number, def: SkyDef, sunDir: THREE.Vector3): THREE.Group {
  const rnd = seeded(1234567);
  const solid: THREE.BufferGeometry[] = [];
  const windows: THREE.BufferGeometry[] = [];
  const place = (g: THREE.BufferGeometry, x: number, z: number, yaw: number) => {
    g.rotateY(yaw);
    g.translate(center.x + x, 0, center.z + z);
    solid.push(g.index ? g.toNonIndexed() : g);
  };

  const count = 34;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rnd() * 0.12;
    const dist = arenaRadius + 45 + rnd() * 70;
    const x = Math.sin(a) * dist, z = Math.cos(a) * dist;
    const yaw = a;
    const w = 14 + rnd() * 26, d = 10 + rnd() * 18, h = 8 + rnd() * 22;
    const kind = rnd();
    if (kind < 0.45) {
      // Warehouse with a sawtooth roof.
      const teeth = 3 + Math.floor(rnd() * 4);
      const shape = new THREE.Shape();
      shape.moveTo(-w / 2, 0);
      shape.lineTo(w / 2, 0);
      shape.lineTo(w / 2, h);
      const tw = w / teeth;
      for (let t = teeth - 1; t >= 0; t--) {
        shape.lineTo(-w / 2 + t * tw + tw, h);
        shape.lineTo(-w / 2 + t * tw, h + tw * 0.45);
        shape.lineTo(-w / 2 + t * tw, h);
      }
      shape.lineTo(-w / 2, 0);
      const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
      g.translate(0, 0, -d / 2);
      place(g, x, z, yaw);
    } else {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(0, h / 2, 0);
      place(g, x, z, yaw);
      // Rooftop tanks/vents on some blocks.
      if (rnd() < 0.5) {
        const t = new THREE.CylinderGeometry(2, 2, 3 + rnd() * 3, 10);
        t.translate((rnd() - 0.5) * w * 0.5, h + 2.5, (rnd() - 0.5) * d * 0.5);
        place(t, x, z, yaw);
      }
    }
    // Smokestacks behind some buildings.
    if (rnd() < 0.3) {
      const sh = 30 + rnd() * 30;
      const s = new THREE.CylinderGeometry(1.4, 2.4, sh, 12);
      s.translate(0, sh / 2, 0);
      place(s, x * 1.08, z * 1.08, 0);
      const band = new THREE.CylinderGeometry(1.55, 1.55, 1.2, 12);
      band.translate(0, sh - 3, 0);
      place(band, x * 1.08, z * 1.08, 0);
    }
    // Lit windows (only for dusk/night skies): small panels on the side facing the arena.
    if (def.litWindows) {
      for (let k = 0; k < 6; k++) {
        if (rnd() < 0.4) continue;
        const win = new THREE.PlaneGeometry(1.4, 0.9);
        win.rotateY(Math.PI);
        win.translate((rnd() - 0.5) * w * 0.8, 2 + rnd() * (h - 4), -d / 2 - 0.05);
        win.rotateY(yaw);
        win.translate(center.x + x, 0, center.z + z);
        windows.push(win.toNonIndexed());
      }
    }
  }

  const g = new THREE.Group();
  g.name = 'skyline';
  // Colors are baked in: a lit side and a shaded side, faded into the
  // horizon haze with distance (like real distant buildings).
  const geo = merge(solid);
  const base = new THREE.Color(def.skylineColor ?? 0x4d5560);
  const haze = new THREE.Color(def.horizon);
  const sunTint = new THREE.Color(def.sunColor);
  const pos = geo.getAttribute('position'), nrm = geo.getAttribute('normal');
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    n.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    const lit = Math.max(0, n.dot(sunDir));
    c.copy(base).multiplyScalar(0.7 + 0.5 * lit).lerp(sunTint, 0.12 * lit);
    const dist = Math.hypot(pos.getX(i) - center.x, pos.getZ(i) - center.z);
    const k = THREE.MathUtils.clamp((dist - arenaRadius) / 120, 0.5, 0.85);
    c.lerp(haze, k);
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  mesh.matrixAutoUpdate = false;
  g.add(mesh);
  if (windows.length) {
    const lit = new THREE.Mesh(merge(windows), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc070).multiplyScalar(3), side: THREE.DoubleSide }));
    lit.matrixAutoUpdate = false;
    g.add(lit);
  }
  return g;
}

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  for (const g of list) {
    g.deleteAttribute('uv');
    if (!g.getAttribute('normal')) g.computeVertexNormals();
  }
  const total = list.reduce((s, g) => s + g.getAttribute('position').count, 0);
  const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3);
  let o = 0;
  for (const g of list) {
    pos.set(g.getAttribute('position').array as Float32Array, o);
    nrm.set(g.getAttribute('normal').array as Float32Array, o);
    o += g.getAttribute('position').array.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.computeBoundingSphere();
  return out;
}
