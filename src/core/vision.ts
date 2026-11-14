/**
 * Things that block eyesight but not movement or bullets: smoke clouds.
 * Bots (and the minimap) ask here before deciding they can see someone.
 */

interface Cloud {
  x: number;
  y: number;
  z: number;
  /** Current radius (meters); 0 = gone. */
  r: number;
}

const clouds = new Set<Cloud>();

export const vision = {
  /** Add a cloud; change its `r` as it grows and fades, and remove it when it's gone. */
  add(c: Cloud): Cloud {
    clouds.add(c);
    return c;
  },
  remove(c: Cloud): void {
    clouds.delete(c);
  },
  clear(): void {
    clouds.clear();
  },
  /** Does smoke block the line from a to b? (Being inside a cloud blocks it too.) */
  blocked(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    if (!clouds.size) return false;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len2 = dx * dx + dy * dy + dz * dz;
    for (const c of clouds) {
      if (c.r <= 0) continue;
      // Closest point of the segment to the cloud's center.
      let t = len2 > 0 ? ((c.x - ax) * dx + (c.y - ay) * dy + (c.z - az) * dz) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const px = ax + dx * t - c.x, py = ay + dy * t - c.y, pz = az + dz * t - c.z;
      if (px * px + py * py + pz * pz < c.r * c.r) return true;
    }
    return false;
  },
};
