import type { MapDef } from '../MapTypes';
import { flatlands } from './flatlands';
import { forest } from './forest';
import { foundry } from './foundry';
import { mountains } from './mountains';
import { museum } from './museum';
import { office } from './office';
import { testRoom } from './testRoom';

/** Every playable map. Add new maps to this list. */
export const MAPS: MapDef[] = [foundry, office, museum, forest, mountains, flatlands, testRoom];

export function getMap(id: string): MapDef {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}
