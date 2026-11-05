import { settings } from '../core/Settings';
import { audio } from './AudioEngine';

/**
 * Music, composed in code (no audio files): a slow, moody theme for the
 * menus; quiet ambience during a match that builds up (bass, drums, a fast
 * arpeggio) while you're fighting and calms down afterwards; and short
 * victory / defeat stingers. It dips under big moments (explosions,
 * call-outs) so they still hit. Volume: Settings → Music (0 = off).
 *
 * How it works: a little sequencer looks a fraction of a second ahead and
 * schedules notes on the audio clock, so timing stays tight even if a frame
 * is slow.
 */

export type MusicTrack = 'menu' | 'match' | null;

/** Overall music level before the Music volume setting (keeps it under the sound effects). */
const LEVEL = 1;
/** How far ahead notes are scheduled (seconds). */
const LOOKAHEAD = 0.3;

/** A chord: root note (MIDI number) and the other notes above it (semitones). */
type Chord = [number, number[]];
const MIN = [0, 3, 7, 10];
const MAJ = [0, 4, 7, 11];
const SUS = [0, 5, 7, 10];

interface TrackDef {
  bpm: number;
  /** Bars each chord lasts. */
  barsPerChord: number;
  chords: Chord[];
}

const TRACKS: Record<'menu' | 'match', TrackDef> = {
  // D minor, slow: Dm, Bb, F, C (and a suspended turn at the end).
  menu: { bpm: 70, barsPerChord: 2, chords: [[50, MIN], [46, MAJ], [41, MAJ], [48, SUS]] },
  // E minor, tense and driving when it builds: Em, Em, C, D, Em, Em, Am, B.
  match: { bpm: 104, barsPerChord: 1, chords: [[52, MIN], [52, MIN], [48, MAJ], [50, MAJ], [52, MIN], [52, MIN], [45, MIN], [47, [0, 4, 7, 10]]] },
};

const freq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

class Music {
  private ctx: AudioContext | null = null;
  /** Music volume (setting) → duck (dips) → main output. */
  private volume!: GainNode;
  private duckGain!: GainNode;
  private fadeGain!: GainNode;
  private reverb!: ConvolverNode;
  private delay!: DelayNode;
  private noise!: AudioBuffer;
  /** Layers whose loudness follows the match's intensity. */
  private layers!: { pad: GainNode; bass: GainNode; drums: GainNode; arp: GainNode };

  private track: MusicTrack = null;
  private wanted: MusicTrack = null;
  private step = 0;
  private nextTime = 0;
  private intensity = 0;
  private intensityTarget = 0;
  private paused = false;
  private switching = false;

  /** Choose what plays (null = silence). Call every frame; changes crossfade. */
  update(dt: number, track: MusicTrack, opts: { intensity?: number; paused?: boolean } = {}): void {
    if (!this.ctx) {
      const ctx = audio.context;
      if (!ctx) return; // sound isn't unlocked yet (no click so far)
      this.setup(ctx);
    }
    const ctx = this.ctx!;
    this.wanted = track;
    this.intensityTarget = opts.intensity ?? 0;
    // Build up fairly quickly, calm down slowly.
    const rate = this.intensityTarget > this.intensity ? 1.6 : 0.25;
    this.intensity += (this.intensityTarget - this.intensity) * Math.min(1, dt * rate);
    this.applyLayers();
    if (opts.paused !== this.paused) {
      this.paused = !!opts.paused;
      // Paused: the music carries on, quieter.
      this.fadeGain.gain.setTargetAtTime(this.paused ? 0.45 : 1, ctx.currentTime, 0.3);
    }

    if (this.wanted !== this.track && !this.switching) {
      if (this.track === null) this.start(this.wanted);
      else {
        // Fade out, then switch.
        this.switching = true;
        this.fadeGain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
        window.setTimeout(() => {
          this.switching = false;
          this.track = null;
          this.start(this.wanted);
        }, 1400);
      }
    }
    if (this.track) this.schedule();
  }

  /** Briefly turn the music down (0..1 = how much), e.g. under an explosion. */
  duck(amount: number, seconds = 1.2): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, g = this.duckGain.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(1 - amount, t, 0.03);
    g.setTargetAtTime(1, t + seconds, 0.5);
  }

  /** A short piece for the end of a match. The match music stops. */
  stinger(win: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.wanted = null;
    this.track = null;
    this.fadeGain.gain.setTargetAtTime(1, ctx.currentTime, 0.05);
    const t = ctx.currentTime + 0.05;
    if (win) {
      // A rising fanfare into a big major chord.
      [64, 67, 71, 76].forEach((n, i) => this.pluck(freq(n), t + i * 0.12, 0.5, 0.16, this.layers.arp));
      for (const n of [52, 64, 68, 71, 76]) this.padNote(freq(n), t + 0.48, 3.2, 0.06);
      this.bassNote(freq(40), t + 0.48, 2.5, 0.35);
      this.boom(t + 0.48, 0.6);
    } else {
      // A slow fall into a dark minor chord.
      [69, 67, 64, 62].forEach((n, i) => this.pluck(freq(n), t + i * 0.22, 0.7, 0.12, this.layers.arp));
      for (const n of [50, 57, 60, 65]) this.padNote(freq(n), t + 0.9, 3.5, 0.06);
      this.bassNote(freq(38), t + 0.9, 3, 0.3);
    }
  }

  // ---- Setup ------------------------------------------------------------------

  private setup(ctx: AudioContext): void {
    this.ctx = ctx;
    this.volume = ctx.createGain();
    this.duckGain = ctx.createGain();
    this.fadeGain = ctx.createGain();
    this.fadeGain.gain.value = 0;
    this.volume.gain.value = LEVEL * settings.get().musicVolume;
    settings.onChange((s) => this.volume.gain.setTargetAtTime(LEVEL * s.musicVolume, ctx.currentTime, 0.1));
    this.fadeGain.connect(this.duckGain).connect(this.volume).connect(audio.output);

    // A big, soft room: a reverb made from fading noise.
    this.reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 3);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    this.reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(this.fadeGain);

    // An echo for the arpeggios.
    this.delay = ctx.createDelay(2);
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const delayOut = ctx.createGain();
    delayOut.gain.value = 0.4;
    this.delay.connect(fb).connect(this.delay);
    this.delay.connect(delayOut).connect(this.fadeGain);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    const layer = () => {
      const g = ctx.createGain();
      g.connect(this.fadeGain);
      g.connect(this.reverb);
      return g;
    };
    this.layers = { pad: layer(), bass: layer(), drums: layer(), arp: layer() };
    this.layers.arp.connect(this.delay);
    // Keep scheduling on its own timer too, so a slow frame never leaves a gap in the music.
    window.setInterval(() => {
      if (this.track && !this.switching) this.schedule();
    }, 100);
  }

  private start(track: MusicTrack): void {
    this.track = track;
    if (!track || !this.ctx) return;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.fadeGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.fadeGain.gain.setTargetAtTime(this.paused ? 0.45 : 1, this.ctx.currentTime, 0.8);
  }

  /** How loud each layer is, from the track and the intensity. */
  private applyLayers(): void {
    const t = this.ctx!.currentTime, k = this.intensity;
    const set = (g: GainNode, v: number) => g.gain.setTargetAtTime(v, t, 0.15);
    if (this.track === 'match') {
      set(this.layers.pad, 0.75 - 0.25 * k);
      set(this.layers.bass, 0.25 + 0.75 * smooth((k - 0.1) / 0.4));
      set(this.layers.drums, smooth((k - 0.25) / 0.35));
      set(this.layers.arp, smooth((k - 0.55) / 0.35));
    } else {
      set(this.layers.pad, 1);
      set(this.layers.bass, 0.8);
      set(this.layers.drums, 1);
      set(this.layers.arp, 1);
    }
  }

  // ---- The sequencer -------------------------------------------------------------

  private schedule(): void {
    const ctx = this.ctx!;
    const def = TRACKS[this.track as 'menu' | 'match'];
    const stepLen = 60 / def.bpm / 4; // 16th notes
    // After a long pause in scheduling (e.g. a hidden tab), don't play a backlog.
    if (this.nextTime < ctx.currentTime - 0.5) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      if (this.track === 'menu') this.menuStep(this.step, this.nextTime, stepLen, def);
      else this.matchStep(this.step, this.nextTime, stepLen, def);
      this.nextTime += stepLen;
      this.step++;
    }
  }

  private chordAt(step: number, def: TrackDef): { chord: Chord; first: boolean; index: number } {
    const stepsPerChord = 16 * def.barsPerChord;
    const index = Math.floor(step / stepsPerChord) % def.chords.length;
    return { chord: def.chords[index], first: step % stepsPerChord === 0, index };
  }

  private menuStep(step: number, t: number, s: number, def: TrackDef): void {
    const { chord, first, index } = this.chordAt(step, def);
    const [root, notes] = chord;
    const inBar = step % 16;
    const chordLen = s * 16 * def.barsPerChord;
    if (first) {
      // Pad: the chord, slow to swell, overlapping the next one.
      for (const n of notes) this.padNote(freq(root + 12 + n), t, chordLen + 1.5, 0.05);
      this.padNote(freq(root + 24 + notes[1]), t, chordLen + 1.5, 0.025);
      // A deep hit at the start of each full round of chords.
      if (index === 0) this.boom(t, 0.5);
    }
    // Bass: long notes on the root.
    if (inBar === 0) this.bassNote(freq(root - 12), t, s * 14, 0.22);
    // A sparse, echoing arpeggio on every other bar.
    if (Math.floor(step / 16) % 2 === 1 && inBar % 4 === 0) {
      const n = notes[(inBar / 4) % notes.length];
      this.pluck(freq(root + 24 + n), t, 1.4, 0.07, this.layers.arp);
    }
  }

  private matchStep(step: number, t: number, s: number, def: TrackDef): void {
    const { chord, first } = this.chordAt(step, def);
    const [root, notes] = chord;
    const inBar = step % 16;
    const barLen = s * 16;
    // Pad: always there, quiet and dark.
    if (first) for (const n of notes.slice(0, 3)) this.padNote(freq(root + n), t, barLen + 0.8, 0.055);
    // Bass: a slow pulse when calm, driving 8ths when it builds (the layer gain decides how loud).
    if (inBar % 2 === 0) this.bassNote(freq(root - 12), t, s * 1.6, inBar % 8 === 0 ? 0.32 : 0.2, this.layers.bass);
    // Drums.
    if (inBar === 0 || inBar === 8 || inBar === 11) this.kick(t, 0.55);
    if (inBar === 4 || inBar === 12) this.snare(t, 0.22);
    if (inBar % 2 === 0) this.hat(t, inBar % 4 === 2 ? 0.07 : 0.04);
    // Arpeggio: 16ths up and down the chord, for the heat of a fight.
    const pattern = [0, 1, 2, 3, 2, 1, 2, 3];
    const n = notes[pattern[inBar % pattern.length] % notes.length];
    this.pluck(freq(root + 24 + n), t, 0.25, 0.045, this.layers.arp);
  }

  // ---- Instruments ------------------------------------------------------------------

  /** A soft, wide pad note: two detuned saws through a slowly opening filter. */
  private padNote(f: number, t: number, len: number, gain: number): void {
    const ctx = this.ctx!;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(gain, t + Math.min(1.6, len * 0.4));
    env.gain.setTargetAtTime(0.0001, t + len - 1, 0.5);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400, t);
    filter.frequency.linearRampToValueAtTime(1300, t + len * 0.5);
    filter.Q.value = 0.6;
    filter.connect(env).connect(this.layers.pad);
    for (const det of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(filter);
      o.start(t);
      o.stop(t + len + 2);
    }
  }

  private bassNote(f: number, t: number, len: number, gain: number, out: GainNode = this.layers.bass): void {
    const ctx = this.ctx!;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    filter.connect(env).connect(out);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = f / 2;
    o.connect(filter);
    sub.connect(filter);
    for (const x of [o, sub]) {
      x.start(t);
      x.stop(t + len + 0.1);
    }
  }

  private pluck(f: number, t: number, len: number, gain: number, out: GainNode): void {
    const ctx = this.ctx!;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3500, t);
    filter.frequency.exponentialRampToValueAtTime(600, t + len);
    filter.connect(env).connect(out);
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    o.connect(filter);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  private kick(t: number, gain: number): void {
    const ctx = this.ctx!;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    env.connect(this.layers.drums);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    o.connect(env);
    o.start(t);
    o.stop(t + 0.4);
  }

  private noiseHit(t: number, gain: number, type: BiquadFilterType, f: number, len: number, out: GainNode): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = f;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(filter).connect(env).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + len + 0.05);
  }

  private snare(t: number, gain: number): void {
    this.noiseHit(t, gain, 'bandpass', 1800, 0.18, this.layers.drums);
  }

  private hat(t: number, gain: number): void {
    this.noiseHit(t, gain, 'highpass', 7000, 0.05, this.layers.drums);
  }

  /** A deep cinematic hit with a little swell of noise. */
  private boom(t: number, gain: number): void {
    const ctx = this.ctx!;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
    env.connect(this.layers.drums);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 1.5);
    o.connect(env);
    o.start(t);
    o.stop(t + 2.6);
    this.noiseHit(t, gain * 0.25, 'lowpass', 400, 1.6, this.layers.drums);
  }
}

function smooth(x: number): number {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
}

export const music = new Music();
