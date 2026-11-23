/**
 * The loading screen shown while a match is being set up: the map and mode,
 * a progress bar with what's happening, and a tip. Building the map and
 * preparing the graphics card takes a moment, and this is much nicer than
 * the game seeming to freeze.
 */

const TIPS = [
  'Headshots do double damage. Aim for the head.',
  'Bots hear gunshots. A katana kill (V) makes no noise.',
  'Hold your aim key to aim down sights: you’ll hit more, but move slower.',
  'Sprint and press C to slide into cover.',
  'Moving targets are harder to hit. Keep strafing in a gunfight.',
  'Hurt bots run for health. Cut them off.',
  'Press X when a killstreak reward is ready.',
  'Smoke (H) blocks bots’ view. Use it to cross open ground.',
  'Shoot the red barrels when enemies are near them.',
  'Hold Tab to see the scoreboard and your challenges.',
  'Press Space at a ledge to climb up.',
  'In team modes, press J to give your squad orders.',
  'At night, L switches your flashlight on and off. Bots can see it.',
  'If the game feels choppy, try Settings → Graphics → Low.',
];

export class LoadingScreen {
  private el: HTMLDivElement;
  private title: HTMLDivElement;
  private sub: HTMLDivElement;
  private fill: HTMLDivElement;
  private step: HTMLDivElement;
  private tip: HTMLDivElement;
  private tipIndex = Math.floor(Math.random() * TIPS.length);

  constructor(parent: HTMLElement) {
    this.el = div('loading-screen', parent);
    const box = div('ls-box', this.el);
    div('ls-eyebrow', box).textContent = 'Loading';
    this.title = div('ls-title', box);
    this.sub = div('ls-sub', box);
    const bar = div('ls-bar', box);
    this.fill = div('ls-fill', bar);
    const row = div('ls-row', box);
    div('ls-spinner', row);
    this.step = div('ls-step', row);
    this.tip = div('ls-tip', this.el);
    this.el.style.display = 'none';
  }

  get visible(): boolean {
    return this.el.style.display !== 'none';
  }

  show(map: string, mode: string): void {
    this.title.textContent = map;
    this.sub.textContent = mode;
    this.tipIndex = (this.tipIndex + 1) % TIPS.length;
    this.tip.innerHTML = `<b>Tip</b> ${TIPS[this.tipIndex]}`;
    this.progress(0, 'Getting ready');
    this.el.classList.remove('out');
    this.el.style.display = 'flex';
  }

  /** How far along (0 to 1) and what's happening. */
  progress(f: number, what: string): void {
    this.fill.style.width = `${Math.round(f * 100)}%`;
    this.step.textContent = what;
  }

  /** Fades out. */
  hide(): void {
    this.progress(1, 'Ready');
    this.el.classList.add('out');
    setTimeout(() => {
      if (this.el.classList.contains('out')) this.el.style.display = 'none';
    }, 350);
  }
}

function div(className: string, parent: HTMLElement): HTMLDivElement {
  const d = document.createElement('div');
  d.className = className;
  parent.appendChild(d);
  return d;
}
