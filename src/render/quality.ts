import { CONFIG } from '../config';
import { settings } from '../core/Settings';

export type QualityProfile = (typeof CONFIG.quality)['high'];

/** The graphics preset picked in Settings. */
export function currentQuality(): QualityProfile {
  return CONFIG.quality[settings.get().quality] ?? CONFIG.quality.high;
}
