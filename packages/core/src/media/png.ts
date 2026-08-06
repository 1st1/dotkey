/**
 * A minimal PNG encoder, so images in formats browsers cannot display can be
 * re-served as ones they can.
 *
 * Only what is needed: 8-bit RGBA, no interlacing, one `IDAT`. Filter type 0
 * (none) keeps the encoder small; `deflate` still compresses the result well
 * because the rows are byte-aligned.
 */
import { zlibSync } from 'fflate';

import type { RgbaImage } from './tiff.js';

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function encodePng(image: RgbaImage): Uint8Array {
  const { width, height, data } = image;

  // Each row is prefixed with its filter type.
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: truecolour with alpha
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  const chunks = [
    chunk('IHDR', header),
    // PNG's `IDAT` is a zlib stream, not a bare DEFLATE one: it needs the
              // two-byte header and the trailing Adler-32 that `zlibSync` adds.
              chunk('IDAT', zlibSync(raw, { level: 6 })),
    chunk('IEND', new Uint8Array(0)),
  ];

  const total = SIGNATURE.length + chunks.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  out.set(SIGNATURE, 0);
  let offset = SIGNATURE.length;
  for (const part of chunks) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  // The CRC covers the type and the body, but not the length.
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

let crcTable: Uint32Array | undefined;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let value = i;
      for (let bit = 0; bit < 8; bit++) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      crcTable[i] = value;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
