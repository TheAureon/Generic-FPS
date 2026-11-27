import { loadCustomModels } from './assets/customModels';
import { Game } from './core/Game';
import { loadFonts } from './ui/fonts';

// The game loaded, so hide the "how to start" message from index.html.
document.getElementById('boot-message')?.remove();
loadFonts();

// A loading screen while the game starts up (building the menu scene takes a moment).
const boot = document.createElement('div');
boot.className = 'loading-screen';
boot.innerHTML = '<div class="ls-box"><div class="ls-eyebrow">Generic FPS</div><div class="ls-row"><div class="ls-spinner"></div><div class="ls-step">Loading…</div></div></div>';
document.body.appendChild(boot);

// Load any custom 3D models first (instant if there are none), then start
// (after the loading screen has been drawn).
loadCustomModels()
  .then(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))))
  .then(() => {
    const game = new Game(document.getElementById('game-root')!, document.getElementById('ui-root')!);
    game.start();
    // Fade the loading screen out once the first frames (with the menu scene) are drawn.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        boot.classList.add('out');
        setTimeout(() => boot.remove(), 400);
      }),
    );

    // Expose the game in development so it can be inspected from the browser console.
    if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
  });
