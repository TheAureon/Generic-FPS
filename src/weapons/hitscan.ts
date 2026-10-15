import * as THREE from 'three';
import type { WeaponStats } from '../config';
import type { CollisionWorld } from '../core/CollisionWorld';
import type { Damageable, HitPart } from '../core/Hitbox';

/**
 * "Hitscan" = bullets travel instantly along a straight line. This traces
 * that line against the map and every target and reports what it hit first.
 */
export interface ShotResult {
  /** Where the bullet stopped. */
  point: THREE.Vector3;
  distance: number;
  /** Surface normal if it hit the map. */
  normal: THREE.Vector3 | null;
  target: Damageable | null;
  part: HitPart | null;
}

export function traceShot(
  world: CollisionWorld,
  targets: readonly Damageable[],
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  range: number,
  ignore?: Damageable,
): ShotResult {
  let distance = range;
  let normal: THREE.Vector3 | null = null;
  let target: Damageable | null = null;
  let part: HitPart | null = null;

  const wall = world.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, range);
  if (wall) {
    distance = wall.distance;
    normal = new THREE.Vector3(wall.nx, wall.ny, wall.nz);
  }

  // Walls are checked first, so a target behind a wall can never be hit.
  for (const t of targets) {
    if (t === ignore || !t.isAlive()) continue;
    const h = t.hitbox.raycast(origin, dir, distance);
    if (h && h.distance < distance) {
      distance = h.distance;
      target = t;
      part = h.part;
      normal = null;
    }
  }

  return {
    point: origin.clone().addScaledVector(dir, distance),
    distance,
    normal,
    target,
    part,
  };
}

/** Damage after distance falloff and headshot bonus. */
export function shotDamage(stats: WeaponStats, distance: number, part: HitPart): number {
  let mult = 1;
  if (distance > stats.falloffStart) {
    const t = Math.min(1, (distance - stats.falloffStart) / Math.max(0.001, stats.falloffEnd - stats.falloffStart));
    mult = 1 + (stats.falloffMinMultiplier - 1) * t;
  }
  if (part === 'head') mult *= stats.headshotMultiplier;
  return stats.damage * mult;
}

const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Randomly tilts `dir` by up to `spreadDeg` degrees. Uses a uniform spread
 * across the cone, so shots land anywhere inside the crosshair circle.
 */
export function applySpread(dir: THREE.Vector3, spreadDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  out.copy(dir);
  if (spreadDeg <= 0) return out;
  const maxTan = Math.tan((spreadDeg * Math.PI) / 180);
  const r = Math.sqrt(Math.random()) * maxTan;
  const a = Math.random() * Math.PI * 2;
  _right.crossVectors(dir, WORLD_UP);
  if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
  _right.normalize();
  _up.crossVectors(_right, dir).normalize();
  out.addScaledVector(_right, Math.cos(a) * r).addScaledVector(_up, Math.sin(a) * r);
  return out.normalize();
}
