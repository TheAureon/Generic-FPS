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

/** The two music styles (Settings → Music style). */
export type MusicStyle = 'synth' | 'cinematic';

const TRACKS: Record<'menu' | 'match' | 'cine-menu' | 'cine-match', TrackDef> = {
  // Cinematic: C minor, the same theme as the synth menu (one step lower): Cm, Ab, Eb, Bb.
  'cine-menu': { bpm: 76, barsPerChord: 1, chords: [[48, MIN], [44, MAJ], [39, MAJ], [46, MAJ]] },
  // Cinematic match: C minor, low and tense: Cm, Cm, Ab, Bb, Cm, Cm, Fm, G.
  'cine-match': { bpm: 96, barsPerChord: 1, chords: [[48, MIN], [48, MIN], [44, MAJ], [46, MAJ], [48, MIN], [48, MIN], [41, MIN], [43, [0, 4, 7, 10]]] },
  // D minor: Dm(add9), Bb(maj7), F, C(sus) — one bar each, in a piece of 8 sections (see MENU_SECTIONS).
  menu: { bpm: 84, barsPerChord: 1, chords: [[50, [0, 3, 7, 14]], [46, MAJ], [41, [0, 4, 7, 14]], [48, SUS]] },
  // E minor, tense and driving when it builds: Em, Em, C, D, Em, Em, Am, B.
  match: { bpm: 104, barsPerChord: 1, chords: [[52, MIN], [52, MIN], [48, MAJ], [50, MAJ], [52, MIN], [52, MIN], [45, MIN], [47, [0, 4, 7, 10]]] },
};

const freq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * The menu piece: 8 sections of 8 bars (about 3 minutes, then it starts over).
 * Each says which parts play.
 */
interface Section { arp?: boolean; bass?: boolean; lead?: boolean; drums?: 0 | 1 | 2; bells?: boolean; dark?: boolean; rise?: boolean; boom?: boolean; up?: boolean }
const MENU_SECTIONS: Section[] = [
  { boom: true }, // intro: pads and a deep hit
  { arp: true, bass: true, rise: true }, // the arpeggio comes in, opening up; a whoosh into...
  { arp: true, bass: true, lead: true, drums: 1, boom: true }, // the melody, with soft drums
  { arp: true, bass: true, lead: true, drums: 2, up: true, rise: true }, // full: melody an octave up, bigger drums
  { bells: true, dark: true, boom: true }, // breakdown: dark pads and bells
  { arp: true, bass: true, bells: true, drums: 1, rise: true }, // building again
  { arp: true, bass: true, lead: true, drums: 2, boom: true }, // full again
  { arp: true, dark: true }, // outro: fading out to the start
];

/** The melody: [step in the 4 bars (16 per bar), MIDI note, length in steps]. Two phrases: a call and an answer. */
const MELODY: [number, number, number][][] = [
  [[0, 69, 6], [6, 65, 2], [8, 67, 4], [12, 69, 4], [16, 74, 8], [24, 72, 4], [28, 70, 4], [32, 69, 8], [40, 67, 4], [44, 65, 4], [48, 64, 6], [54, 65, 2], [56, 67, 8]],
  [[0, 69, 4], [4, 74, 4], [8, 77, 6], [14, 76, 2], [16, 74, 8], [24, 77, 4], [28, 74, 4], [32, 72, 6], [38, 69, 2], [40, 72, 4], [44, 77, 4], [48, 76, 12], [60, 74, 4]],
];

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
  private hooked = false;
  /** The style now playing (a change in Settings crossfades to the other one). */
  private style: MusicStyle = 'synth';

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

    const wantedStyle = settings.get().musicStyle ?? 'synth';
    if ((this.wanted !== this.track || (this.track !== null && wantedStyle !== this.style)) && !this.switching) {
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
    if ((settings.get().musicStyle ?? 'synth') === 'cinematic') {
      if (win) {
        // Brass fanfare, a timpani hit, and the whole orchestra on a bright major chord.
        [60, 64, 67].forEach((n, i) => this.brass(freq(n), t + i * 0.16, 0.3, 0.07));
        this.timpani(freq(36), t + 0.48, 0.5);
        for (const n of [48, 55, 60, 64, 67, 72]) this.strings(freq(n), t + 0.48, 3.2, 0.03, n % 2 ? 0.4 : -0.4);
        for (const n of [60, 64, 67]) this.brass(freq(n), t + 0.48, 2.6, 0.06);
        this.choir(freq(72), t + 0.48, 3, 0.04);
        this.cymbal(t + 0.48, 2.5, 0.12, false);
      } else {
        // A low brass fall over a dark minor chord and a final drum.
        [67, 63, 60].forEach((n, i) => this.brass(freq(n - 12), t + i * 0.3, 0.5, 0.06));
        for (const n of [36, 43, 48, 51]) this.strings(freq(n), t + 0.9, 3.6, 0.035);
        this.choir(freq(63), t + 0.9, 3.2, 0.035);
        this.taiko(t + 0.9, 0.6);
      }
      return;
    }
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
    if (!this.hooked) {
      // (Once only, even if the music is rebuilt.)
      this.hooked = true;
      settings.onChange((s) => this.volume && this.ctx && this.volume.gain.setTargetAtTime(LEVEL * s.musicVolume, this.ctx.currentTime, 0.1));
      // Keep scheduling on its own timer too, so a slow frame never leaves a gap in the music.
      window.setInterval(() => {
        if (this.ctx && this.track && !this.switching) this.schedule();
      }, 100);
      // If the sound engine had to rebuild its mixer, start the music over with fresh parts.
      audio.onReset(() => {
        this.volume?.disconnect();
        this.ctx = null;
        this.track = null;
        this.switching = false;
      });
    }
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

  }

  private start(track: MusicTrack): void {
    this.track = track;
    this.style = settings.get().musicStyle ?? 'synth';
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
    const cine = this.style === 'cinematic';
    const def = TRACKS[`${cine ? 'cine-' : ''}${this.track as 'menu' | 'match'}`];
    const stepLen = 60 / def.bpm / 4; // 16th notes
    // After a long pause in scheduling (e.g. a hidden tab), don't play a backlog.
    if (this.nextTime < ctx.currentTime - 0.5) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      if (this.track === 'menu') (cine ? this.cineMenuStep : this.menuStep).call(this, this.step, this.nextTime, stepLen, def);
      else (cine ? this.cineMatchStep : this.matchStep).call(this, this.step, this.nextTime, stepLen, def);
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
    const { chord, first } = this.chordAt(step, def);
    const [root, notes] = chord;
    const bar = Math.floor(step / 16), inBar = step % 16;
    const sec = MENU_SECTIONS[Math.floor(bar / 8) % MENU_SECTIONS.length];
    const barInSec = bar % 8, progress = (barInSec * 16 + inBar) / 128; // 0..1 through the section
    const barLen = s * 16;

    // Pads: the chord, wide in stereo; darker in the breakdown and the outro.
    if (first) {
      const bright = sec.dark ? 700 : 1500;
      notes.forEach((n, i) => this.padNote(freq(root + 12 + n), t, barLen + 1.2, 0.04, bright, i % 2 ? 0.5 : -0.5));
      this.padNote(freq(root), t, barLen + 1.2, 0.03, bright * 0.6);
      if (barInSec === 0 && sec.boom) this.boom(t, 0.55);
    }
    // Bass: long root notes, or a gentle syncopated pulse once things get going.
    if (sec.bass) {
      if (inBar === 0 || inBar === 6 || inBar === 10) this.bassNote(freq(root - 12), t, s * (inBar === 0 ? 5 : 3.5), inBar === 0 ? 0.26 : 0.16);
    } else if (inBar === 0) this.bassNote(freq(root - 12), t, barLen * 0.95, 0.2);

    // Arpeggio: 16ths over two octaves, bouncing left and right; its filter opens through the
    // build-up and closes in the outro.
    if (sec.arp) {
      const pattern = [0, 1, 2, 3, 4, 3, 2, 1];
      const k = pattern[inBar % 8];
      const n = root + 24 + (k < notes.length ? notes[k] : notes[k - notes.length] + 12);
      const open = MENU_SECTIONS.indexOf(sec) === 1 ? 800 + 4200 * progress : sec.dark ? 5000 - 4000 * progress : 5000;
      this.pluck(freq(n), t, 0.35, inBar % 4 === 0 ? 0.075 : 0.05, this.layers.arp, open, inBar % 2 ? 0.45 : -0.45);
    }

    // The melody (call in bars 1-4, answer in 5-8 of the section).
    if (sec.lead || sec.bells) {
      const phrase = MELODY[barInSec < 4 ? 0 : 1];
      const pos = (barInSec % 4) * 16 + inBar;
      for (const [at, note, len] of phrase) {
        if (at !== pos) continue;
        if (sec.lead) this.leadNote(freq(note + (sec.up ? 12 : 0)), t, len * s, 0.1);
        if (sec.lead && sec.up) this.leadNote(freq(note), t, len * s, 0.03); // the octave below, for weight
        if (sec.bells) this.bell(freq(note + 12), t, 0.08);
      }
    }

    // Drums: soft (kick, rim, shaker), or full (plus snare and toms filling the last bar).
    if (sec.drums) {
      const full = sec.drums === 2;
      if (inBar === 0 || (full && inBar === 10)) this.kick(t, full ? 0.5 : 0.35);
      if (inBar === 8) full ? this.snare(t, 0.2) : this.noiseHit(t, 0.12, 'bandpass', 3200, 0.06, this.layers.drums);
      if (inBar % 2 === 0) this.noiseHit(t, inBar % 4 === 2 ? 0.035 : 0.02, 'highpass', 8000, 0.04, this.layers.drums);
      if (full && barInSec === 7 && inBar >= 8 && inBar % 2 === 0) this.tom(t, 180 - (inBar - 8) * 14, 0.3);
    }
    // A rising whoosh in the last two bars, into the next section.
    if (sec.rise && barInSec === 6 && inBar === 0) this.riser(t, barLen * 2);
  }

  // ---- Cinematic ---------------------------------------------------------------------

  /** The cinematic menu piece: the same 8 sections as the synth one, played by an orchestra. */
  private cineMenuStep(step: number, t: number, s: number, def: TrackDef): void {
    const { chord, first } = this.chordAt(step, def);
    const [root, notes] = chord;
    const bar = Math.floor(step / 16), inBar = step % 16;
    const secIndex = Math.floor(bar / 8) % MENU_SECTIONS.length, sec = MENU_SECTIONS[secIndex];
    const barInSec = bar % 8;
    const barLen = s * 16;

    // Low strings and cellos hold the chord; the choir joins once it gets going.
    if (first) {
      this.strings(freq(root - 12), t, barLen + 0.6, 0.045);
      notes.slice(0, 3).forEach((n, i) => this.strings(freq(root + n), t, barLen + 0.6, 0.03, (i - 1) * 0.5));
      if (sec.lead || sec.bells || secIndex === 5) this.choir(freq(root + 12 + notes[1]), t, barLen + 0.8, sec.dark ? 0.03 : 0.04);
      if (barInSec === 0 && sec.boom) {
        this.taiko(t, 0.7);
        this.cymbal(t, 2.5, 0.07, false);
      }
    }
    // Short string notes repeating on the root (the "ostinato" that drives film music).
    if (sec.arp) {
      const pat = [0, 0, 12, 0, 7, 0, 12, 7];
      this.stringStab(freq(root + pat[inBar % 8]), t, s * 1.4, inBar % 4 === 0 ? 0.055 : 0.04, inBar % 2 ? 0.35 : -0.35);
    }
    // The theme: horns, then violins an octave up in the full sections (with horns below).
    if (sec.lead || sec.bells) {
      const phrase = MELODY[barInSec < 4 ? 0 : 1];
      const pos = (barInSec % 4) * 16 + inBar;
      for (const [at, note, len] of phrase) {
        if (at !== pos) continue;
        const n = note - 2; // (C minor)
        if (sec.bells) this.harp(freq(n + 12), t, 0.08);
        else if (sec.up) {
          this.strings(freq(n + 12), t, len * s + 0.2, 0.045, 0.15);
          this.brass(freq(n), t, len * s, 0.04);
        } else this.brass(freq(n), t, len * s, 0.06);
      }
    }
    // Drums: taiko on the beat, bigger with timpani in the full sections, a roll into what's next.
    if (sec.drums) {
      const full = sec.drums === 2;
      if (inBar === 0 || inBar === 8) this.taiko(t, full ? 0.6 : 0.42);
      if (full && (inBar === 6 || inBar === 14)) this.taiko(t, 0.3);
      if (full && inBar === 0) this.timpani(freq(root - 24), t, 0.35);
      if (full && barInSec === 7 && inBar >= 8) this.timpani(freq(root - 24), t, 0.12 + (inBar - 8) * 0.04);
    }
    // A swelling cymbal and timpani roll in the last two bars before the big sections.
    if (sec.rise && barInSec === 6 && inBar === 0) this.cymbal(t, barLen * 2, 0.1, true);
    if (sec.rise && barInSec === 7 && inBar % 2 === 0) this.timpani(freq(root - 24), t, 0.06 + inBar * 0.015);
  }

  /** Cinematic match: tense low strings; when it builds, driving short strings, taiko, then brass. */
  private cineMatchStep(step: number, t: number, s: number, def: TrackDef): void {
    const { chord, first } = this.chordAt(step, def);
    const [root, notes] = chord;
    const inBar = step % 16;
    const barLen = s * 16;
    if (first) {
      this.strings(freq(root - 12), t, barLen + 0.5, 0.05, 0, this.layers.pad);
      this.strings(freq(root + notes[1]), t, barLen + 0.5, 0.025, 0.3, this.layers.pad);
    }
    // Ostinato: 8ths, then 16ths as it heats up (the bass layer's loudness decides).
    this.stringStab(freq(root + (inBar % 4 === 2 ? 12 : 0)), t, s * 1.2, inBar % 4 === 0 ? 0.06 : 0.04, inBar % 2 ? 0.3 : -0.3, this.layers.bass);
    // Taiko pattern.
    if (inBar === 0 || inBar === 6 || inBar === 8) this.taiko(t, inBar === 0 ? 0.6 : 0.4, this.layers.drums);
    if (inBar === 12 || inBar === 14) this.taiko(t, 0.25, this.layers.drums);
    // Brass: punchy stabs on the chord at the height of a fight.
    if (inBar === 0 || inBar === 10) for (const n of notes.slice(0, 3)) this.brass(freq(root + 12 + n), t, s * 3, 0.03, this.layers.arp);
  }

  /** A string section note: several detuned saws, a slow swell and a soft vibrato. */
  private strings(f: number, t: number, len: number, gain: number, pan = 0, out: GainNode = this.layers.pad): void {
    const ctx = this.ctx!;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(gain, t + Math.min(0.5, len * 0.3));
    env.gain.setTargetAtTime(0.0001, t + len - 0.25, 0.25);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = Math.min(5000, f * 6 + 800);
    filter.Q.value = 0.5;
    filter.connect(env).connect(this.panned(pan, out));
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.3;
    const vibAmt = ctx.createGain();
    vibAmt.gain.value = f * 0.004;
    vib.connect(vibAmt);
    for (const det of [-14, -5, 6, 13]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      vibAmt.connect(o.frequency);
      o.connect(filter);
      o.start(t);
      o.stop(t + len + 1);
    }
    vib.start(t);
    vib.stop(t + len + 1);
  }

  /** A short, bowed string note (spiccato). */
  private stringStab(f: number, t: number, len: number, gain: number, pan = 0, out: GainNode = this.layers.arp): void {
    const ctx = this.ctx!;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3200, t);
    filter.frequency.exponentialRampToValueAtTime(700, t + len);
    filter.connect(env).connect(this.panned(pan, out));
    for (const det of [-9, 9]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(filter);
      o.start(t);
      o.stop(t + len + 0.05);
    }
  }

  /** A horn / brass note: the tone brightens as it swells, like a player pushing air. */
  private brass(f: number, t: number, len: number, gain: number, out: GainNode = this.layers.arp): void {
    const ctx = this.ctx!;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.12);
    env.gain.setTargetAtTime(0.0001, t + Math.max(0.1, len), 0.2);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2;
    filter.frequency.setValueAtTime(f * 1.5, t);
    filter.frequency.linearRampToValueAtTime(Math.min(4500, f * 6), t + 0.25);
    filter.frequency.setTargetAtTime(f * 3, t + 0.3, 0.6);
    filter.connect(env).connect(out);
    for (const det of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(filter);
      o.start(t);
      o.stop(t + len + 1);
    }
  }

  /** A choir "aah": a buzzy tone shaped by two voice-like resonances. */
  private choir(f: number, t: number, len: number, gain: number): void {
    const ctx = this.ctx!;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(gain, t + Math.min(1, len * 0.4));
    env.gain.setTargetAtTime(0.0001, t + len - 0.4, 0.35);
    env.connect(this.layers.pad);
    for (const [ff, q, g] of [[800, 6, 1], [1150, 8, 0.6], [2900, 10, 0.25]]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = ff;
      bp.Q.value = q;
      const bg = ctx.createGain();
      bg.gain.value = g * 4;
      bp.connect(bg).connect(env);
      for (const det of [-8, 8]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = det;
        o.connect(bp);
        o.start(t);
        o.stop(t + len + 1);
      }
    }
  }

  /** A harp pluck: bright and quick, ringing into the reverb. */
  private harp(f: number, t: number, gain: number): void {
    const ctx = this.ctx!;
    for (const [mult, g, decay] of [[1, 1, 1.6], [2, 0.4, 0.8], [3, 0.15, 0.4]]) {
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(gain * g, t + 0.003);
      env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      env.connect(this.layers.arp);
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f * mult;
      o.connect(env);
      o.start(t);
      o.stop(t + decay + 0.05);
    }
  }

  /** A big taiko drum: a deep thump and a slap of skin. */
  private taiko(t: number, gain: number, out: GainNode = this.layers.drums): void {
    const ctx = this.ctx!;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain * 0.75, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    env.connect(out);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.25);
    o.connect(env);
    o.start(t);
    o.stop(t + 1);
    this.noiseHit(t, gain * 0.5, 'lowpass', 900, 0.12, out);
  }

  /** Timpani: a tuned drum with a ringing tone. */
  private timpani(f: number, t: number, gain: number): void {
    const ctx = this.ctx!;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    env.connect(this.layers.drums);
    for (const [mult, g] of [[1, 1], [1.5, 0.4], [1.99, 0.25]]) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(f * mult * 1.02, t);
      o.frequency.exponentialRampToValueAtTime(f * mult, t + 0.1);
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(env);
      o.start(t);
      o.stop(t + 1.5);
    }
    this.noiseHit(t, gain * 0.3, 'lowpass', 500, 0.08, this.layers.drums);
  }

  /** A cymbal: a crash that rings out, or a swell that rises into the next section. */
  private cymbal(t: number, len: number, gain: number, swell: boolean): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 5000;
    const env = ctx.createGain();
    if (swell) {
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(gain, t + len * 0.97);
      env.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.05);
    } else {
      env.gain.setValueAtTime(gain, t);
      env.gain.exponentialRampToValueAtTime(0.0001, t + len);
    }
    src.connect(filter).connect(env).connect(this.layers.drums);
    src.start(t);
    src.stop(t + len + 0.1);
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
  private padNote(f: number, t: number, len: number, gain: number, bright = 1300, pan = 0): void {
    const ctx = this.ctx!;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(gain, t + Math.min(1.6, len * 0.4));
    env.gain.setTargetAtTime(0.0001, t + len - 1, 0.5);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400, t);
    filter.frequency.linearRampToValueAtTime(bright, t + len * 0.5);
    filter.Q.value = 0.6;
    filter.connect(env).connect(this.panned(pan, this.layers.pad));
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

  private pluck(f: number, t: number, len: number, gain: number, out: GainNode, bright = 3500, pan = 0): void {
    const ctx = this.ctx!;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(bright, t);
    filter.frequency.exponentialRampToValueAtTime(Math.min(600, bright * 0.5), t + len);
    filter.connect(env).connect(this.panned(pan, out));
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    o.connect(filter);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  /** Send `out` through a stereo pan (-1 left .. 1 right), if the browser has one. */
  private panned(pan: number, out: AudioNode): AudioNode {
    if (!pan || !this.ctx!.createStereoPanner) return out;
    const p = this.ctx!.createStereoPanner();
    p.pan.value = pan;
    p.connect(out);
    return p;
  }

  /** The lead: two slightly detuned voices (saw + triangle), a soft attack and a gentle vibrato. */
  private leadNote(f: number, t: number, len: number, gain: number): void {
    const ctx = this.ctx!;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.06);
    env.gain.setTargetAtTime(gain * 0.7, t + 0.1, 0.3);
    env.gain.setTargetAtTime(0.0001, t + len, 0.18);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3600;
    filter.Q.value = 1.2;
    filter.connect(env);
    env.connect(this.layers.arp); // (shares the echo and reverb with the arpeggio)
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.2;
    const vibAmt = ctx.createGain();
    vibAmt.gain.setValueAtTime(0, t);
    vibAmt.gain.linearRampToValueAtTime(f * 0.006, t + Math.min(0.5, len)); // vibrato fades in on long notes
    vib.connect(vibAmt);
    for (const [type, det, g] of [['sawtooth', -5, 0.5], ['triangle', 5, 1]] as [OscillatorType, number, number][]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = det;
      vibAmt.connect(o.frequency);
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(filter);
      o.start(t);
      o.stop(t + len + 1);
    }
    vib.start(t);
    vib.stop(t + len + 1);
  }

  /** A bell: a sine with two bright overtones that ring off quickly. */
  private bell(f: number, t: number, gain: number): void {
    const ctx = this.ctx!;
    for (const [mult, g, decay] of [[1, 1, 2.2], [2.76, 0.35, 0.9], [5.4, 0.15, 0.4]]) {
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(gain * g, t + 0.004);
      env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      env.connect(this.layers.arp);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mult;
      o.connect(env);
      o.start(t);
      o.stop(t + decay + 0.05);
    }
  }

  private tom(t: number, f: number, gain: number): void {
    const ctx = this.ctx!;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    env.connect(this.layers.drums);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.3);
    o.connect(env);
    o.start(t);
    o.stop(t + 0.45);
  }

  /** A swell of filtered noise rising into the next section. */
  private riser(t: number, len: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(300, t);
    filter.frequency.exponentialRampToValueAtTime(5000, t + len);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.09, t + len * 0.97);
    env.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.08);
    src.connect(filter).connect(env).connect(this.layers.drums);
    src.start(t);
    src.stop(t + len + 0.1);
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
