import { CONFIG } from '../config';

/**
 * Automatic resolution: when the game can't keep up (fewer than about 50
 * frames a second during a match), the 3D view is drawn at a slightly lower
 * resolution until it's smooth again, then sharpened back up when there's
 * room. The HUD and menus always stay sharp.
 *
 * It only keeps a lower resolution if that actually helped: if the frame rate
 * didn't improve (the slowdown was somewhere else, or the browser is limiting
 * the frame rate to save battery), it goes back to the sharper picture.
 *
 * Settings are in `AUTO_RESOLUTION` in config.ts; the Settings menu can switch it off.
 */
const A = CONFIG.autoResolution;

export class AutoResolution {
  /** Multiplies the Graphics setting's resolution (1 = full). */
  scale = 1;
  private frames = 0;
  private time = 0;
  private hitch = false;
  private goodWindows = 0;
  /** Not raised above this (a level that turned out too slow), nor lowered below `floor` (didn't help). */
  private ceiling = 1;
  private floor = A.minScale;
  /** A drop being checked: the scale before it and the frame rate then. */
  private trial: { from: number; fps: number; windows: number } | null = null;

  /** A new match: forget what was learned (a different map can be heavier or lighter). */
  reset(): void {
    this.frames = 0;
    this.time = 0;
    this.hitch = false;
    this.goodWindows = 0;
    this.ceiling = 1;
    this.floor = A.minScale;
    this.trial = null;
  }

  /**
   * Call once per frame while playing, with the frame's real length. Returns
   * true when the scale changed (the renderer's resolution needs updating).
   */
  update(dt: number): boolean {
    this.frames++;
    this.time += dt;
    // A one-off hitch (loading something, switching tabs) isn't a sign of a slow computer.
    if (dt >= 0.1) this.hitch = true;
    if (this.time < A.window) return false;
    const fps = this.frames / this.time;
    const hitch = this.hitch;
    this.frames = 0;
    this.time = 0;
    this.hitch = false;
    if (hitch) return false;

    // Did the last drop help?
    if (this.trial) {
      if (++this.trial.windows < 2) return false;
      const t = this.trial;
      this.trial = null;
      if (fps < t.fps * 1.1 && fps < A.lowFps) {
        // No: go back to the sharper picture, and don't try lowering it again this match.
        this.floor = t.from;
        this.scale = t.from;
        return true;
      }
      return false;
    }

    if (fps < A.lowFps && this.scale > this.floor + 1e-3) {
      this.trial = { from: this.scale, fps, windows: 0 };
      this.ceiling = Math.max(this.floor, this.scale - A.raiseStep);
      this.scale = Math.max(this.floor, this.scale - A.dropStep);
      this.goodWindows = 0;
      return true;
    }
    if (fps >= A.goodFps) {
      // A long smooth stretch at the limit: try a little sharper again (things may have calmed down).
      if (this.goodWindows >= A.windowsBeforeRaise * 5) {
        this.ceiling = Math.min(1, this.ceiling + A.raiseStep);
        this.goodWindows = A.windowsBeforeRaise - 1;
      }
      if (++this.goodWindows >= A.windowsBeforeRaise && this.scale + A.raiseStep <= this.ceiling + 1e-3) {
        this.scale = Math.min(1, this.scale + A.raiseStep);
        this.goodWindows = 0;
        return true;
      }
    } else {
      this.goodWindows = 0;
    }
    return false;
  }
}
