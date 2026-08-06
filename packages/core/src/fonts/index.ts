/**
 * `@dotkey/core/fonts` — match a deck's fonts to loadable web fonts.
 *
 * A separate entry point because it carries the Google Fonts catalogue (~34 KB,
 * 12 KB compressed); decks whose fonts are all installed never need it.
 *
 * ```ts
 * import { googleFontsUrl, planFonts } from '@dotkey/core/fonts';
 *
 * const planned = planFonts(deck.fonts);
 * const href = googleFontsUrl(planned); // undefined when nothing needs loading
 * ```
 */
export {
  GOOGLE_FONTS_ORIGINS,
  googleFontsUrl,
  planFonts,
  type FontFace,
  type FontSource,
  type GoogleFontsUrlOptions,
  type PlannedFont,
} from './plan.js';
export { isSystemFamily, normalizeFamily, systemFamilies } from './system.js';
