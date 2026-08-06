/**
 * Minimal PNG reader + image comparison helpers for the verification harness.
 * Handles 8-bit greyscale/RGB/RGBA/palette, non-interlaced — which is what
 * Chrome's screenshots and pdf.js canvases produce.
 */
import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function readPng(path) {
  const bytes = readFileSync(path);
  if (!bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error(`${path}: not a PNG`);

  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let palette = null;
  const idat = [];

  let pos = 8;
  while (pos < bytes.length) {
    const length = bytes.readUInt32BE(pos);
    const type = bytes.toString('ascii', pos + 4, pos + 8);
    const data = bytes.subarray(pos + 8, pos + 8 + length);
    pos += 12 + length;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG is not supported');
    } else if (type === 'PLTE') palette = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }

  if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);
  const channels = CHANNELS[colorType];
  if (!channels) throw new Error(`unsupported colour type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = unfilter(raw, width, height, channels, stride);

  // Normalise everything to RGBA for callers.
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, p = 0; i < width * height; i++, p += 4) {
    const s = i * channels;
    if (colorType === 3) {
      const index = pixels[s] * 3;
      rgba[p] = palette[index];
      rgba[p + 1] = palette[index + 1];
      rgba[p + 2] = palette[index + 2];
      rgba[p + 3] = 255;
    } else if (colorType === 0 || colorType === 4) {
      rgba[p] = rgba[p + 1] = rgba[p + 2] = pixels[s];
      rgba[p + 3] = colorType === 4 ? pixels[s + 1] : 255;
    } else {
      rgba[p] = pixels[s];
      rgba[p + 1] = pixels[s + 1];
      rgba[p + 2] = pixels[s + 2];
      rgba[p + 3] = colorType === 6 ? pixels[s + 3] : 255;
    }
  }

  return { width, height, data: rgba };
}

function unfilter(raw, width, height, channels, stride) {
  const out = new Uint8Array(stride * height);
  let inPos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[inPos++];
    const row = y * stride;
    const prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[inPos++];
      const a = x >= channels ? out[row + x - channels] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = x >= channels && y > 0 ? out[prev + x - channels] : 0;
      let result;
      switch (filter) {
        case 0: result = value; break;
        case 1: result = value + a; break;
        case 2: result = value + b; break;
        case 3: result = value + ((a + b) >> 1); break;
        case 4: result = value + paeth(a, b, c); break;
        default: throw new Error(`unknown filter ${filter}`);
      }
      out[row + x] = result & 0xff;
    }
  }
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function luminance(image, x, y) {
  const i = (y * image.width + x) * 4;
  return 0.2126 * image.data[i] + 0.7152 * image.data[i + 1] + 0.0722 * image.data[i + 2];
}

/** Per-row count of pixels brighter than `threshold`, within an x window. */
export function rowInk(image, { x0 = 0, x1 = image.width, threshold = 40 } = {}) {
  const rows = new Int32Array(image.height);
  for (let y = 0; y < image.height; y++) {
    let count = 0;
    for (let x = x0; x < x1; x++) if (luminance(image, x, y) > threshold) count++;
    rows[y] = count;
  }
  return rows;
}

/** Contiguous bands of rows containing ink, e.g. lines of text. */
export function bands(rows, { minInk = 2, minGap = 4 } = {}) {
  const out = [];
  let start = -1;
  let gap = 0;
  for (let y = 0; y < rows.length; y++) {
    if (rows[y] >= minInk) {
      if (start === -1) start = y;
      gap = 0;
    } else if (start !== -1) {
      gap++;
      if (gap > minGap) {
        out.push({ top: start, bottom: y - gap });
        start = -1;
      }
    }
  }
  if (start !== -1) out.push({ top: start, bottom: rows.length - 1 });
  return out;
}

/** Fraction of pixels differing by more than `tolerance` in any channel. */
export function compare(a, b, tolerance = 24) {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  let differing = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (
      Math.abs(a.data[i] - b.data[i]) > tolerance ||
      Math.abs(a.data[i + 1] - b.data[i + 1]) > tolerance ||
      Math.abs(a.data[i + 2] - b.data[i + 2]) > tolerance
    ) {
      differing++;
    }
  }
  return differing / (a.width * a.height);
}
