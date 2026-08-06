/**
 * @dotkey/core — read Apple Keynote `.key` files.
 *
 * ```ts
 * import { parseKeynote } from '@dotkey/core';
 *
 * const doc = await parseKeynote(await file.arrayBuffer());
 * doc.deck.slides[0].elements; // renderer-agnostic JSON
 * doc.resourceUrl('8059');     // blob: URL for slide media
 * ```
 */

import { KeynoteBundle, type BundleOptions, type BundleWarning } from './document/bundle.js';
import { buildDeck, type BuildDeckOptions } from './build/deck.js';
import { transcodeImage } from './media/transcode.js';
import type { Deck, Resource, ResourceId } from './model/types.js';

export type { BundleOptions, BundleWarning, BuildDeckOptions };
export { KeynoteBundle };
export { ArchiveStore, type ArchiveObject, type Ref } from './document/store.js';
export { buildDeck };
export { directionVector, toBuilds, toTransition, type BuildsResult } from './build/animation.js';
export { bundledSchema, createSchema, type Schema, type SchemaSource } from './iwa/schema.js';
export { decompressIwa } from './iwa/chunks.js';
export { snappyDecompress } from './iwa/snappy.js';
export { parseArchiveStream, type ArchiveRecord, type ArchiveMessage } from './iwa/stream.js';
export { colorToCss, toColor, type RawColor } from './model/color.js';
export { expandGradientStops, mix } from './model/gradient.js';
export { fontStack, parseFontName, type ParsedFont } from './model/fonts.js';
export { canTranscode, transcodeImage, type TranscodedImage } from './media/transcode.js';
export { decodeTiff, isTiff, unpackBits, type RgbaImage } from './media/tiff.js';
export { encodePng } from './media/png.js';
export * from './model/types.js';

export interface ParseOptions extends BundleOptions, BuildDeckOptions {}

/** Bytes accepted for a `.key` package. */
export type KeynoteInput = ArrayBuffer | ArrayBufferView | Uint8Array | Blob;

/**
 * A parsed presentation: the document model plus access to the media it
 * references and to the raw archive graph underneath.
 */
export class KeynoteDocument {
  readonly deck: Deck;
  readonly bundle: KeynoteBundle;
  readonly #urls = new Map<ResourceId, string>();
  readonly #transcoded = new Map<ResourceId, Uint8Array>();

  constructor(bundle: KeynoteBundle, options: BuildDeckOptions = {}) {
    this.bundle = bundle;
    this.deck = buildDeck(bundle, options);
  }

  get warnings(): readonly BundleWarning[] {
    return this.bundle.warnings;
  }

  resource(id: ResourceId): Resource | undefined {
    return this.deck.resources[id];
  }

  /**
   * Bytes for a resource in the form {@link Resource.mimeType} advertises.
   *
   * A format browsers cannot display is transcoded here rather than at parse
   * time, so opening a deck never pays for media nobody looks at. The result is
   * cached, since the same resource is usually requested once per render.
   */
  resourceBytes(id: ResourceId): Uint8Array | undefined {
    const cached = this.#transcoded.get(id);
    if (cached) return cached;

    const stored = this.bundle.data(Number(id))?.bytes;
    if (!stored) return undefined;

    const resource = this.resource(id);
    if (!resource?.sourceMimeType) return stored;

    const converted = transcodeImage(stored, resource.sourceMimeType);
    if (!converted) return stored;
    this.#transcoded.set(id, converted.bytes);
    return converted.bytes;
  }

  /** Bytes exactly as stored in the package, without any transcoding. */
  originalResourceBytes(id: ResourceId): Uint8Array | undefined {
    return this.bundle.data(Number(id))?.bytes;
  }

  /**
   * A `blob:` URL for a resource, created once and reused. Call
   * {@link revokeResourceUrls} when the document is no longer displayed.
   * Requires a `Blob`/`URL` implementation (browsers, Node 18+, Deno, Bun).
   */
  resourceUrl(id: ResourceId): string | undefined {
    const cached = this.#urls.get(id);
    if (cached) return cached;

    const bytes = this.resourceBytes(id);
    if (!bytes) return undefined;
    const type = this.resource(id)?.mimeType ?? 'application/octet-stream';
    // Copy into a fresh buffer: the bytes are a view onto the unzipped package.
    const blob = new Blob([bytes.slice()], { type });
    const url = URL.createObjectURL(blob);
    this.#urls.set(id, url);
    return url;
  }

  /** A `data:` URL, for environments without `URL.createObjectURL`. */
  resourceDataUrl(id: ResourceId): string | undefined {
    const bytes = this.resourceBytes(id);
    if (!bytes) return undefined;
    const type = this.resource(id)?.mimeType ?? 'application/octet-stream';
    return `data:${type};base64,${base64(bytes)}`;
  }

  revokeResourceUrls(): void {
    for (const url of this.#urls.values()) URL.revokeObjectURL(url);
    this.#urls.clear();
  }
}

/** Parse a `.key` package. */
export async function parseKeynote(
  input: KeynoteInput,
  options: ParseOptions = {},
): Promise<KeynoteDocument> {
  return parseKeynoteSync(await toBytes(input), options);
}

/** Synchronous variant, for callers that already hold the bytes. */
export function parseKeynoteSync(
  input: ArrayBuffer | ArrayBufferView | Uint8Array,
  options: ParseOptions = {},
): KeynoteDocument {
  const bytes = viewToBytes(input);
  return new KeynoteDocument(KeynoteBundle.fromZip(bytes, options), options);
}

/** Parse an already-expanded package (a `.key` directory). */
export function parseKeynoteFiles(
  files: ReadonlyMap<string, Uint8Array>,
  options: ParseOptions = {},
): KeynoteDocument {
  return new KeynoteDocument(KeynoteBundle.fromFiles(files, options), options);
}

async function toBytes(input: KeynoteInput): Promise<Uint8Array> {
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    return new Uint8Array(await input.arrayBuffer());
  }
  return viewToBytes(input as ArrayBuffer | ArrayBufferView);
}

function viewToBytes(input: ArrayBuffer | ArrayBufferView | Uint8Array): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  return new Uint8Array(input);
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64(bytes: Uint8Array): string {
  // Avoids both `Buffer` (Node-only) and `btoa` (chokes on large strings).
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += BASE64_CHARS[a >> 2];
    out += BASE64_CHARS[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : BASE64_CHARS[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : BASE64_CHARS[c & 63];
  }
  return out;
}
