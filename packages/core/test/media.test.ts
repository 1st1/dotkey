import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { encodePng } from '../src/media/png.js';
import { decodeTiff, isTiff, unpackBits, type RgbaImage } from '../src/media/tiff.js';
import { canTranscode, transcodeImage } from '../src/media/transcode.js';
import { readKeynoteFile } from '../src/node.js';
import { describeWithPinnedDeck, fixturePath } from './fixture.js';

// ---------------------------------------------------------------------------
// TIFF builder, so the decoder can be tested without a fixture
// ---------------------------------------------------------------------------

interface Field {
  tag: number;
  type: number;
  values: number[];
}

/** Assemble a single-strip little-endian TIFF. */
function buildTiff(fields: Field[], pixels: Uint8Array): Uint8Array {
  const headerSize = 8;
  const ifdSize = 2 + fields.length * 12 + 4;
  // Anything wider than four bytes lives after the IFD.
  const overflow: number[] = [];
  const entries: { tag: number; type: number; count: number; inline: number[] }[] = [];

  const size = (type: number) => (type === 3 ? 2 : type === 4 ? 4 : 1);

  for (const field of fields) {
    const width = size(field.type) * field.values.length;
    if (width <= 4) {
      entries.push({ tag: field.tag, type: field.type, count: field.values.length, inline: field.values });
    } else {
      const offset = headerSize + ifdSize + overflow.length;
      for (const value of field.values) {
        if (field.type === 3) overflow.push(value & 0xff, (value >> 8) & 0xff);
        else overflow.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff);
      }
      entries.push({ tag: field.tag, type: field.type, count: field.values.length, inline: [offset] });
    }
  }

  const pixelOffset = headerSize + ifdSize + overflow.length;
  // Patch in the strip offset now that the layout is known.
  for (const entry of entries) if (entry.tag === 273) entry.inline = [pixelOffset];

  const out = new Uint8Array(pixelOffset + pixels.length);
  const view = new DataView(out.buffer);
  out[0] = 0x49;
  out[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, headerSize, true);
  view.setUint16(headerSize, entries.length, true);

  for (const [index, entry] of entries.entries()) {
    const at = headerSize + 2 + index * 12;
    view.setUint16(at, entry.tag, true);
    view.setUint16(at + 2, entry.type, true);
    view.setUint32(at + 4, entry.count, true);
    if (entry.type === 3 && entry.inline.length <= 2 && entry.tag !== 273) {
      for (const [i, value] of entry.inline.entries()) view.setUint16(at + 8 + i * 2, value, true);
    } else {
      view.setUint32(at + 8, entry.inline[0]!, true);
    }
  }

  out.set(Uint8Array.from(overflow), headerSize + ifdSize);
  out.set(pixels, pixelOffset);
  return out;
}

const rgbTiff = (width: number, height: number, pixels: Uint8Array, extra: Field[] = []) =>
  buildTiff(
    [
      { tag: 256, type: 3, values: [width] },
      { tag: 257, type: 3, values: [height] },
      { tag: 258, type: 3, values: [8, 8, 8] },
      { tag: 259, type: 3, values: [1] },
      { tag: 262, type: 3, values: [2] },
      { tag: 273, type: 4, values: [0] },
      { tag: 277, type: 3, values: [3] },
      { tag: 278, type: 3, values: [height] },
      { tag: 279, type: 4, values: [pixels.length] },
      ...extra,
    ],
    pixels,
  );

const pixelAt = (image: RgbaImage, x: number, y: number) =>
  [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];

describe('isTiff', () => {
  it('recognises both byte orders', () => {
    expect(isTiff(Uint8Array.from([0x49, 0x49, 42, 0]))).toBe(true);
    expect(isTiff(Uint8Array.from([0x4d, 0x4d, 0, 42]))).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isTiff(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(isTiff(Uint8Array.from([0x49, 0x49]))).toBe(false);
  });
});

describe('decodeTiff', () => {
  // @lat: [[tests#Media#Decodes uncompressed TIFF strips]]
  it('decodes uncompressed RGB', () => {
    const pixels = Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
    const image = decodeTiff(rgbTiff(2, 2, pixels))!;
    expect([image.width, image.height]).toEqual([2, 2]);
    expect(pixelAt(image, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(image, 1, 0)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(image, 0, 1)).toEqual([0, 0, 255, 255]);
  });

  it('applies the horizontal differencing predictor', () => {
    // Second pixel is stored as a delta from the first.
    const pixels = Uint8Array.from([10, 20, 30, 5, 5, 5]);
    const image = decodeTiff(rgbTiff(2, 1, pixels, [{ tag: 317, type: 3, values: [2] }]))!;
    expect(pixelAt(image, 0, 0)).toEqual([10, 20, 30, 255]);
    expect(pixelAt(image, 1, 0)).toEqual([15, 25, 35, 255]);
  });

  it('inverts a WhiteIsZero greyscale image', () => {
    const tiff = buildTiff(
      [
        { tag: 256, type: 3, values: [2] },
        { tag: 257, type: 3, values: [1] },
        { tag: 258, type: 3, values: [8] },
        { tag: 259, type: 3, values: [1] },
        { tag: 262, type: 3, values: [0] },
        { tag: 273, type: 4, values: [0] },
        { tag: 277, type: 3, values: [1] },
        { tag: 278, type: 3, values: [1] },
        { tag: 279, type: 4, values: [2] },
      ],
      Uint8Array.from([0, 255]),
    );
    const image = decodeTiff(tiff)!;
    expect(pixelAt(image, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(pixelAt(image, 1, 0)).toEqual([0, 0, 0, 255]);
  });

  // @lat: [[tests#Media#Declines TIFF features it does not implement]]
  it('returns undefined for compression it does not implement', () => {
    // LZW is deliberately unsupported; callers fall back to a derivative rather
    // than getting a half-decoded image.
    const lzw = buildTiff(
      [
        { tag: 256, type: 3, values: [1] },
        { tag: 257, type: 3, values: [1] },
        { tag: 258, type: 3, values: [8, 8, 8] },
        { tag: 259, type: 3, values: [5] },
        { tag: 262, type: 3, values: [2] },
        { tag: 273, type: 4, values: [0] },
        { tag: 277, type: 3, values: [3] },
        { tag: 278, type: 3, values: [1] },
        { tag: 279, type: 4, values: [3] },
      ],
      Uint8Array.from([0, 0, 0]),
    );
    expect(decodeTiff(lzw)).toBeUndefined();
  });

  it('returns undefined for bit depths it does not implement', () => {
    const sixteenBit = buildTiff(
      [
        { tag: 256, type: 3, values: [1] },
        { tag: 257, type: 3, values: [1] },
        { tag: 258, type: 3, values: [16, 16, 16] },
        { tag: 259, type: 3, values: [1] },
        { tag: 262, type: 3, values: [2] },
        { tag: 273, type: 4, values: [0] },
        { tag: 277, type: 3, values: [3] },
        { tag: 278, type: 3, values: [1] },
        { tag: 279, type: 4, values: [6] },
      ],
      new Uint8Array(6),
    );
    expect(decodeTiff(sixteenBit)).toBeUndefined();
  });

  it('returns undefined for a non-TIFF payload', () => {
    expect(decodeTiff(Uint8Array.from([1, 2, 3, 4]))).toBeUndefined();
  });
});

describe('unpackBits', () => {
  it('expands literal and repeat runs', () => {
    // 2 -> three literals; -3 -> the next byte four times; 0 -> one literal.
    const input = Uint8Array.from([2, 1, 2, 3, 0xfd, 9, 0, 7]);
    expect([...unpackBits(input)]).toEqual([1, 2, 3, 9, 9, 9, 9, 7]);
  });

  it('treats -128 as a no-op', () => {
    expect([...unpackBits(Uint8Array.from([0x80, 0, 5]))]).toEqual([5]);
  });
});

describe('encodePng', () => {
  const image: RgbaImage = {
    width: 2,
    height: 2,
    data: Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 1, 2, 3, 4]),
  };

  it('writes a signature, IHDR geometry and IEND', () => {
    const png = encodePng(image);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect(String.fromCharCode(...png.subarray(12, 16))).toBe('IHDR');
    expect(view.getUint32(16)).toBe(2);
    expect(view.getUint32(20)).toBe(2);
    expect(png[24]).toBe(8); // bit depth
    expect(png[25]).toBe(6); // RGBA
    expect(String.fromCharCode(...png.subarray(png.length - 8, png.length - 4))).toBe('IEND');
  });

  // @lat: [[tests#Media#Writes IDAT as a zlib stream]]
  it('stores IDAT as a zlib stream, not raw deflate', () => {
    // A bare DEFLATE payload here produces a PNG no browser will decode.
    const png = encodePng(image);
    const start = indexOfChunk(png, 'IDAT');
    const length = new DataView(png.buffer, png.byteOffset).getUint32(start - 8);
    const idat = png.subarray(start + 4, start + 4 + length);
    const raw = inflateSync(Buffer.from(idat));
    // One filter byte per row, then the row's pixels.
    expect(raw.length).toBe((2 * 4 + 1) * 2);
    expect(raw[0]).toBe(0);
    expect([...raw.subarray(1, 9)]).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  });
});

function indexOfChunk(png: Uint8Array, type: string): number {
  for (let i = 8; i < png.length - 4; i++) {
    if (String.fromCharCode(png[i]!, png[i + 1]!, png[i + 2]!, png[i + 3]!) === type) return i;
  }
  throw new Error(`no ${type} chunk`);
}

describe('transcodeImage', () => {
  it('turns a TIFF into a PNG', () => {
    const pixels = Uint8Array.from([1, 2, 3, 4, 5, 6]);
    const result = transcodeImage(rgbTiff(2, 1, pixels), 'image/tiff')!;
    expect(result.mimeType).toBe('image/png');
    expect([...result.bytes.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
  });

  it('leaves formats it does not handle alone', () => {
    expect(canTranscode('image/png')).toBe(false);
    expect(canTranscode('image/tiff')).toBe(true);
    expect(transcodeImage(Uint8Array.from([0x89, 0x50]), 'image/png')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------


describeWithPinnedDeck('serving media from a real deck', () => {
  // @lat: [[tests#Media#Serves the original rather than the thumbnail]]
  it('serves the full-resolution TIFF as PNG, not the small derivative', async () => {
    const document = await readKeynoteFile(fixturePath!);
    const resource = document.deck.resources['9179'];
    expect(resource).toBeDefined();
    // The document also carries `pasted-image-small-9180.png` at 256x159; using
    // it would cost most of the resolution.
    expect(resource!.sourceMimeType).toBe('image/tiff');
    expect(resource!.mimeType).toBe('image/png');

    const served = document.resourceBytes('9179')!;
    const view = new DataView(served.buffer, served.byteOffset);
    expect(view.getUint32(16)).toBe(900);
    expect(view.getUint32(20)).toBe(560);
  });

  it('keeps the stored bytes reachable', async () => {
    const document = await readKeynoteFile(fixturePath!);
    const original = document.originalResourceBytes('9179')!;
    expect(original.length).toBe(1515446);
    expect(document.resourceBytes('9179')!.length).toBeLessThan(original.length);
  });

  it('points every image element at a displayable resource', async () => {
    const { deck } = await readKeynoteFile(fixturePath!);
    const displayable = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/tiff']);
    for (const slide of deck.slides) {
      const walk = (elements: typeof slide.elements): void => {
        for (const element of elements) {
          if (element.kind === 'group') walk(element.children);
          else if (element.kind === 'image' && element.resource) {
            expect(displayable.has(deck.resources[element.resource]!.mimeType)).toBe(true);
            expect(deck.resources[element.resource]!.mimeType).not.toBe('image/tiff');
          }
        }
      };
      walk(slide.elements);
    }
  });
});
