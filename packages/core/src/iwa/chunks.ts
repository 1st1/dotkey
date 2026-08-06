import { snappyDecompress } from './snappy.js';

/**
 * An `.iwa` file is a sequence of chunks:
 *
 *   byte 0      always 0x00
 *   bytes 1..3  little-endian length of the compressed payload
 *   payload     one raw Snappy block (<= 64 KiB uncompressed)
 *
 * Concatenating the decompressed blocks yields the archive stream that
 * `parseArchiveStream` reads.
 */
export function decompressIwa(bytes: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [];
  let total = 0;
  let pos = 0;

  while (pos < bytes.length) {
    if (pos + 4 > bytes.length) throw new Error('truncated IWA chunk header');
    const flag = bytes[pos]!;
    if (flag !== 0x00) {
      throw new Error(`unexpected IWA chunk flag 0x${flag.toString(16)} at ${pos}`);
    }
    const compressedLength = bytes[pos + 1]! | (bytes[pos + 2]! << 8) | (bytes[pos + 3]! << 16);
    const end = pos + 4 + compressedLength;
    if (end > bytes.length) throw new Error('truncated IWA chunk payload');

    const block = snappyDecompress(bytes.subarray(pos + 4, end));
    blocks.push(block);
    total += block.length;
    pos = end;
  }

  if (blocks.length === 1) return blocks[0]!;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const block of blocks) {
    out.set(block, offset);
    offset += block.length;
  }
  return out;
}

/** Reads a base-128 varint. Returns the value and the position after it. */
export function readVarint(bytes: Uint8Array, pos: number): [value: number, next: number] {
  let value = 0;
  let shift = 0;
  for (;;) {
    if (pos >= bytes.length) throw new Error('truncated varint');
    const byte = bytes[pos++]!;
    // Multiplication rather than `<<` so values above 2^31 stay accurate.
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return [value, pos];
    shift += 7;
    if (shift > 63) throw new Error('varint too long');
  }
}
