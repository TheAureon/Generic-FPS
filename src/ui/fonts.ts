/**
 * The game's fonts, bundled into the game file (so they work offline):
 * Rajdhani for titles, numbers and the HUD, Inter for everything else.
 */
import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff2?url';
import inter500 from '@fontsource/inter/files/inter-latin-500-normal.woff2?url';
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff2?url';
import inter700 from '@fontsource/inter/files/inter-latin-700-normal.woff2?url';
import raj500 from '@fontsource/rajdhani/files/rajdhani-latin-500-normal.woff2?url';
import raj600 from '@fontsource/rajdhani/files/rajdhani-latin-600-normal.woff2?url';
import raj700 from '@fontsource/rajdhani/files/rajdhani-latin-700-normal.woff2?url';

const FACES: [string, string, string][] = [
  ['Inter', inter400, '400'], ['Inter', inter500, '500'], ['Inter', inter600, '600'], ['Inter', inter700, '700'],
  ['Rajdhani', raj500, '500'], ['Rajdhani', raj600, '600'], ['Rajdhani', raj700, '700'],
];

/** Register the fonts (the page falls back to system fonts until they're ready). */
export function loadFonts(): void {
  for (const [family, url, weight] of FACES) {
    const face = new FontFace(family, `url(${url}) format('woff2')`, { weight, display: 'swap' });
    document.fonts.add(face);
    face.load().catch(() => {});
  }
}
