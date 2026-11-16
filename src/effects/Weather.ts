import * as THREE from 'three';
import { audio } from '../audio/AudioEngine';
import type { CollisionWorld } from '../core/CollisionWorld';
import type { Weather } from '../core/environment';

/**
 * Falling rain or snow around the camera. Drops stop at roofs (they don't
 * fall indoors): a coarse map of the highest surface at each spot is made
 * once, and a drop that falls below it starts again at the top.
 * Rain also plays a soft, steady hiss.
 */

const AREA = 36; // meters around the camera
const CELL = 1.5;

export class WeatherFx {
  private points: THREE.LineSegments | THREE.Points | null = null;
  private pos: Float32Array = new Float32Array(0);
  private vel: Float32Array = new Float32Array(0);
  private count = 0;
  private roof = new Map<number, number>();
  private sound: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private center = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private world: CollisionWorld,
    readonly kind: Weather,
    private top: number,
  ) {
    if (kind !== 'rain' && kind !== 'snow') return;
    const rain = kind === 'rain';
    this.count = rain ? 1800 : 1400;
    const geo = new THREE.BufferGeometry();
    // Rain: a short streak per drop (2 points); snow: one flake (1 point).
    this.pos = new Float32Array(this.count * (rain ? 6 : 3));
    this.vel = new Float32Array(this.count * 3);
    for (let i = 0; i < this.count; i++) this.respawn(i, true);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    if (rain) {
      this.points = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0.45, fog: true }));
    } else {
      this.points = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.07, transparent: true, opacity: 0.9, map: flakeTexture(), depthWrite: false, fog: true }));
    }
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  /** Highest surface (roof) at x, z, cached on a coarse grid. */
  private roofAt(x: number, z: number): number {
    const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
    const key = (ix + 4096) * 8192 + (iz + 4096);
    let h = this.roof.get(key);
    if (h === undefined) {
      h = this.world.groundHeight((ix + 0.5) * CELL, (iz + 0.5) * CELL, CELL * 0.5, this.top + 50);
      if (!Number.isFinite(h)) h = -50;
      this.roof.set(key, h);
    }
    return h;
  }

  private respawn(i: number, anywhere: boolean): void {
    const rain = this.kind === 'rain';
    const x = this.center.x + (Math.random() - 0.5) * AREA;
    const z = this.center.z + (Math.random() - 0.5) * AREA;
    const y = anywhere ? this.center.y - 6 + Math.random() * 26 : this.center.y + 14 + Math.random() * 6;
    const v = this.vel;
    v[i * 3] = rain ? 0.6 : (Math.random() - 0.5) * 0.6;
    v[i * 3 + 1] = rain ? -(16 + Math.random() * 4) : -(1 + Math.random() * 0.6);
    v[i * 3 + 2] = rain ? 0.3 : (Math.random() - 0.5) * 0.6;
    this.set(i, x, y, z);
  }

  private set(i: number, x: number, y: number, z: number): void {
    const p = this.pos;
    if (this.kind === 'rain') {
      // The streak trails up behind the falling drop.
      p[i * 6] = x;
      p[i * 6 + 1] = y;
      p[i * 6 + 2] = z;
      p[i * 6 + 3] = x - this.vel[i * 3] * 0.03;
      p[i * 6 + 4] = y + 0.45;
      p[i * 6 + 5] = z - this.vel[i * 3 + 2] * 0.03;
    } else {
      p[i * 3] = x;
      p[i * 3 + 1] = y;
      p[i * 3 + 2] = z;
    }
  }

  update(dt: number, camera: THREE.Camera): void {
    if (this.kind === 'rain') this.updateSound();
    if (!this.points) return;
    camera.getWorldPosition(this.center);
    const stride = this.kind === 'rain' ? 6 : 3;
    const p = this.pos, v = this.vel, half = AREA / 2;
    const t = performance.now() / 1000;
    for (let i = 0; i < this.count; i++) {
      let x = p[i * stride], y = p[i * stride + 1], z = p[i * stride + 2];
      x += v[i * 3] * dt;
      y += v[i * 3 + 1] * dt;
      z += v[i * 3 + 2] * dt;
      // Snow drifts from side to side.
      if (this.kind === 'snow') {
        x += Math.sin(t * 0.9 + i) * 0.25 * dt;
        z += Math.cos(t * 0.7 + i * 1.3) * 0.25 * dt;
      }
      // Keep the area centered on the camera (wrap around).
      if (x < this.center.x - half) x += AREA;
      else if (x > this.center.x + half) x -= AREA;
      if (z < this.center.z - half) z += AREA;
      else if (z > this.center.z + half) z -= AREA;
      if (y < this.roofAt(x, z) || y < this.center.y - 12) {
        this.respawn(i, false);
        continue;
      }
      this.set(i, x, y, z);
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }

  /** The rain's hiss: looping filtered noise, started once sound is allowed. */
  private updateSound(): void {
    if (this.sound) return;
    const ctx = audio.context;
    if (!ctx) return;
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 300;
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    src.connect(lp).connect(hp).connect(gain).connect(audio.output);
    src.start();
    this.sound = { src, gain };
  }

  dispose(): void {
    if (this.points) {
      this.points.removeFromParent();
      this.points.geometry.dispose();
      (this.points.material as THREE.Material).dispose();
    }
    if (this.sound) {
      try {
        this.sound.src.stop();
      } catch {
        // already stopped
      }
      this.sound.gain.disconnect();
    }
  }
}

/** A soft round dot for snowflakes. */
function flakeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}
