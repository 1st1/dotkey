import { describe, expect, it } from 'vitest';

import { snappyDecompress, SnappyError } from '../src/iwa/snappy.js';

/** Build a Snappy block: varint length preamble + tagged elements. */
function block(uncompressedLength: number, ...body: number[]): Uint8Array {
  const preamble: number[] = [];
  let value = uncompressedLength;
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value > 0) byte |= 0x80;
    preamble.push(byte);
  } while (value > 0);
  return new Uint8Array([...preamble, ...body]);
}

const literal = (bytes: number[]) => [(bytes.length - 1) << 2, ...bytes];
const text = (value: string) => [...value].map((c) => c.charCodeAt(0));
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('snappyDecompress', () => {
  // @lat: [[tests#Container layer#Decodes a literal Snappy block]]
  it('decodes a short literal', () => {
    const out = snappyDecompress(block(5, ...literal(text('hello'))));
    expect(decode(out)).toBe('hello');
  });

  it('decodes a literal with a one-byte extended length', () => {
    const payload = 'x'.repeat(100);
    const out = snappyDecompress(block(100, 60 << 2, 99, ...text(payload)));
    expect(decode(out)).toBe(payload);
  });

  it('decodes a 1-byte-offset back reference', () => {
    // "abcd" then copy 4 bytes from offset 4 -> "abcdabcd"
    const tag = (1 << 0) | ((4 - 4) << 2) | ((4 >> 8) << 5);
    const out = snappyDecompress(block(8, ...literal(text('abcd')), tag, 4 & 0xff));
    expect(decode(out)).toBe('abcdabcd');
  });

  // @lat: [[tests#Container layer#Handles overlapping back-references]]
  it('handles overlapping copies, which encode runs', () => {
    // "a" then copy 5 bytes from offset 1 -> "aaaaaa"
    const tag = (1 << 0) | ((5 - 4) << 2);
    const out = snappyDecompress(block(6, ...literal(text('a')), tag, 1));
    expect(decode(out)).toBe('aaaaaa');
  });

  it('decodes a 2-byte-offset back reference', () => {
    const source = 'abcdefgh';
    const tag = 2 | ((4 - 1) << 2);
    const out = snappyDecompress(block(12, ...literal(text(source)), tag, 8, 0));
    expect(decode(out)).toBe('abcdefghabcd');
  });

  // @lat: [[tests#Container layer#Rejects a corrupt block]]
  it('rejects a block whose output is short', () => {
    expect(() => snappyDecompress(block(99, ...literal(text('hi'))))).toThrow(SnappyError);
  });

  it('rejects a copy that reaches before the start of the output', () => {
    const tag = (1 << 0) | ((4 - 4) << 2);
    expect(() => snappyDecompress(block(4, tag, 9))).toThrow(SnappyError);
  });
});
