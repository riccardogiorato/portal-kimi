/**
 * main.ts — Boot entry. Creates the Game, surfaces fatal errors, and lifts
 * the boot screen once the main menu is ready.
 */
import { Game } from './core/Game';

async function boot(): Promise<void> {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement | null;
  const bootScreen = document.getElementById('boot-screen');

  if (!canvas) {
    throw new Error('renderCanvas element missing from index.html');
  }

  const game = new Game(canvas);
  try {
    await game.init();
  } catch (error) {
    console.error('[boot] Fatal during initialization:', error);
    if (bootScreen) {
      bootScreen.innerHTML =
        '<div style="letter-spacing:0.1em;max-width:32rem;text-align:center;line-height:1.6">' +
        'This experience requires WebGL2.<br/>Please use a modern browser with hardware acceleration enabled.</div>';
    }
    return;
  }

  bootScreen?.classList.add('hidden');
  // Expose for debugging and headless verification.
  (window as unknown as { __game?: Game }).__game = game;
}

void boot();
