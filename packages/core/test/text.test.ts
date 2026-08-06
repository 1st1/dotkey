import { describe, expect, it } from 'vitest';

import { BuildContext } from '../src/build/context.js';
import { buildTextBlock } from '../src/build/text.js';
import type { KeynoteBundle } from '../src/document/bundle.js';
import { ArchiveStore } from '../src/document/store.js';
import type { ArchiveRecord } from '../src/iwa/stream.js';
import { readKeynoteFile } from '../src/node.js';
import { describeWithPinnedDeck, fixturePath } from './fixture.js';
import type { Element, Run } from '../src/model/types.js';

// ---------------------------------------------------------------------------
// Attribute table semantics
// ---------------------------------------------------------------------------

function contextOf(objects: Record<number, { name: string; value: unknown }>): BuildContext {
  const store = new ArchiveStore();
  const records: ArchiveRecord[] = Object.entries(objects).map(([id, object]) => ({
    id: Number(id),
    messages: [{ type: 0, name: object.name, version: [], value: object.value }],
  }));
  store.add('test.iwa', records);
  return new BuildContext({ store, data: () => undefined } as unknown as KeynoteBundle);
}

const rgb = (r: number, g: number, b: number) => ({ model: 'rgb', r, g, b, a: 1 });

/** A storage whose tables exercise both null-entry conventions. */
const STORAGE = {
  name: 'TSWP.StorageArchive',
  value: {
    text: ['plain RED plain\nsecond line'],
    table_para_style: {
      // Two paragraphs; the second carries no object, meaning "same as before".
      entries: [{ character_index: 0, object: { identifier: 2 } }, { character_index: 16, object: null }],
    },
    table_char_style: {
      // A null entry *clears* the override rather than carrying it forward.
      entries: [
        { character_index: 0, object: null },
        { character_index: 6, object: { identifier: 3 } },
        { character_index: 9, object: null },
      ],
    },
  },
};

const PARAGRAPH_STYLE = {
  name: 'TSWP.ParagraphStyleArchive',
  value: {
    super: { name: 'Body' },
    char_properties: { font_size: 20, font_name: 'HelveticaNeue', font_color: rgb(1, 1, 1) },
    para_properties: { alignment: 'TATvalue2' },
  },
};

const CHARACTER_STYLE = {
  name: 'TSWP.CharacterStyleArchive',
  value: { super: {}, char_properties: { font_color: rgb(1, 0, 0) } },
};

describe('attribute tables', () => {
  const block = () =>
    buildTextBlock(
      contextOf({ 1: STORAGE, 2: PARAGRAPH_STYLE, 3: CHARACTER_STYLE }),
      { identifier: 1 },
    )!;

  // @lat: [[tests#Text#Splits runs at every character style boundary]]
  it('splits runs where a character style starts and stops', () => {
    const runs = block().paragraphs[0]!.runs;
    expect(runs.map((run) => run.text)).toEqual(['plain ', 'RED', ' plain']);
  });

  // @lat: [[tests#Text#Clears a character override at a null entry]]
  it('clears a character override at a null entry', () => {
    const runs = block().paragraphs[0]!.runs;
    const red = { space: 'srgb', r: 1, g: 0, b: 0, a: 1 };
    const white = { space: 'srgb', r: 1, g: 1, b: 1, a: 1 };
    // Without this rule the red would bleed to the end of the paragraph.
    expect(runs.map((run) => run.style.color)).toEqual([white, red, white]);
  });

  // @lat: [[tests#Text#Carries a paragraph style forward across a null entry]]
  it('carries a paragraph style forward across a null entry', () => {
    const paragraphs = block().paragraphs;
    expect(paragraphs).toHaveLength(2);
    // Both paragraphs resolve to the one style the table names, including its
    // paragraph properties.
    expect(paragraphs.map((p) => p.defaultStyle.fontSize)).toEqual([20, 20]);
    expect(paragraphs.map((p) => p.align)).toEqual(['center', 'center']);
  });

  it('excludes the paragraph separator from the run text', () => {
    expect(block().paragraphs[1]!.runs.map((run) => run.text)).toEqual(['second line']);
    expect(block().plainText).toBe('plain RED plain\nsecond line');
  });

  // @lat: [[tests#Text#Suppresses paragraph spacing at frame edges]]
  it('suppresses paragraph spacing at the edges of the frame', () => {
    const context = contextOf({
      1: STORAGE,
      2: {
        name: 'TSWP.ParagraphStyleArchive',
        value: {
          super: { name: 'Body' },
          char_properties: { font_size: 20 },
          para_properties: { space_before: 45, space_after: 30 },
        },
      },
      3: CHARACTER_STYLE,
    });
    const paragraphs = buildTextBlock(context, { identifier: 1 })!.paragraphs;
    expect(paragraphs[0]!.spaceBefore).toBe(0);
    expect(paragraphs[0]!.spaceAfter).toBe(30);
    expect(paragraphs[1]!.spaceBefore).toBe(45);
    expect(paragraphs[1]!.spaceAfter).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The same rules against the real deck
// ---------------------------------------------------------------------------


function flatten(elements: readonly Element[]): Element[] {
  return elements.flatMap((element) =>
    element.kind === 'group' ? [element, ...flatten(element.children)] : [element],
  );
}

function runsOf(elements: readonly Element[], startsWith: string): Run[] | undefined {
  for (const element of flatten(elements)) {
    if (element.kind !== 'shape' || !element.text) continue;
    for (const paragraph of element.text.paragraphs) {
      const text = paragraph.runs.map((run) => run.text).join('');
      if (text.trim().startsWith(startsWith)) return paragraph.runs;
    }
  }
  return undefined;
}

const hex = (run: Run) =>
  run.style.color
    ? [run.style.color.r, run.style.color.g, run.style.color.b]
        .map((channel) => Math.round(channel * 255))
        .join(',')
    : 'none';

describeWithPinnedDeck('character style runs in a real deck', () => {
  it('ends a colour override where the attribute table clears it', async () => {
    const { deck } = await readKeynoteFile(fixturePath!);
    const runs = runsOf(deck.slides[3]!.elements, 'FastAPI + Flask');
    expect(runs).toBeDefined();

    // The storage's character-style table is
    //   @0 null, @1 orange, @16 null, @42 green, @49 null
    // so the line reads white / orange / white / green / white, starting with
    // the single space the author typed before the first word.
    expect(runs!.map((run) => run.text)).toEqual([
      ' ',
      'FastAPI + Flask',
      ' are almost as popular as ',
      'Express',
      ' on Vercel',
    ]);
    expect(runs!.map(hex)).toEqual([
      '255,255,255',
      '255,147,1',
      '255,255,255',
      '29,177,0',
      '255,255,255',
    ]);
  });

  it('never leaves two adjacent runs with identical styling', async () => {
    const { deck } = await readKeynoteFile(fixturePath!);
    for (const slide of deck.slides) {
      for (const element of flatten(slide.elements)) {
        if (element.kind !== 'shape' || !element.text) continue;
        for (const paragraph of element.text.paragraphs) {
          for (let i = 1; i < paragraph.runs.length; i++) {
            const a = paragraph.runs[i - 1]!;
            const b = paragraph.runs[i]!;
            const identical =
              hex(a) === hex(b) &&
              a.style.fontName === b.style.fontName &&
              a.style.fontSize === b.style.fontSize;
            expect(identical).toBe(false);
          }
        }
      }
    }
  });
});
