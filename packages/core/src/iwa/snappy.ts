/**
 * Snappy raw-block decompression.
 *
 * iWork does not use the Snappy *framing* format — each IWA chunk is a bare
 * Snappy block behind Apple's own 4-byte header (see `chunks.ts`). Only the
 * decoder is implemented; nothing here ever writes .key files.
 */

export class SnappyError extends Error {
  override name = 'SnappyError';
}

/** Decompress a single raw Snappy block. */
export function snappyDecompress(src: Uint8Array): Uint8Array {
  let pos = 0;

  // Preamble: uncompressed length as a varint.
  let length = 0;
  let shift = 0;
  for (;;) {
    if (pos >= src.length) throw new SnappyError('truncated length preamble');
    const byte = src[pos++]!;
    length |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 32) throw new SnappyError('length preamble too long');
  }

  const out = new Uint8Array(length);
  let outPos = 0;

  while (pos < src.length) {
    const tag = src[pos]!;
    switch (tag & 0x03) {
      case 0: {
        // Literal. The upper 6 bits hold `len - 1`, or a marker (60..63)
        // saying how many extra little-endian bytes carry the length.
        let len = tag >> 2;
        pos += 1;
        if (len >= 60) {
          const extra = len - 59;
          len = 0;
          for (let i = 0; i < extra; i++) len |= src[pos + i]! << (8 * i);
          pos += extra;
        }
        len = (len >>> 0) + 1;
        if (pos + len > src.length) throw new SnappyError('literal overruns input');
        out.set(src.subarray(pos, pos + len), outPos);
        outPos += len;
        pos += len;
        break;
      }
      case 1: {
        // Copy with 1-byte offset extension: 3-bit length, 11-bit offset.
        const len = 4 + ((tag >> 2) & 0x07);
        const offset = ((tag >> 5) << 8) | src[pos + 1]!;
        pos += 2;
        outPos = copy(out, outPos, offset, len);
        break;
      }
      case 2: {
        // Copy with 2-byte offset.
        const len = (tag >> 2) + 1;
        const offset = src[pos + 1]! | (src[pos + 2]! << 8);
        pos += 3;
        outPos = copy(out, outPos, offset, len);
        break;
      }
      default: {
        // Copy with 4-byte offset.
        const len = (tag >> 2) + 1;
        const offset =
          (src[pos + 1]! |
            (src[pos + 2]! << 8) |
            (src[pos + 3]! << 16) |
            (src[pos + 4]! << 24)) >>>
          0;
        pos += 5;
        outPos = copy(out, outPos, offset, len);
        break;
      }
    }
  }

  if (outPos !== length) {
    throw new SnappyError(`expected ${length} bytes, produced ${outPos}`);
  }
  return out;
}

/**
 * Back-reference copy. Runs may overlap the write head (that is how Snappy
 * encodes repeats), so this has to copy byte by byte.
 */
function copy(out: Uint8Array, outPos: number, offset: number, len: number): number {
  if (offset === 0 || offset > outPos) {
    throw new SnappyError(`invalid copy offset ${offset} at ${outPos}`);
  }
  if (outPos + len > out.length) throw new SnappyError('copy overruns output');
  let from = outPos - offset;
  for (let i = 0; i < len; i++) out[outPos++] = out[from++]!;
  return outPos;
}
