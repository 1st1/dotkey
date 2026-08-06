import { encodePng } from './png.js';
import { decodeTiff, isTiff } from './tiff.js';

/**
 * Re-encoding media that browsers cannot display.
 *
 * Keynote embeds pasted images as TIFF and keeps only a small PNG thumbnail
 * next to them, so preferring the thumbnail costs most of the resolution.
 * Transcoding the original keeps it.
 */

/** Formats this module can turn into something displayable. */
const TRANSCODABLE = new Set(['image/tiff']);

export function canTranscode(mimeType: string): boolean {
  return TRANSCODABLE.has(mimeType);
}

export interface TranscodedImage {
  bytes: Uint8Array;
  mimeType: string;
}

/**
 * Convert to PNG when possible. Returns `undefined` if the format is not
 * handled or the payload turns out to use a feature the decoder lacks, in which
 * case the caller should fall back to whatever derivative the document ships.
 */
export function transcodeImage(
  bytes: Uint8Array,
  mimeType: string,
): TranscodedImage | undefined {
  if (mimeType !== 'image/tiff' || !isTiff(bytes)) return undefined;
  const image = decodeTiff(bytes);
  if (!image || image.width === 0 || image.height === 0) return undefined;
  return { bytes: encodePng(image), mimeType: 'image/png' };
}
