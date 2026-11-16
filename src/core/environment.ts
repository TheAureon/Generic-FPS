import type { SkyDef } from '../map/MapTypes';

/**
 * Time of day and weather for the current match (picked in the match
 * setup), and how they change what everyone can see.
 */

export type Weather = 'clear' | 'rain' | 'snow' | 'fog';

export const env = {
  night: false,
  weather: 'clear' as Weather,
  /** Your flashlight is on (bots can see the light from far away). */
  flashlight: false,
  /** Your name (bots see you at full range while your flashlight is on). */
  playerName: '',

  /** How far bots can see compared to a clear day (0..1). */
  visionScale(): number {
    const w = this.weather === 'fog' ? 0.45 : this.weather === 'snow' ? 0.7 : this.weather === 'rain' ? 0.8 : 1;
    return w * (this.night ? 0.55 : 1);
  },

  reset(): void {
    this.night = false;
    this.weather = 'clear';
    this.flashlight = false;
  },
};

const lerpColor = (a: number, b: number, t: number) => {
  const ch = (s: number) => {
    const x = (a >> s) & 255, y = (b >> s) & 255;
    return Math.round(x + (y - x) * t) << s;
  };
  return ch(16) | ch(8) | ch(0);
};

/**
 * A map's sky changed for the weather and time of day: grey and overcast
 * for rain, pale for snow and fog, and for night a dark blue sky with dim
 * moonlight (the map's lamps then light things up).
 */
export function skyFor(base: SkyDef, night: boolean, weather: Weather): SkyDef {
  let s: SkyDef = { ...base };
  const grey = (c: number, to: number, t: number) => lerpColor(c, to, t);
  if (weather === 'rain') {
    s = { ...s, zenith: grey(s.zenith, 0x5a626c, 0.75), horizon: grey(s.horizon, 0x7c858e, 0.75), mid: undefined, clouds: 1, cloudColor: 0x5c646e, sunIntensity: (s.sunIntensity ?? 2.4) * 0.4, skyLight: (s.skyLight ?? 1) * 0.85 };
  } else if (weather === 'snow') {
    s = { ...s, zenith: grey(s.zenith, 0xa8b2bd, 0.75), horizon: grey(s.horizon, 0xd2d8de, 0.8), mid: undefined, clouds: 0.95, cloudColor: 0xd6dadf, sunColor: 0xe8eef8, sunIntensity: (s.sunIntensity ?? 2.4) * 0.55, skyLight: (s.skyLight ?? 1) * 1.05 };
  } else if (weather === 'fog') {
    s = { ...s, zenith: grey(s.zenith, 0x9aa3ab, 0.8), horizon: grey(s.horizon, 0xaeb4b9, 0.9), mid: undefined, clouds: 1, cloudColor: 0xb0b5ba, sunIntensity: (s.sunIntensity ?? 2.4) * 0.5 };
  }
  if (night) {
    s = {
      ...s,
      zenith: lerpColor(s.zenith, 0x03060f, 0.9),
      horizon: lerpColor(s.horizon, weather === 'clear' ? 0x0d1424 : 0x161b22, 0.88),
      mid: s.mid !== undefined ? lerpColor(s.mid, 0x070c18, 0.9) : undefined,
      ground: 0x07080a,
      sunColor: 0x8fa6d6,
      sunIntensity: (s.sunIntensity ?? 2.4) * 0.14,
      skyLight: (s.skyLight ?? 1) * 0.22,
      cloudColor: lerpColor(s.cloudColor ?? 0xffffff, 0x1a1f2a, 0.85),
      skylineColor: 0x05070c,
      litWindows: true,
    };
  }
  return s;
}

/** Fog distances for the weather and time of day (from the map's own). */
export function fogFor(near: number, far: number, night: boolean, weather: Weather): [number, number] {
  let k = 1;
  if (weather === 'fog') return [2, night ? 26 : 38];
  if (weather === 'rain') k = 0.6;
  if (weather === 'snow') k = 0.5;
  if (night) k *= 0.6;
  return [near * k, far * k];
}
