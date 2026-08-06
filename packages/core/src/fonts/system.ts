/**
 * Typefaces that are already present on the platforms a deck is likely to be
 * viewed on, and so must never be fetched from a font service.
 *
 * The list is deliberately generous. A false positive costs a font that could
 * have been loaded and instead falls back — the behaviour without any loading
 * at all. A false negative sends a request for a font the machine already has,
 * which is wasted bytes and an avoidable third-party call.
 */

/** macOS and iOS, which is what Keynote decks are authored against. */
const APPLE = [
  'Helvetica', 'Helvetica Neue', 'Times', 'Times New Roman', 'Courier', 'Courier New',
  'Geneva', 'Monaco', 'Menlo', 'Andale Mono', 'Lucida Grande', 'Apple Chancery',
  'Apple Symbols', 'American Typewriter', 'Avenir', 'Avenir Next', 'Avenir Next Condensed',
  'Baskerville', 'Big Caslon', 'Bodoni 72', 'Bradley Hand', 'Brush Script MT',
  'Chalkboard', 'Chalkboard SE', 'Chalkduster', 'Cochin', 'Copperplate', 'Didot',
  'Futura', 'Gill Sans', 'Herculanum', 'Hoefler Text', 'Krungthep', 'Luminari',
  'Marker Felt', 'Noteworthy', 'Optima', 'Papyrus', 'Phosphate', 'Rockwell',
  'Savoye LET', 'SignPainter', 'Skia', 'Snell Roundhand', 'Trattatello', 'Zapfino',
  'Zapf Dingbats', 'Symbol', 'Charter', 'Seravek', 'Superclarendon', 'Iowan Old Style',
  'Palatino', 'Party LET', 'Athelas', 'Arial Hebrew', 'Damascus', 'Kefa', 'Mishafi',
  // Apple's system faces, reachable through `system-ui` / `-apple-system`.
  'SF Pro', 'SF Pro Display', 'SF Pro Text', 'SF Mono', 'SF Compact', 'San Francisco',
  'New York', '.SF NS', 'System Font',
];

/** Shipped with Windows or Office, and long-standing "web safe" faces. */
const MICROSOFT = [
  'Arial', 'Arial Black', 'Arial Narrow', 'Arial Rounded MT Bold', 'Calibri', 'Cambria',
  'Candara', 'Century Gothic', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel',
  'Franklin Gothic', 'Franklin Gothic Medium', 'Garamond', 'Georgia', 'Impact',
  'Lucida Console', 'Lucida Sans', 'Lucida Sans Unicode', 'MS Gothic', 'MS PGothic',
  'MS Sans Serif', 'MS Serif', 'Palatino Linotype', 'Book Antiqua', 'Segoe UI',
  'Segoe UI Emoji', 'Sylfaen', 'Tahoma', 'Trebuchet MS', 'Verdana', 'Webdings',
  'Wingdings', 'Bahnschrift', 'Ink Free',
];

/** CJK families bundled with macOS or Windows. */
const CJK = [
  'Hiragino Sans', 'Hiragino Kaku Gothic Pro', 'Hiragino Kaku Gothic ProN',
  'Hiragino Mincho Pro', 'Hiragino Mincho ProN', 'Hiragino Maru Gothic Pro',
  'Osaka', 'Yu Gothic', 'Yu Mincho', 'Meiryo', 'MS Mincho', 'MS PMincho',
  'PingFang SC', 'PingFang TC', 'PingFang HK', 'Heiti SC', 'Heiti TC',
  'Songti SC', 'Songti TC', 'Kaiti SC', 'Kaiti TC', 'Yuanti SC', 'Hannotate SC',
  'Libian SC', 'Weibei SC', 'Microsoft YaHei', 'Microsoft JhengHei', 'SimSun',
  'SimHei', 'NSimSun', 'FangSong', 'KaiTi', 'Apple SD Gothic Neo', 'AppleGothic',
  'Malgun Gothic', 'Nanum Gothic', 'Batang', 'Gungsuh', 'Dotum', 'Gulim',
  'Apple Color Emoji', 'Noto Color Emoji',
];

/** Normalised for lookup: lower-cased with spaces, hyphens and dots removed. */
export function normalizeFamily(family: string): string {
  return family.toLowerCase().replace(/[\s\-._]/g, '');
}

const SYSTEM = new Set([...APPLE, ...MICROSOFT, ...CJK].map(normalizeFamily));

/** True when the family is expected to be installed already. */
export function isSystemFamily(family: string): boolean {
  return SYSTEM.has(normalizeFamily(family));
}

/** The families this module considers pre-installed, for diagnostics. */
export function systemFamilies(): string[] {
  return [...APPLE, ...MICROSOFT, ...CJK].sort();
}
