import type { ArchiveStore, Ref } from '../document/store.js';

export type PropertyBag = Record<string, unknown>;

/**
 * iWork style resolution.
 *
 * A style archive is a stack of `super` messages ending in `TSS.StyleArchive`,
 * which may point at a `parent` style. Property bags appear at several levels
 * of the `super` stack — `TSWP.ShapeStyleArchive` carries text-frame properties
 * while its `TSD.ShapeStyleArchive` super carries fill and stroke, both under
 * the name `shape_properties`. Resolving a style means merging every bag with
 * that name, from the furthest ancestor down to the leaf.
 *
 * Nullable properties are stored as a pair: `font_color` plus a
 * `font_color_null` flag. A true flag means "explicitly none", which has to
 * clear an inherited value rather than fall through to it.
 */

const NULL_SUFFIX = '_null';
const MAX_DEPTH = 64;

/** Walk `super` to the innermost archive, which is where `parent` lives. */
function innermost(value: PropertyBag): PropertyBag {
  let current = value;
  for (let i = 0; i < MAX_DEPTH; i++) {
    const next = current['super'];
    if (!isBag(next)) return current;
    current = next;
  }
  return current;
}

/** Every bag named `key` in the archive's `super` stack, innermost first. */
function localBags(value: PropertyBag, key: string): PropertyBag[] {
  const bags: PropertyBag[] = [];
  let current: PropertyBag | undefined = value;
  for (let i = 0; i < MAX_DEPTH && current; i++) {
    const bag = current[key];
    if (isBag(bag)) bags.unshift(bag);
    const next: unknown = current['super'];
    current = isBag(next) ? next : undefined;
  }
  return bags;
}

/**
 * The inheritance chain for a style, furthest ancestor first.
 * Cycles are possible in damaged documents, so visited ids are tracked.
 */
export function styleChain(store: ArchiveStore, ref: Ref | null | undefined): PropertyBag[] {
  const chain: PropertyBag[] = [];
  const seen = new Set<number>();
  let current = store.deref(ref);

  while (current?.value && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current.value);
    const base = innermost(current.value);
    const parent = base['parent'];
    current = isRef(parent) ? store.deref(parent) : undefined;
  }
  return chain;
}

/**
 * Merge every `key` bag along the inheritance chain into one flat bag with
 * `*_null` flags applied.
 */
export function resolveProperties(
  store: ArchiveStore,
  ref: Ref | null | undefined,
  key: string,
): PropertyBag {
  const out: PropertyBag = {};
  for (const style of styleChain(store, ref)) {
    for (const bag of localBags(style, key)) applyBag(out, bag);
  }
  return out;
}

/** Merge additional bags on top of an already-resolved bag. */
export function mergeProperties(base: PropertyBag, ...overrides: PropertyBag[]): PropertyBag {
  const out = { ...base };
  for (const bag of overrides) applyBag(out, bag);
  return out;
}

function applyBag(target: PropertyBag, bag: PropertyBag): void {
  // Values first, then the null flags: a bag that sets both must end up cleared.
  for (const [key, value] of Object.entries(bag)) {
    if (key.endsWith(NULL_SUFFIX) || value === undefined) continue;
    target[key] = value;
  }
  for (const [key, value] of Object.entries(bag)) {
    if (!key.endsWith(NULL_SUFFIX)) continue;
    if (value === true) delete target[key.slice(0, -NULL_SUFFIX.length)];
  }
}

export function isBag(value: unknown): value is PropertyBag {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isRef(value: unknown): value is Ref {
  return isBag(value) && typeof value['identifier'] === 'number';
}

/** Read a nested field through the `super` stack, e.g. the drawable geometry. */
export function fromSuperChain<T>(value: PropertyBag | undefined, key: string): T | undefined {
  let current: PropertyBag | undefined = value;
  for (let i = 0; i < MAX_DEPTH && current; i++) {
    const found = current[key];
    if (found !== undefined) return found as T;
    const next: unknown = current['super'];
    current = isBag(next) ? next : undefined;
  }
  return undefined;
}
