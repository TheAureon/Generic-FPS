/**
 * Procedural sound effects, built from noise and oscillators with the Web
 * Audio API. No audio files needed.
 *
 * To use a real recording instead, put the file in `public/sounds/` and add
 * it to SAMPLE_FILES below, e.g. `shot_rifle: '/sounds/rifle.wav'`.
 * Recordings override the generated sound with the same name.
 */

export type SoundId =
  | 'shot_pistol'
  | 'shot_rifle'
  | 'shot_shotgun'
  | 'shot_sniper'
  | 'reload_start'
  | 'reload_end'
  | 'shell_insert'
  | 'dry_fire'
  | 'weapon_switch'
  | 'hit'
  | 'hit_head'
  | 'kill'
  | 'impact';

export const SAMPLE_FILES: Partial<Record<SoundId, string>> = {};

/** Context handed to each sound generator. */
export interface SynthCtx {
  ctx: AudioContext;
  out: AudioNode;
  t: number;
  noise: AudioBuffer;
}

type Synth = (s: SynthCtx) => void;

// ---- Building blocks -------------------------------------------------------

function env(s: SynthCtx, peak: number, attack: number, decay: number): GainNode {
  const g = s.ctx.createGain();
  g.gain.setValueAtTime(0.0001, s.t);
  g.gain.exponentialRampToValueAtTime(peak, s.t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, s.t + attack + decay);
  g.connect(s.out);
  return g;
}

function noiseBurst(
  s: SynthCtx,
  o: { type: BiquadFilterType; freq: number; q?: number; gain: number; decay: number; attack?: number; delay?: number },
): void {
  const sub = { ...s, t: s.t + (o.delay ?? 0) };
  const src = s.ctx.createBufferSource();
  src.buffer = s.noise;
  src.playbackRate.value = 0.9 + Math.random() * 0.2;
  const f = s.ctx.createBiquadFilter();
  f.type = o.type;
  f.frequency.value = o.freq;
  f.Q.value = o.q ?? 0.8;
  src.connect(f).connect(env(sub, o.gain, o.attack ?? 0.002, o.decay));
  // Random start offset so repeated shots don't sound identical.
  src.start(sub.t, Math.random() * 1.0);
  src.stop(sub.t + (o.attack ?? 0.002) + o.decay + 0.05);
}

function tone(
  s: SynthCtx,
  o: { type: OscillatorType; from: number; to: number; gain: number; decay: number; attack?: number; delay?: number },
): void {
  const sub = { ...s, t: s.t + (o.delay ?? 0) };
  const osc = s.ctx.createOscillator();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.from, sub.t);
  osc.frequency.exponentialRampToValueAtTime(o.to, sub.t + o.decay);
  osc.connect(env(sub, o.gain, o.attack ?? 0.002, o.decay));
  osc.start(sub.t);
  osc.stop(sub.t + (o.attack ?? 0.002) + o.decay + 0.05);
}

// ---- The sounds ------------------------------------------------------------

export const SYNTHS: Record<SoundId, Synth> = {
  shot_pistol: (s) => {
    noiseBurst(s, { type: 'bandpass', freq: 1800, q: 0.7, gain: 0.9, decay: 0.12 });
    noiseBurst(s, { type: 'lowpass', freq: 600, gain: 0.6, decay: 0.18 });
    tone(s, { type: 'sine', from: 180, to: 50, gain: 0.7, decay: 0.12 });
  },
  shot_rifle: (s) => {
    noiseBurst(s, { type: 'bandpass', freq: 1300, q: 0.6, gain: 0.85, decay: 0.1 });
    noiseBurst(s, { type: 'lowpass', freq: 500, gain: 0.7, decay: 0.16 });
    tone(s, { type: 'triangle', from: 140, to: 45, gain: 0.6, decay: 0.1 });
  },
  shot_shotgun: (s) => {
    noiseBurst(s, { type: 'lowpass', freq: 2200, gain: 1.0, decay: 0.32 });
    noiseBurst(s, { type: 'lowpass', freq: 350, gain: 0.9, decay: 0.4 });
    tone(s, { type: 'sine', from: 110, to: 30, gain: 0.9, decay: 0.25 });
    // Pump action
    noiseBurst(s, { type: 'bandpass', freq: 2500, q: 3, gain: 0.25, decay: 0.04, delay: 0.38 });
    noiseBurst(s, { type: 'bandpass', freq: 1800, q: 3, gain: 0.25, decay: 0.05, delay: 0.52 });
  },
  shot_sniper: (s) => {
    noiseBurst(s, { type: 'highpass', freq: 2500, gain: 0.8, decay: 0.05 });
    noiseBurst(s, { type: 'lowpass', freq: 1500, gain: 1.0, decay: 0.45 });
    tone(s, { type: 'sine', from: 90, to: 28, gain: 1.0, decay: 0.4 });
    // Echo off distant walls
    noiseBurst(s, { type: 'lowpass', freq: 700, gain: 0.25, decay: 0.6, attack: 0.05, delay: 0.18 });
    // Bolt action
    noiseBurst(s, { type: 'bandpass', freq: 3000, q: 4, gain: 0.2, decay: 0.04, delay: 0.7 });
    noiseBurst(s, { type: 'bandpass', freq: 2200, q: 4, gain: 0.2, decay: 0.05, delay: 0.95 });
  },
  reload_start: (s) => {
    noiseBurst(s, { type: 'bandpass', freq: 2200, q: 4, gain: 0.3, decay: 0.05 });
    noiseBurst(s, { type: 'bandpass', freq: 1400, q: 3, gain: 0.25, decay: 0.07, delay: 0.12 });
  },
  reload_end: (s) => {
    noiseBurst(s, { type: 'bandpass', freq: 1700, q: 3, gain: 0.35, decay: 0.06 });
    tone(s, { type: 'square', from: 400, to: 200, gain: 0.05, decay: 0.05 });
  },
  shell_insert: (s) => {
    noiseBurst(s, { type: 'bandpass', freq: 2600, q: 5, gain: 0.3, decay: 0.05 });
  },
  dry_fire: (s) => {
    noiseBurst(s, { type: 'bandpass', freq: 4000, q: 6, gain: 0.35, decay: 0.025 });
  },
  weapon_switch: (s) => {
    noiseBurst(s, { type: 'bandpass', freq: 1200, q: 2, gain: 0.2, decay: 0.08 });
    noiseBurst(s, { type: 'bandpass', freq: 2400, q: 4, gain: 0.15, decay: 0.04, delay: 0.1 });
  },
  hit: (s) => {
    tone(s, { type: 'triangle', from: 1900, to: 1500, gain: 0.25, decay: 0.05 });
  },
  hit_head: (s) => {
    tone(s, { type: 'triangle', from: 2600, to: 2300, gain: 0.3, decay: 0.08 });
    tone(s, { type: 'sine', from: 3900, to: 3600, gain: 0.12, decay: 0.12 });
  },
  kill: (s) => {
    tone(s, { type: 'triangle', from: 1200, to: 1150, gain: 0.25, decay: 0.08 });
    tone(s, { type: 'triangle', from: 1800, to: 1750, gain: 0.25, decay: 0.15, delay: 0.08 });
  },
  impact: (s) => {
    noiseBurst(s, { type: 'bandpass', freq: 3000 + Math.random() * 1500, q: 2, gain: 0.12, decay: 0.04 });
  },
};
