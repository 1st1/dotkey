import { parseFontName } from '../model/fonts.js';
import catalogue from '../generated/googleFonts.json';
import { isSystemFamily, normalizeFamily } from './system.js';

/**
 * Matching a deck's fonts to fonts that can actually be loaded.
 *
 * Keynote embeds no font data — it records PostScript names and expects the
 * machine to have them. Rendering therefore has a hard dependency on the host
 * loading anything non-standard, and it is not cosmetic: auto-sized text boxes
 * are measured by the browser, so the wrong font means the wrong box.
 *
 * This module answers two questions per family: is it already installed, and if
 * not, does Google Fonts publish it — and in exactly which weights.
 */

/** Bit layout of the generated catalogue: 0..8 roman 100..900, 9..17 italic. */
const ITALIC_SHIFT = 9;

const byNormalizedName = new Map<string, string>();
for (const family of Object.keys(catalogue)) {
  byNormalizedName.set(normalizeFamily(family), family);
}

export type FontSource =
  /** Expected to be installed already; do not load. */
  | 'system'
  /** Not installed, and Google Fonts publishes it. */
  | 'google'
  /** Not installed, and no source is known. Text will use a fallback face. */
  | 'unavailable';

export interface FontFace {
  weight: number;
  style: 'normal' | 'italic';
}

export interface PlannedFont {
  /** CSS family name, e.g. `"Geist Mono"`. */
  family: string;
  source: FontSource;
  /** The faces the deck actually uses, deduplicated and sorted. */
  faces: FontFace[];
  /**
   * The faces to request, snapped to what the family publishes. Asking Google
   * Fonts for a weight a family does not have fails the whole request with a
   * 400, so this is never a guess.
   */
  available: FontFace[];
  /** PostScript names from the deck that resolved to this family. */
  postScriptNames: string[];
}

/**
 * Group a deck's `fonts` into families, classify each, and work out which faces
 * can be fetched. Pure: no network, no DOM.
 */
export function planFonts(postScriptNames: readonly string[]): PlannedFont[] {
  const groups = new Map<string, { family: string; faces: Set<string>; names: Set<string> }>();

  for (const name of postScriptNames) {
    const parsed = parseFontName(name);
    const key = normalizeFamily(parsed.family);
    let group = groups.get(key);
    if (!group) {
      group = { family: parsed.family, faces: new Set(), names: new Set() };
      groups.set(key, group);
    }
    group.faces.add(`${parsed.weight}:${parsed.style}`);
    group.names.add(name);
  }

  const planned: PlannedFont[] = [];
  for (const group of groups.values()) {
    const faces = [...group.faces].map(toFace).sort(compareFaces);

    const canonical = byNormalizedName.get(normalizeFamily(group.family));
    const source: FontSource =
      isSystemFamily(group.family) ? 'system'
      : canonical ? 'google'
      : 'unavailable';

    planned.push({
      // Prefer the catalogue's spelling, so the CSS family name matches what the
      // service serves.
      family: source === 'google' && canonical ? canonical : group.family,
      source,
      faces,
      available: source === 'google' && canonical ? snapFaces(canonical, faces) : [],
      postScriptNames: [...group.names].sort(),
    });
  }

  return planned.sort((a, b) => a.family.localeCompare(b.family));
}

/** Roman before italic, matching the order `css2` wants its axis tuples in. */
function compareFaces(a: FontFace, b: FontFace): number {
  return a.weight - b.weight || Number(a.style === 'italic') - Number(b.style === 'italic');
}

function toFace(key: string): FontFace {
  const [weight, style] = key.split(':');
  return { weight: Number(weight), style: style === 'italic' ? 'italic' : 'normal' };
}

/** Weights a family publishes, for one style. */
function publishedWeights(family: string, style: 'normal' | 'italic'): number[] {
  const mask = (catalogue as Record<string, number>)[family] ?? 0;
  const shift = style === 'italic' ? ITALIC_SHIFT : 0;
  const weights: number[] = [];
  for (let bit = 0; bit < 9; bit++) {
    if ((mask >> (bit + shift)) & 1) weights.push((bit + 1) * 100);
  }
  return weights;
}

/**
 * Map each wanted face onto the nearest published one. A family with no italics
 * falls back to its roman weights, letting the browser synthesise the slant —
 * which is what it would do anyway with no font loaded at all.
 */
function snapFaces(family: string, faces: readonly FontFace[]): FontFace[] {
  const seen = new Set<string>();
  const out: FontFace[] = [];

  for (const face of faces) {
    let style = face.style;
    let weights = publishedWeights(family, style);
    if (weights.length === 0 && style === 'italic') {
      style = 'normal';
      weights = publishedWeights(family, style);
    }
    if (weights.length === 0) continue;

    const weight = weights.reduce((best, candidate) =>
      Math.abs(candidate - face.weight) < Math.abs(best - face.weight) ? candidate : best,
    );
    const key = `${weight}:${style}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ weight, style });
  }

  return out.sort(compareFaces);
}

export interface GoogleFontsUrlOptions {
  /**
   * `font-display`. Defaults to `block`, which hides text until the face
   * arrives: a brief blank is preferable to laying a slide out with fallback
   * metrics and then reflowing it.
   */
  display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional';
  /** Origin of the service, for self-hosted mirrors. */
  origin?: string;
}

/**
 * A single `css2` stylesheet URL covering every Google-published family in the
 * plan, or `undefined` when there is nothing to fetch.
 */
export function googleFontsUrl(
  planned: readonly PlannedFont[],
  options: GoogleFontsUrlOptions = {},
): string | undefined {
  const families = planned.filter(
    (font) => font.source === 'google' && font.available.length > 0,
  );
  if (families.length === 0) return undefined;

  const origin = options.origin ?? 'https://fonts.googleapis.com';
  const parts = families.map((font) => {
    const name = font.family.replace(/ /g, '+');
    const hasItalic = font.available.some((face) => face.style === 'italic');
    // `css2` requires axis tuples in ascending order, italic axis first.
    const spec = font.available
      .map((face) => (hasItalic ? `${face.style === 'italic' ? 1 : 0},${face.weight}` : `${face.weight}`))
      .sort(compareAxisTuple)
      .join(';');
    return `family=${name}:${hasItalic ? 'ital,wght' : 'wght'}@${spec}`;
  });

  return `${origin}/css2?${parts.join('&')}&display=${options.display ?? 'block'}`;
}

function compareAxisTuple(a: string, b: string): number {
  const parse = (value: string) => value.split(',').map(Number);
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Origins worth preconnecting to before the stylesheet request goes out. */
export const GOOGLE_FONTS_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
] as const;
