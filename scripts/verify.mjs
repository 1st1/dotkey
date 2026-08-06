#!/usr/bin/env node
/**
 * Visual regression harness: renders every slide with @dotkey/react and diffs
 * it against the corresponding page of the PDF Keynote exported.
 *
 * Requires `pnpm dev` to be running and the `agent-browser` CLI on PATH.
 *   node scripts/verify.mjs [slideIndex...]
 */
// @lat: [[tests#Browser verification#Diffs every slide against the PDF export]]
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.KEYNOTE_DEMO_URL ?? 'http://localhost:5273';
const SESSION = 'kn-verify';
const OUT = resolve('.scratch/verify');
const WIDTH = 1920;
const HEIGHT = 1080;

const only = process.argv.slice(2).map(Number).filter(Number.isFinite);

function ab(...args) {
  return execFileSync('agent-browser', ['--session', SESSION, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function shot(name) {
  const path = resolve(OUT, name);
  ab('screenshot', path);
  return path;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

ab('set', 'viewport', String(WIDTH), String(HEIGHT));

// Slide count comes from the parsed deck itself.
ab('open', `${BASE}/?bare=0`);
ab('wait', '--fn', 'window.keynote && window.keynote.deck.slides.length > 0');
const total = Number(JSON.parse(ab('eval', 'window.keynote.deck.slides.length')));
const indexes = only.length > 0 ? only : Array.from({ length: total }, (_, i) => i);

console.log(`Comparing ${indexes.length} of ${total} slides at ${WIDTH}x${HEIGHT}\n`);

const results = [];
for (const index of indexes) {
  const label = String(index).padStart(2, '0');

  ab('open', `${BASE}/pdf-reference.html?page=${index + 1}&width=${WIDTH}`);
  ab('wait', '--fn', 'window.pdfReady');
  const reference = shot(`ref-${label}.png`);

  ab('open', `${BASE}/?bare=${index}`);
  ab('wait', '--fn', 'window.keynote && document.fonts.status === "loaded"');
  // Give lazily-decoded images a beat to paint.
  ab('wait', '600');
  shot(`kn-${label}.png`);

  const diff = ab('diff', 'screenshot', '--baseline', reference);
  const percent = Number(diff.match(/([\d.]+)%/)?.[1] ?? NaN);
  results.push({ index, percent });
  const bar = '█'.repeat(Math.min(40, Math.round((percent || 0) * 2)));
  console.log(
    `slide ${label}  ${String(percent.toFixed(2)).padStart(6)}%  ${bar}`,
  );
}

const sorted = [...results].sort((a, b) => b.percent - a.percent);
const mean = results.reduce((sum, r) => sum + (r.percent || 0), 0) / results.length;
console.log(`\nmean mismatch ${mean.toFixed(2)}%`);
console.log('worst:', sorted.slice(0, 5).map((r) => `#${r.index} ${r.percent.toFixed(2)}%`).join('  '));
console.log(`\nartifacts in ${OUT} (${readdirSync(OUT).length} files)`);
