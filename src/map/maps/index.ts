import type { MapDef } from '../MapTypes';
import { foundry } from './foundry';
import { testRoom } from './testRoom';

/** Every playable map. Add new maps to this list. */
export const MAPS: MapDef[] = [foundry, testRoom];

export function getMap(id: string): MapDef {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}
