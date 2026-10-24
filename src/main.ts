import { loadCustomModels } from './assets/customModels';
import { Game } from './core/Game';
import { loadFonts } from './ui/fonts';

// The game loaded, so hide the "how to start" message from index.html.
document.getElementById('boot-message')?.remove();
loadFonts();

// Load any custom 3D models first (instant if there are none), then start.
loadCustomModels().then(() => {
  const game = new Game(document.getElementById('game-root')!, document.getElementById('ui-root')!);
  game.start();

  // Expose the game in development so it can be inspected from the browser console.
  if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
});
