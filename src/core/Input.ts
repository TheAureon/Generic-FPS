/**
 * Keyboard + mouse input. Keys are tracked by physical key code
 * (e.g. 'KeyW', 'Space', 'ShiftLeft') so layouts don't matter.
 */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private mouseDown = new Set<number>();
  private mousePressed = new Set<number>();
  private mouseDX = 0;
  private mouseDY = 0;
  private wheel = 0;

  locked = false;

  constructor(private element: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      // Stop the browser from scrolling / doing things while playing.
      if (this.locked && !e.metaKey) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => {
      this.down.clear();
      this.mouseDown.clear();
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.mouseDown.add(e.button);
      this.mousePressed.add(e.button);
    });
    window.addEventListener('mouseup', (e) => this.mouseDown.delete(e.button));
    window.addEventListener(
      'wheel',
      (e) => {
        if (this.locked) this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.element;
      if (!this.locked) {
        this.down.clear();
        this.mouseDown.clear();
      }
    });
  }

  /** Capture the mouse. Must be called from a click. */
  requestLock(): void {
    try {
      const p = this.element.requestPointerLock() as unknown as Promise<void> | undefined;
      // Newer browsers return a promise that can reject (e.g. clicked too soon after Esc).
      p?.catch?.(() => {});
    } catch {
      // Older browsers may throw instead; the game shows "Resume" again.
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }
  /** True only on the frame the key went down. */
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }
  isMouseDown(button = 0): boolean {
    return this.mouseDown.has(button);
  }
  wasMousePressed(button = 0): boolean {
    return this.mousePressed.has(button);
  }

  consumeMouseDelta(): { dx: number; dy: number } {
    const d = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }
  consumeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** Call once at the end of every frame. */
  endFrame(): void {
    this.pressed.clear();
    this.mousePressed.clear();
  }

  /** Testing/debug helper: simulate a mouse button being held or released. */
  simulateMouse(button: number, isDown: boolean): void {
    if (isDown) {
      if (!this.mouseDown.has(button)) this.mousePressed.add(button);
      this.mouseDown.add(button);
    } else {
      this.mouseDown.delete(button);
    }
  }

  /** Testing/debug helper: simulate scrolling. */
  simulateWheel(steps: number): void {
    this.wheel += steps;
  }

  /** Testing/debug helper: simulate a key being held or released. */
  simulateKey(code: string, isDown: boolean): void {
    if (isDown) {
      if (!this.down.has(code)) this.pressed.add(code);
      this.down.add(code);
    } else {
      this.down.delete(code);
    }
  }
}
