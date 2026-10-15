/**
 * Simple click-to-play / paused screen. Full menus come in a later milestone.
 */
export class Overlay {
  private el: HTMLDivElement;
  private subtitle: HTMLDivElement;

  constructor(root: HTMLElement, onClick: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'overlay';
    this.el.innerHTML = `
      <h1>Generic FPS</h1>
      <div class="subtitle">Click to play</div>
      <div class="controls">
        <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>Move</span>
        <span>Mouse</span><span>Look around</span>
        <span><kbd>Space</kbd></span><span>Jump</span>
        <span><kbd>Shift</kbd></span><span>Sprint (hold)</span>
        <span><kbd>C</kbd></span><span>Crouch (hold)</span>
        <span>Left click</span><span>Shoot</span>
        <span>Right click</span><span>Aim down sights / scope (hold)</span>
        <span><kbd>R</kbd></span><span>Reload</span>
        <span><kbd>1</kbd>–<kbd>4</kbd> / wheel</span><span>Switch weapon (<kbd>Q</kbd> = last weapon)</span>
        <span><kbd>Esc</kbd></span><span>Pause / free the mouse</span>
      </div>`;
    this.subtitle = this.el.querySelector('.subtitle')!;
    this.el.addEventListener('click', onClick);
    root.appendChild(this.el);
  }

  show(paused: boolean): void {
    this.subtitle.textContent = paused ? 'Paused — click to resume' : 'Click to play';
    this.el.classList.remove('hidden');
  }

  hide(): void {
    this.el.classList.add('hidden');
  }
}
