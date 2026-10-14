import type { MapDef } from '../MapTypes';
import { testRoom } from './testRoom';

/** Every playable map. Add new maps to this list. */
export const MAPS: MapDef[] = [testRoom];

export function getMap(id: string): MapDef {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}
