/** In-game heads-up display. Grows with each milestone. */
export class Hud {
  private debugEl: HTMLDivElement;
  private frames = 0;
  private fpsTimer = 0;
  private fps = 0;
  showDebug = true;

  constructor(root: HTMLElement) {
    const crosshair = document.createElement('div');
    crosshair.className = 'crosshair';
    this.debugEl = document.createElement('div');
    this.debugEl.className = 'debug';
    root.append(crosshair, this.debugEl);
  }

  /** Small info readout in the corner (toggle with F3). */
  updateDebug(dt: number, lines: () => string[]): void {
    this.frames++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.frames / this.fpsTimer);
      this.frames = 0;
      this.fpsTimer = 0;
      this.debugEl.textContent = this.showDebug ? [`FPS ${this.fps}`, ...lines()].join('\n') : '';
    }
  }
}
