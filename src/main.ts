import { Game } from './core/Game';

const game = new Game(document.getElementById('game-root')!, document.getElementById('ui-root')!);
game.start();

// Expose the game in development so it can be inspected from the browser console.
if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
