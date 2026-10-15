import type * as THREE from 'three';
import { settings } from '../core/Settings';
import { SAMPLE_FILES, SYNTHS, type SoundId } from './sounds';

export interface PlayOptions {
  /** World position for 3D sound. Omit for sounds "in your head" (your own gun, UI). */
  position?: THREE.Vector3;
  volume?: number;
}

/** Plays sound effects. Browsers only allow audio after a click, see `unlock()`. */
class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private samples = new Map<SoundId, AudioBuffer>();

  /** Call from a click/keypress handler. Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = settings.get().masterVolume;
      // Gentle limiter so many overlapping shots don't distort.
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.ratio.value = 6;
      this.master.connect(comp).connect(this.ctx.destination);

      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

      settings.onChange((s) => this.master.gain.setTargetAtTime(s.masterVolume, this.ctx!.currentTime, 0.05));
      void this.loadSamples();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
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

  /** Keep the "ears" at the camera. Call every frame. */
  updateListener(camera: THREE.Camera): void {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const e = camera.matrixWorld.elements;
    const t = this.ctx.currentTime;
    // Camera looks down its -Z axis; Y is up.
    if (l.positionX) {
      l.positionX.setValueAtTime(e[12], t);
      l.positionY.setValueAtTime(e[13], t);
      l.positionZ.setValueAtTime(e[14], t);
      l.forwardX.setValueAtTime(-e[8], t);
      l.forwardY.setValueAtTime(-e[9], t);
      l.forwardZ.setValueAtTime(-e[10], t);
      l.upX.setValueAtTime(e[4], t);
      l.upY.setValueAtTime(e[5], t);
      l.upZ.setValueAtTime(e[6], t);
    } else {
      // Older Safari
      l.setPosition(e[12], e[13], e[14]);
      l.setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]);
    }
  }

  play(id: SoundId, opts: PlayOptions = {}): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;

    let out: AudioNode = this.master;
    const vol = opts.volume ?? 1;
    if (vol !== 1) {
      const g = ctx.createGain();
      g.gain.value = vol;
      g.connect(out);
      out = g;
    }
    if (opts.position) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 4;
      p.rolloffFactor = 1.2;
      p.positionX.value = opts.position.x;
      p.positionY.value = opts.position.y;
      p.positionZ.value = opts.position.z;
      p.connect(out);
      out = p;
    }

    const sample = this.samples.get(id);
    if (sample) {
      const src = ctx.createBufferSource();
      src.buffer = sample;
      src.playbackRate.value = 0.95 + Math.random() * 0.1;
      src.connect(out);
      src.start();
      return;
    }
    SYNTHS[id]({ ctx, out, t: ctx.currentTime + 0.005, noise: this.noise });
  }
}

export const audio = new AudioEngine();
