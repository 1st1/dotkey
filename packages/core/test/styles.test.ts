import { describe, expect, it } from 'vitest';

import { ArchiveStore } from '../src/document/store.js';
import { mergeProperties, resolveProperties, styleChain } from '../src/build/styles.js';
import type { ArchiveRecord } from '../src/iwa/stream.js';

/** Build a store from plain objects, as if they had been read from an IWA. */
function storeOf(objects: Record<number, { name: string; value: unknown }>): ArchiveStore {
  const store = new ArchiveStore();
  const records: ArchiveRecord[] = Object.entries(objects).map(([id, object]) => ({
    id: Number(id),
    messages: [{ type: 0, name: object.name, version: [], value: object.value }],
  }));
  store.add('test.iwa', records);
  return store;
}

describe('style resolution', () => {
  // @lat: [[tests#Style resolution#Merges a style chain from ancestor to leaf]]
  it('merges property bags from ancestor to leaf', () => {
    const store = storeOf({
      1: {
        name: 'TSWP.ParagraphStyleArchive',
        value: {
          super: { name: 'Body' },
          char_properties: { font_size: 48, font_name: 'HelveticaNeue', bold: false },
        },
      },
      2: {
        name: 'TSWP.ParagraphStyleArchive',
        value: {
          super: { parent: { identifier: 1 } },
          char_properties: { font_size: 40, font_name: 'Geist-Medium' },
        },
      },
    });

    expect(resolveProperties(store, { identifier: 2 }, 'char_properties')).toEqual({
      font_size: 40,
      font_name: 'Geist-Medium',
      bold: false,
    });
  });

  // @lat: [[tests#Style resolution#Applies a null flag as an explicit clear]]
  it('lets a `_null` flag clear an inherited value', () => {
    const store = storeOf({
      1: {
        name: 'TSWP.CharacterStyleArchive',
        value: { super: {}, char_properties: { font_color: { model: 'rgb', r: 1 } } },
      },
      2: {
        name: 'TSWP.CharacterStyleArchive',
        value: {
          super: { parent: { identifier: 1 } },
          char_properties: { font_color_null: true, bold: true },
        },
      },
    });

    const resolved = resolveProperties(store, { identifier: 2 }, 'char_properties');
    expect(resolved).toEqual({ bold: true });
    expect(resolved['font_color']).toBeUndefined();
  });

  // @lat: [[tests#Style resolution#Collects same-named bags from every super level]]
  it('collects same-named bags from every level of the super stack', () => {
    // TSWP.ShapeStyleArchive carries text-frame properties; the TSD archive it
    // wraps carries fill and stroke. Both are called `shape_properties`.
    const store = storeOf({
      1: {
        name: 'TSWP.ShapeStyleArchive',
        value: {
          super: {
            super: { name: 'textbox' },
            shape_properties: { opacity: 1, stroke: { width: 2 } },
          },
          shape_properties: { vertical_alignment: 'kFrameAlignMiddle' },
        },
      },
    });

    expect(resolveProperties(store, { identifier: 1 }, 'shape_properties')).toEqual({
      opacity: 1,
      stroke: { width: 2 },
      vertical_alignment: 'kFrameAlignMiddle',
    });
  });

  // @lat: [[tests#Style resolution#Survives a cycle in the parent chain]]
  it('stops at a cycle in the parent chain', () => {
    const store = storeOf({
      1: { name: 'S', value: { super: { parent: { identifier: 2 } } } },
      2: { name: 'S', value: { super: { parent: { identifier: 1 } } } },
    });
    expect(styleChain(store, { identifier: 1 })).toHaveLength(2);
  });

  it('returns an empty bag for a missing style', () => {
    const store = storeOf({});
    expect(resolveProperties(store, { identifier: 99 }, 'char_properties')).toEqual({});
    expect(resolveProperties(store, undefined, 'char_properties')).toEqual({});
  });
});

describe('mergeProperties', () => {
  it('applies overrides on top of a resolved bag', () => {
    expect(mergeProperties({ a: 1, b: 2 }, { b: 3 }, { c: 4 })).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('applies null flags after values', () => {
    expect(mergeProperties({ color: 'red' }, { color: 'blue', color_null: true })).toEqual({});
  });
});
