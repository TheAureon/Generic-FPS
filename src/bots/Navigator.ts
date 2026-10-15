import * as THREE from 'three';
import type { NavGraph } from './NavGraph';

/**
 * Follows a path from the NavGraph: hands out the next waypoint to walk
 * toward, notices when the bot is stuck, and re-plans when needed.
 */
export class Navigator {
  path: THREE.Vector3[] = [];
  index = 0;
  readonly goal = new THREE.Vector3();
  hasGoal = false;
  /** True after the last waypoint was reached. */
  arrived = false;
  /** True if the last plan found no route. */
  failed = false;

  private stuckTimer = 0;
  private shortcutTimer = 0;
  private stuckCount = 0;
  private lastPos = new THREE.Vector3();

  constructor(
    private nav: NavGraph,
    private position: THREE.Vector3,
  ) {}

  /**
   * Head for `goal`. Re-plans only if the goal moved more than `tolerance`
   * meters (planning every frame would be wasteful).
   */
  setGoal(goal: THREE.Vector3, tolerance = 1.5): void {
    // Same goal as before: keep the current plan (and keep "arrived"/"failed"
    // so the brain can react to them).
    if (this.hasGoal && this.goal.distanceTo(goal) < tolerance) return;
    this.goal.copy(goal);
    this.hasGoal = true;
    this.replan();
  }

  replan(): void {
    const p = this.nav.findPath(this.position, this.goal);
    this.failed = !p;
    this.path = p ?? [];
    this.index = Math.min(1, this.path.length);
    this.arrived = !p ? false : this.path.length <= 1;
    this.stuckTimer = 0;
    this.lastPos.copy(this.position);
  }

  clear(): void {
    this.path = [];
    this.index = 0;
    this.hasGoal = false;
    this.arrived = false;
    this.failed = false;
    this.stuckCount = 0;
  }

  /** Is the current waypoint the last one? */
  get onFinalLeg(): boolean {
    return this.index >= this.path.length - 1;
  }

  /** The point to walk toward right now, or null when there's nowhere to go. */
  update(dt: number): THREE.Vector3 | null {
    if (!this.hasGoal || this.arrived || this.path.length === 0) return null;

    // Advance past waypoints we've reached. Within a meter or so we may move
    // on early, but only if the straight line to the NEXT waypoint is clear
    // (otherwise we'd cut the corner into a wall).
    this.shortcutTimer -= dt;
    while (this.index < this.path.length) {
      const p = this.path[this.index];
      const flat = Math.hypot(p.x - this.position.x, p.z - this.position.z);
      const closeY = Math.abs(p.y - this.position.y) < 1.2;
      const next = this.path[this.index + 1];
      if (closeY && flat < 0.4) {
        this.index++;
      } else if (closeY && next && flat < 1.3 && this.shortcutTimer <= 0) {
        this.shortcutTimer = 0.1;
        const pos = this.position;
        if (this.nav.canWalk(pos.x, pos.y, pos.z, next.x, next.y, next.z)) this.index++;
        else break;
      } else break;
    }
    if (this.index >= this.path.length) {
      this.arrived = true;
      return null;
    }

    // Stuck? (Not making progress for a second.) Re-plan from here.
    this.stuckTimer += dt;
    if (this.stuckTimer > 1.0) {
      const moved = this.position.distanceTo(this.lastPos);
      this.stuckTimer = 0;
      this.lastPos.copy(this.position);
      if (moved < 0.35) {
        this.stuckCount++;
        if (this.stuckCount >= 3) {
          // Give up on this goal; the brain will pick something else.
          this.failed = true;
          this.path = [];
          return null;
        }
        this.replan();
      } else {
        this.stuckCount = 0;
      }
    }
    return this.path[this.index] ?? null;
  }
}
