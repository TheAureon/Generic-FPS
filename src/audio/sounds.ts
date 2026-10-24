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
  | 'impact'
  | 'hurt'
  | 'armor_hit'
  | 'whiz'
  | 'death'
  | 'bot_death'
  | 'pickup'
  | 'wave_start'
  | 'win'
  | 'lose'
  | 'ui_click'
  | 'title_start'
  | 'step'
  | 'land'
  | 'objective_good'
  | 'objective_bad'
  | 'objective_info'
  | 'medal'
  | 'callout'
  | 'callout_big'
  | 'tick'
  | 'levelup'
  | 'stat_slam';

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
  hurt: (s) => {
    // A dull body thump.
    noiseBurst(s, { type: 'lowpass', freq: 420, gain: 0.8, decay: 0.16 });
    tone(s, { type: 'sine', from: 140, to: 60, gain: 0.6, decay: 0.14 });
  },
  armor_hit: (s) => {
    tone(s, { type: 'triangle', from: 900, to: 700, gain: 0.2, decay: 0.12 });
    noiseBurst(s, { type: 'bandpass', freq: 3200, q: 3, gain: 0.25, decay: 0.05 });
  },
  whiz: (s) => {
    // A bullet zipping past your head.
    noiseBurst(s, { type: 'bandpass', freq: 5000, q: 6, gain: 0.35, decay: 0.09, attack: 0.03 });
    tone(s, { type: 'sine', from: 2400, to: 1300, gain: 0.05, decay: 0.12, attack: 0.02 });
  },
  death: (s) => {
    tone(s, { type: 'sawtooth', from: 220, to: 40, gain: 0.25, decay: 0.9 });
    noiseBurst(s, { type: 'lowpass', freq: 300, gain: 0.7, decay: 0.5 });
  },
  bot_death: (s) => {
    tone(s, { type: 'square', from: 300, to: 70, gain: 0.12, decay: 0.45 });
    noiseBurst(s, { type: 'lowpass', freq: 500, gain: 0.5, decay: 0.3, delay: 0.25 });
  },
  pickup: (s) => {
    tone(s, { type: 'triangle', from: 660, to: 660, gain: 0.2, decay: 0.08 });
    tone(s, { type: 'triangle', from: 990, to: 990, gain: 0.2, decay: 0.14, delay: 0.07 });
  },
  wave_start: (s) => {
    // Low warning horn, twice.
    tone(s, { type: 'sawtooth', from: 180, to: 170, gain: 0.18, decay: 0.45, attack: 0.05 });
    tone(s, { type: 'sawtooth', from: 180, to: 170, gain: 0.18, decay: 0.6, attack: 0.05, delay: 0.55 });
  },
  win: (s) => {
    [523, 659, 784, 1046].forEach((f, i) => tone(s, { type: 'triangle', from: f, to: f, gain: 0.2, decay: 0.3, delay: i * 0.13 }));
  },
  lose: (s) => {
    [392, 330, 262].forEach((f, i) => tone(s, { type: 'triangle', from: f, to: f * 0.97, gain: 0.2, decay: 0.45, delay: i * 0.22 }));
  },
  // Game-mode cues: your team did something good / the enemy did / something changed.
  objective_good: (s) => {
    [587, 784, 988].forEach((f, i) => tone(s, { type: 'triangle', from: f, to: f, gain: 0.16, decay: 0.18, delay: i * 0.08 }));
  },
  objective_bad: (s) => {
    [494, 392, 311].forEach((f, i) => tone(s, { type: 'square', from: f, to: f * 0.98, gain: 0.07, decay: 0.2, delay: i * 0.1 }));
  },
  objective_info: (s) => {
    tone(s, { type: 'sine', from: 880, to: 880, gain: 0.14, decay: 0.12 });
    tone(s, { type: 'sine', from: 660, to: 660, gain: 0.14, decay: 0.2, delay: 0.12 });
  },
  // ---- Rewards ----
  medal: (s) => {
    // A bright two-note shimmer.
    tone(s, { type: 'triangle', from: 1318, to: 1318, gain: 0.16, decay: 0.16 });
    tone(s, { type: 'triangle', from: 1976, to: 1976, gain: 0.14, decay: 0.3, delay: 0.07 });
    tone(s, { type: 'sine', from: 3951, to: 3951, gain: 0.04, decay: 0.35, delay: 0.07 });
  },
  callout: (s) => {
    // A punchy hit and a rising major chord.
    tone(s, { type: 'sine', from: 120, to: 50, gain: 0.55, decay: 0.25 });
    noiseBurst(s, { type: 'lowpass', freq: 900, gain: 0.35, decay: 0.18 });
    [659, 831, 988].forEach((f, i) => tone(s, { type: 'sawtooth', from: f * 0.98, to: f, gain: 0.05, decay: 0.45, delay: 0.02 + i * 0.05 }));
    [659, 831, 988].forEach((f, i) => tone(s, { type: 'triangle', from: f, to: f, gain: 0.1, decay: 0.5, delay: 0.02 + i * 0.05 }));
  },
  callout_big: (s) => {
    // A deep boom, a whoosh, and a big chord with a shimmer on top.
    tone(s, { type: 'sine', from: 90, to: 32, gain: 0.85, decay: 0.6 });
    noiseBurst(s, { type: 'lowpass', freq: 600, gain: 0.55, decay: 0.45 });
    noiseBurst(s, { type: 'bandpass', freq: 2500, q: 0.8, gain: 0.18, decay: 0.35, attack: 0.08 });
    [523, 659, 784, 1046].forEach((f, i) => {
      tone(s, { type: 'sawtooth', from: f, to: f, gain: 0.045, decay: 0.9, delay: 0.03 + i * 0.04 });
      tone(s, { type: 'triangle', from: f, to: f, gain: 0.09, decay: 0.9, delay: 0.03 + i * 0.04 });
    });
    tone(s, { type: 'sine', from: 2093, to: 2093, gain: 0.05, decay: 1.1, delay: 0.2 });
  },
  tick: (s) => {
    tone(s, { type: 'square', from: 1800 + Math.random() * 200, to: 1600, gain: 0.03, decay: 0.025 });
  },
  levelup: (s) => {
    // A fanfare: quick rising arpeggio into a held chord, with a sparkle.
    [392, 523, 659, 784].forEach((f, i) => tone(s, { type: 'triangle', from: f, to: f, gain: 0.16, decay: 0.18, delay: i * 0.08 }));
    [523, 659, 784, 1046].forEach((f) => {
      tone(s, { type: 'sawtooth', from: f, to: f, gain: 0.05, decay: 1.4, attack: 0.02, delay: 0.34 });
      tone(s, { type: 'triangle', from: f, to: f, gain: 0.12, decay: 1.4, attack: 0.02, delay: 0.34 });
    });
    tone(s, { type: 'sine', from: 70, to: 40, gain: 0.6, decay: 0.7, delay: 0.34 });
    [2093, 2637, 3136].forEach((f, i) => tone(s, { type: 'sine', from: f, to: f, gain: 0.04, decay: 0.4, delay: 0.5 + i * 0.09 }));
  },
  stat_slam: (s) => {
    tone(s, { type: 'sine', from: 160, to: 60, gain: 0.35, decay: 0.15 });
    noiseBurst(s, { type: 'lowpass', freq: 1200, gain: 0.2, decay: 0.08 });
  },
  ui_click: (s) => {
    tone(s, { type: 'sine', from: 900, to: 700, gain: 0.12, decay: 0.04 });
  },
  title_start: (s) => {
    // A rising whoosh into a deep hit.
    noiseBurst(s, { type: 'bandpass', freq: 900, q: 1.2, gain: 0.35, decay: 0.3, attack: 0.25 });
    tone(s, { type: 'sine', from: 70, to: 38, gain: 0.8, decay: 0.9, delay: 0.25 });
    noiseBurst(s, { type: 'lowpass', freq: 500, gain: 0.6, decay: 0.6, delay: 0.25 });
    tone(s, { type: 'triangle', from: 440, to: 440, gain: 0.08, decay: 0.8, delay: 0.27 });
    tone(s, { type: 'triangle', from: 660, to: 660, gain: 0.06, decay: 0.8, delay: 0.27 });
  },
  step: (s) => {
    // Soft scuff of a boot on concrete (slightly different each time).
    noiseBurst(s, { type: 'lowpass', freq: 380 + Math.random() * 220, gain: 0.22, decay: 0.07 });
    noiseBurst(s, { type: 'bandpass', freq: 2200 + Math.random() * 900, q: 2, gain: 0.05, decay: 0.03 });
  },
  land: (s) => {
    noiseBurst(s, { type: 'lowpass', freq: 300, gain: 0.5, decay: 0.14 });
    tone(s, { type: 'sine', from: 90, to: 45, gain: 0.35, decay: 0.12 });
  },
  impact: (s) => {
    noiseBurst(s, { type: 'bandpass', freq: 3000 + Math.random() * 1500, q: 2, gain: 0.12, decay: 0.04 });
  },
};
