/**
 * UsForge leaderboard: when the game runs inside UsForge's page (in an
 * iframe), report the player's total XP to the page around it after a match. UsForge
 * asks for a nickname and keeps the top 10; the game itself never does.
 * Opened on its own (not in an iframe), this does nothing.
 */
export function sendScoreToUsForge(score: number): void {
  // only when running inside UsForge's page; does nothing when the game is opened on its own
  if (window.parent === window) return;
  if (!Number.isFinite(score) || score < 0 || score >= 1e12) return;
  try {
    window.parent.postMessage({ usforge: 'score', score: Math.round(score), unit: 'XP' }, '*');
  } catch {
    // Ignore: the page around us didn't accept the message.
  }
}

// Also available globally (as UsForge's instructions describe).
(window as unknown as { sendScoreToUsForge: typeof sendScoreToUsForge }).sendScoreToUsForge = sendScoreToUsForge;
