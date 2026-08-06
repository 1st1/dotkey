/**
 * A TIFF decoder for the variants iWork actually embeds.
 *
 * Keynote stores pasted screenshots as TIFF and keeps only a small PNG
 * thumbnail alongside, so falling back to the thumbnail costs most of the
 * resolution. Decoding the original is the difference between a 900x560 image
 * and a 256x159 one.
 *
 * Supported: uncompressed, PackBits and Deflate strips; 8-bit greyscale, RGB,
 * RGBA and palette; horizontal differencing predictor. LZW is deliberately not
 * implemented — see `decodeTiff`'s contract.
 */
import { inflateSync } from 'fflate';

export interface RgbaImage {
  width: number;
  height: number;
  /** Tightly packed RGBA, 8 bits per channel. */
  data: Uint8Array;
}

const enum Compression {
  None = 1,
  Lzw = 5,
  DeflateOld = 8,
  PackBits = 32773,
  Deflate = 32946,
}

const enum Photometric {
  WhiteIsZero = 0,
  BlackIsZero = 1,
  Rgb = 2,
  Palette = 3,
}

const TAG = {
  width: 256,
  height: 257,
  bitsPerSample: 258,
  compression: 259,
  photometric: 262,
  stripOffsets: 273,
  samplesPerPixel: 277,
  rowsPerStrip: 278,
  stripByteCounts: 279,
  planarConfig: 284,
  predictor: 317,
  colorMap: 320,
  extraSamples: 338,
} as const;

/** Byte width of each TIFF field type, indexed by the type code. */
const TYPE_SIZE: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8,
};

interface Reader {
  view: DataView;
  little: boolean;
}

/**
 * Decode a TIFF to RGBA, or return `undefined` when the file uses a feature
 * this decoder does not implement. Callers are expected to fall back to
 * whichever derivative the document provides.
 */
export function decodeTiff(bytes: Uint8Array): RgbaImage | undefined {
  try {
    return decode(bytes);
  } catch {
    return undefined;
  }
}

/** True when `decodeTiff` is likely to succeed, without doing the work. */
export function isTiff(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const little = bytes[0] === 0x49 && bytes[1] === 0x49;
  const big = bytes[0] === 0x4d && bytes[1] === 0x4d;
  if (!little && !big) return false;
  const magic = little ? bytes[2]! | (bytes[3]! << 8) : (bytes[2]! << 8) | bytes[3]!;
  return magic === 42;
}

function decode(bytes: Uint8Array): RgbaImage | undefined {
  if (!isTiff(bytes)) return undefined;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = bytes[0] === 0x49;
  const reader: Reader = { view, little };

  const ifdOffset = u32(reader, 4);
  const fields = readIfd(reader, ifdOffset);

  const width = single(fields, TAG.width);
  const height = single(fields, TAG.height);
  if (!width || !height) return undefined;

  const compression = single(fields, TAG.compression) ?? Compression.None;
  const photometric = single(fields, TAG.photometric) ?? Photometric.Rgb;
  const samples = single(fields, TAG.samplesPerPixel) ?? 1;
  const bits = fields.get(TAG.bitsPerSample) ?? [8];
  const planar = single(fields, TAG.planarConfig) ?? 1;
  const predictor = single(fields, TAG.predictor) ?? 1;
  const rowsPerStrip = single(fields, TAG.rowsPerStrip) ?? height;
  const offsets = fields.get(TAG.stripOffsets);
  const counts = fields.get(TAG.stripByteCounts);

  // Anything outside this envelope is safer to hand back to the caller.
  if (!offsets || !counts) return undefined;
  if (planar !== 1) return undefined;
  if (bits.some((value) => value !== 8)) return undefined;
  if (compression === Compression.Lzw) return undefined;
  if (samples < 1 || samples > 4) return undefined;

  const palette = photometric === Photometric.Palette ? fields.get(TAG.colorMap) : undefined;
  if (photometric === Photometric.Palette && !palette) return undefined;

  const rowBytes = width * samples;
  const out = new Uint8Array(width * height * 4);

  let row = 0;
  for (let strip = 0; strip < offsets.length && row < height; strip++) {
    const start = offsets[strip]!;
    const length = counts[strip] ?? 0;
    const raw = bytes.subarray(start, start + length);
    const decoded = decompress(raw, compression);
    const rowsInStrip = Math.min(rowsPerStrip, height - row);

    for (let y = 0; y < rowsInStrip; y++) {
      const line = decoded.subarray(y * rowBytes, (y + 1) * rowBytes);
      if (line.length < rowBytes) break;
      if (predictor === 2) undoHorizontalDifferencing(line, samples);
      writeRow(out, (row + y) * width * 4, line, width, samples, photometric, palette);
    }
    row += rowsInStrip;
  }

  return { width, height, data: out };
}

function decompress(raw: Uint8Array, compression: number): Uint8Array {
  switch (compression) {
    case Compression.None:
      return raw;
    case Compression.PackBits:
      return unpackBits(raw);
    case Compression.Deflate:
    case Compression.DeflateOld:
      return inflateSync(raw);
    default:
      throw new Error(`unsupported TIFF compression ${compression}`);
  }
}

/**
 * PackBits: a signed length byte, then either a literal run (0..127 means
 * `n + 1` bytes follow) or a repeat (-1..-127 means the next byte `1 - n` times).
 */
export function unpackBits(input: Uint8Array): Uint8Array {
  const parts: number[] = [];
  let pos = 0;
  while (pos < input.length) {
    const header = (input[pos++]! << 24) >> 24;
    if (header >= 0) {
      const count = header + 1;
      for (let i = 0; i < count && pos < input.length; i++) parts.push(input[pos++]!);
    } else if (header !== -128) {
      const count = 1 - header;
      const value = input[pos++]!;
      for (let i = 0; i < count; i++) parts.push(value);
    }
    // -128 is a no-op by specification.
  }
  return new Uint8Array(parts);
}

/** Predictor 2 stores each sample as a delta from the one to its left. */
function undoHorizontalDifferencing(line: Uint8Array, samples: number): void {
  for (let i = samples; i < line.length; i++) {
    line[i] = (line[i]! + line[i - samples]!) & 0xff;
  }
}

function writeRow(
  out: Uint8Array,
  offset: number,
  line: Uint8Array,
  width: number,
  samples: number,
  photometric: number,
  palette: number[] | undefined,
): void {
  for (let x = 0; x < width; x++) {
    const source = x * samples;
    const target = offset + x * 4;

    if (palette) {
      // A TIFF colour map is three 16-bit ramps: all reds, then greens, blues.
      const index = line[source]!;
      const size = palette.length / 3;
      out[target] = (palette[index] ?? 0) >> 8;
      out[target + 1] = (palette[size + index] ?? 0) >> 8;
      out[target + 2] = (palette[2 * size + index] ?? 0) >> 8;
      out[target + 3] = 255;
      continue;
    }

    if (samples >= 3) {
      out[target] = line[source]!;
      out[target + 1] = line[source + 1]!;
      out[target + 2] = line[source + 2]!;
      out[target + 3] = samples >= 4 ? line[source + 3]! : 255;
      continue;
    }

    // Greyscale, possibly inverted.
    const grey = photometric === Photometric.WhiteIsZero ? 255 - line[source]! : line[source]!;
    out[target] = grey;
    out[target + 1] = grey;
    out[target + 2] = grey;
    out[target + 3] = samples === 2 ? line[source + 1]! : 255;
  }
}

// ---------------------------------------------------------------------------
// IFD parsing
// ---------------------------------------------------------------------------

function readIfd(reader: Reader, offset: number): Map<number, number[]> {
  const fields = new Map<number, number[]>();
  const count = u16(reader, offset);
  for (let i = 0; i < count; i++) {
    const entry = offset + 2 + i * 12;
    const tag = u16(reader, entry);
    const type = u16(reader, entry + 2);
    const length = u32(reader, entry + 4);
    const size = TYPE_SIZE[type];
    if (!size) continue;

    const total = size * length;
    // Values of four bytes or fewer are stored inline in the entry itself.
    const valueOffset = total <= 4 ? entry + 8 : u32(reader, entry + 8);
    const values: number[] = [];
    // Only the small tags matter here; a huge array is never a header field.
    for (let v = 0; v < Math.min(length, 1 << 16); v++) {
      values.push(readValue(reader, valueOffset + v * size, type));
    }
    fields.set(tag, values);
  }
  return fields;
}

function readValue(reader: Reader, offset: number, type: number): number {
  switch (type) {
    case 1:
    case 2:
    case 6:
    case 7:
      return reader.view.getUint8(offset);
    case 3:
      return u16(reader, offset);
    case 8:
      return reader.view.getInt16(offset, reader.little);
    case 4:
      return u32(reader, offset);
    case 9:
      return reader.view.getInt32(offset, reader.little);
    case 5:
    case 10:
      // Rational: numerator over denominator.
      return u32(reader, offset) / (u32(reader, offset + 4) || 1);
    case 11:
      return reader.view.getFloat32(offset, reader.little);
    case 12:
      return reader.view.getFloat64(offset, reader.little);
    default:
      return 0;
  }
}

function single(fields: Map<number, number[]>, tag: number): number | undefined {
  return fields.get(tag)?.[0];
}

function u16(reader: Reader, offset: number): number {
  return reader.view.getUint16(offset, reader.little);
}

function u32(reader: Reader, offset: number): number {
  return reader.view.getUint32(offset, reader.little);
}
