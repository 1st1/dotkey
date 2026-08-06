import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe } from 'vitest';

/**
 * Locating a presentation to test against.
 *
 * Keynote files are the author's content, so none is committed. Tests come in
 * two kinds:
 *
 *  - **Invariants** hold for any deck — they run against whatever `.key` file is
 *    present, and are skipped entirely when there is none.
 *  - **Pinned** expectations name specific slides, colours and pixel sizes. They
 *    only run against the deck they were written from, identified by hash, so a
 *    different file skips them rather than failing.
 *
 * Point `DOTKEY_FIXTURE` at a file, or drop one anywhere in the repository root.
 */

const REPO_ROOT = resolve(new URL('../../..', import.meta.url).pathname);

/** The deck the pinned expectations in this suite were written against. */
const PINNED_SHA256 = '5396983c8aa9aa4d64c12a7180411bf28d956e1d02794773ffdd47165ecf1300';

function findFixture(): string | undefined {
  const configured = process.env['DOTKEY_FIXTURE'];
  if (configured) {
    // Vitest runs with the package as its working directory, so a relative path
    // typed at the repository root would not resolve. Try both.
    for (const base of [process.cwd(), REPO_ROOT]) {
      const candidate = resolve(base, configured);
      if (existsSync(candidate)) return candidate;
    }
    // Silently falling back to "no fixture" would skip every deck-backed test
    // and report success, which is the worst possible answer to a typo.
    throw new Error(
      `DOTKEY_FIXTURE is set to "${configured}" but no such file exists ` +
        `(looked in ${process.cwd()} and ${REPO_ROOT}).`,
    );
  }

  const candidates = readdirSync(REPO_ROOT)
    .filter((name) => name.toLowerCase().endsWith('.key'))
    .sort();
  const first = candidates[0];
  return first ? join(REPO_ROOT, first) : undefined;
}

// @lat: [[tests#Invariants hold for any deck#Survives a fixture swap]]
export const fixturePath = findFixture();
export const hasFixture = fixturePath !== undefined;

export const isPinnedDeck =
  hasFixture &&
  createHash('sha256').update(readFileSync(fixturePath!)).digest('hex') === PINNED_SHA256;

/** Runs against whichever deck is available; skipped when there is none. */
export const describeWithDeck = hasFixture ? describe : describe.skip;

/** Runs only against the deck the pinned numbers came from. */
export const describeWithPinnedDeck = isPinnedDeck ? describe : describe.skip;

if (!hasFixture) {
  console.info(
    '\n  No .key file found — deck-backed tests skipped.' +
      '\n  Drop one in the repository root or set DOTKEY_FIXTURE.\n',
  );
} else if (!isPinnedDeck) {
  console.info(
    `\n  Using ${fixturePath}: invariants only.` +
      '\n  Pinned expectations belong to a different deck and were skipped.\n',
  );
}
