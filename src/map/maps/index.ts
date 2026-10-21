import type { MapDef } from '../MapTypes';
import { flatlands } from './flatlands';
import { foundry } from './foundry';
import { office } from './office';
import { testRoom } from './testRoom';

/** Every playable map. Add new maps to this list. */
export const MAPS: MapDef[] = [foundry, office, flatlands, testRoom];

export function getMap(id: string): MapDef {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}
