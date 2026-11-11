import type * as THREE from 'three';
import { settings } from '../core/Settings';
import { SAMPLE_FILES, SYNTHS, type SoundId } from './sounds';

export interface PlayOptions {
  /** World position for 3D sound. Omit for sounds "in your head" (your own gun, UI). */
  position?: THREE.Vector3;
  volume?: number;
}

/**
 * Most new sounds in a short moment: past this, faraway ones are skipped
 * (and past twice this, all of them) so a huge firefight can't overload the
 * sound system.
 */
const BURST_MAX = 24;
const BURST_WINDOW = 0.25;
/** How long a generated sound effect is kept connected (seconds). */
const SYNTH_LIFETIME = 4;

/**
 * Plays sound effects. Browsers only allow audio after a click, see `unlock()`.
 *
 * Keeping sound alive: a browser can pause a page's sound by itself (Safari
 * does when the audio device changes, after sleep, or when another tab or app
 * plays sound). Any later key press, click or return to the tab starts it
 * again. And if a broken value ever reaches the mixer (which would silence it
 * for good), a watchdog rebuilds the mixer within a second.
 */
class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private limiter!: DynamicsCompressorNode;
  private guard!: AnalyserNode;
  private guardBuf = new Float32Array(256);
  private resuming = false;
  private resetListeners: (() => void)[] = [];
  private noise!: AudioBuffer;
  private samples = new Map<SoundId, AudioBuffer>();
  /** Where the listener (camera) is, and when the latest sounds started (audio clock). */
  private ear = { x: 0, y: 0, z: 0 };
  private recent: number[] = [];
  private missing = new Set<string>();

  /** Call from a click/keypress handler. Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = settings.get().masterVolume;
      this.buildLimiter();
      // Watch what goes into the limiter; see healIfBroken().
      this.guard = this.ctx.createAnalyser();
      this.guard.fftSize = 256;
      this.master.connect(this.guard);
      window.setInterval(() => this.healIfBroken(), 1000);

      // Start sound again whenever the player does anything, or comes back to the tab.
      const wake = () => this.resume();
      for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, wake, true);
      window.addEventListener('focus', wake);
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && this.resume());
      this.ctx.addEventListener('statechange', () => this.ctx!.state !== 'running' && document.visibilityState === 'visible' && this.resume());

      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

      settings.onChange((s) => this.master.gain.setTargetAtTime(s.masterVolume, this.ctx!.currentTime, 0.05));
      void this.loadSamples();
    }
    this.resume();
  }

  /** Ask the browser to start sound again if it was paused (needs a recent click or key press). */
  private resume(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed' || this.resuming) return;
    this.resuming = true;
    ctx.resume().catch(() => {}).finally(() => (this.resuming = false));
  }

  /** Gentle limiter so many overlapping shots don't distort. */
  private buildLimiter(): void {
    const ctx = this.ctx!;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -10;
    this.limiter.ratio.value = 6;
    this.master.connect(this.limiter).connect(ctx.destination);
  }

  /**
   * A single broken value (not a number) reaching the limiter would silence
   * everything for good. If one shows up, swap in a fresh limiter, and tell
   * the music to rebuild itself (its echoes could keep passing it around).
   */
  private healIfBroken(): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    this.guard.getFloatTimeDomainData(this.guardBuf);
    if (this.guardBuf.every((v) => Number.isFinite(v))) return;
    console.warn('Sound: a broken value reached the mixer; rebuilding it.');
    this.master.disconnect(this.limiter);
    this.limiter.disconnect();
    this.buildLimiter();
    for (const f of this.resetListeners) f();
  }

  /** Called if the mixer had to be rebuilt (see healIfBroken). */
  onReset(f: () => void): void {
    this.resetListeners.push(f);
  }

  private async loadSamples(): Promise<void> {
    for (const [id, url] of Object.entries(SAMPLE_FILES) as [SoundId, string][]) {
      try {
        const res = await fetch(url);
        this.samples.set(id, await this.ctx!.decodeAudioData(await res.arrayBuffer()));
      } catch (e) {
        console.warn(`Could not load sound ${id} from ${url}; using generated sound.`, e);
      }
    }
  }

  /** The audio context once sound is unlocked (after the first click), else null. */
  get context(): AudioContext | null {
    return this.ctx && this.ctx.state === 'running' ? this.ctx : null;
  }

  /** Where other sound (music) should go: through the main volume and limiter. */
  get output(): AudioNode {
    return this.master;
  }

  /** Keep the "ears" at the camera. Call every frame. */
  updateListener(camera: THREE.Camera): void {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const e = camera.matrixWorld.elements;
    if (!e.every((v) => Number.isFinite(v))) return;
    this.ear.x = e[12];
    this.ear.y = e[13];
    this.ear.z = e[14];
    // Camera looks down its -Z axis; Y is up.
    // (Set the values directly. Scheduling a change every frame instead piles
    // up thousands of entries a minute in the browser's audio timeline; Safari
    // never clears them out, and sooner or later the sound just stops.)
    if (l.positionX) {
      l.positionX.value = e[12];
      l.positionY.value = e[13];
      l.positionZ.value = e[14];
      l.forwardX.value = -e[8];
      l.forwardY.value = -e[9];
      l.forwardZ.value = -e[10];
      l.upX.value = e[4];
      l.upY.value = e[5];
      l.upZ.value = e[6];
    } else {
      // Older Safari
      l.setPosition(e[12], e[13], e[14]);
      l.setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]);
    }
  }

  play(id: SoundId, opts: PlayOptions = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state !== 'running') {
      this.resume();
      return;
    }
    // A sound that doesn't exist is skipped (with one warning), never an error mid-game.
    if (!SYNTHS[id] && !this.samples.has(id)) {
      if (!this.missing.has(id)) console.warn(`Sound "${id}" doesn't exist.`);
      this.missing.add(id);
      return;
    }
    // Never feed the mixer a broken position or volume (see healIfBroken).
    const p = opts.position;
    if (p && !(Math.abs(p.x) < 1e4 && Math.abs(p.y) < 1e4 && Math.abs(p.z) < 1e4)) return;
    if (opts.volume !== undefined && !(opts.volume >= 0 && opts.volume < 10)) return;

    // Too much at once (a big firefight): skip faraway sounds rather than overload the sound system.
    const dist = p ? Math.hypot(p.x - this.ear.x, p.y - this.ear.y, p.z - this.ear.z) : 0;
    const now = ctx.currentTime;
    while (this.recent.length && this.recent[0] < now - BURST_WINDOW) this.recent.shift();
    if (this.recent.length >= BURST_MAX && (dist > 12 || this.recent.length >= BURST_MAX * 2)) return;
    this.recent.push(now);

    // Every sound gets its own volume node, so the whole chain can be let go when it's over.
    const voice = ctx.createGain();
    voice.gain.value = opts.volume ?? 1;
    voice.connect(this.master);
    let out: AudioNode = voice;
    let done = false;
    const release = () => {
      if (done) return;
      done = true;
      voice.disconnect();
    };
    if (p) {
      const pan = ctx.createPanner();
      // Proper 3D (HRTF) close by; the much cheaper simple panning further away.
      pan.panningModel = dist < 18 ? 'HRTF' : 'equalpower';
      pan.distanceModel = 'inverse';
      pan.refDistance = 4;
      pan.rolloffFactor = 1.2;
      pan.positionX.value = p.x;
      pan.positionY.value = p.y;
      pan.positionZ.value = p.z;
      pan.connect(out);
      out = pan;
    }

    const sample = this.samples.get(id);
    if (sample) {
      const src = ctx.createBufferSource();
      src.buffer = sample;
      src.playbackRate.value = 0.95 + Math.random() * 0.1;
      src.connect(out);
      src.onended = release;
      src.start();
      window.setTimeout(release, (sample.duration / 0.95 + 0.5) * 1000);
      return;
    }
    SYNTHS[id]({ ctx, out, t: ctx.currentTime + 0.005, noise: this.noise });
    // Generated sounds are all short (the longest are about 2 s).
    window.setTimeout(release, SYNTH_LIFETIME * 1000);
  }
}

export const audio = new AudioEngine();
