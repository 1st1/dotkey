#!/usr/bin/env node
/**
 * Builds the Google Fonts catalogue used to match a deck's fonts to loadable
 * web fonts.
 *
 * Keynote records fonts by name and embeds no font data, so a deck that uses a
 * non-system typeface renders with fallback metrics unless the host loads it.
 * Matching needs to know which weights a family actually publishes: asking
 * `css2` for a weight that does not exist returns 400 and takes the whole
 * stylesheet down with it.
 *
 * Output: packages/core/src/generated/googleFonts.json — `family -> bitmask`,
 * where bits 0..8 are roman weights 100..900 and bits 9..17 the italics.
 *
 * Run with `pnpm fonts`. The result is committed; no API key is needed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'packages', 'core', 'src', 'generated', 'googleFonts.json');
const SOURCE = 'https://fonts.google.com/metadata/fonts';

const response = await fetch(SOURCE);
if (!response.ok) throw new Error(`${SOURCE} responded ${response.status}`);

// The endpoint prefixes its JSON with an anti-hijacking guard.
const text = (await response.text()).replace(/^[^{]*/, '');
const { familyMetadataList: families } = JSON.parse(text);
if (!Array.isArray(families)) throw new Error('unexpected metadata shape');

const catalogue = {};
for (const entry of families) {
  let mask = 0;
  for (const variant of Object.keys(entry.fonts ?? {})) {
    const match = /^(\d+)(i?)$/.exec(variant);
    if (!match) continue;
    const weight = Number(match[1]);
    if (weight % 100 !== 0 || weight < 100 || weight > 900) continue;
    const bit = weight / 100 - 1;
    mask |= 1 << (match[2] ? bit + 9 : bit);
  }
  if (mask !== 0) catalogue[entry.family] = mask;
}

const sorted = Object.fromEntries(Object.keys(catalogue).sort().map((k) => [k, catalogue[k]]));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(sorted));

const bytes = fs.statSync(OUT).size;
console.log(`Google Fonts: ${Object.keys(sorted).length} families, ${(bytes / 1024).toFixed(1)} KB`);
