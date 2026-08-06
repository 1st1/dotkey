import { expect, it } from 'vitest';

import { readKeynoteFile } from '../src/node.js';
import { describeWithPinnedDeck, fixturePath } from './fixture.js';
import type { Element } from '../src/model/types.js';

/**
 * End-to-end test against a real presentation. The fixture is a 21-slide deck
 * exported from Keynote 14.4; the expectations below were cross-checked against
 * Keynote's own PDF export.
 */

describeWithPinnedDeck('parsing a real deck', () => {
  const load = async () => readKeynoteFile(fixturePath!);

  // @lat: [[tests#Whole-deck parse#Parses the sample deck without warnings]]
  it('reads the document without warnings', async () => {
    const { deck, warnings } = await load();
    expect(warnings).toHaveLength(0);
    expect(deck.metadata.fileFormatVersion).toBe('14.4.1');
    expect(deck.metadata.theme).toBe('20_BasicBlack');
    expect(deck.size).toEqual({ width: 1920, height: 1080 });
    expect(deck.slides).toHaveLength(21);
  });

  it('recognises every drawable it encounters', async () => {
    const { deck } = await load();
    expect(deck.metadata.unsupported).toEqual({});
  });

  it('numbers slides and keeps them in order', async () => {
    const { deck } = await load();
    expect(deck.slides.map((slide) => slide.index)).toEqual([...Array(21).keys()]);
    expect(deck.slides.map((slide) => slide.number)).toEqual(
      [...Array(21).keys()].map((n) => n + 1),
    );
  });

  it('extracts text with fonts, colours and sizes', async () => {
    const { deck } = await load();
    const run = findRuns(deck.slides[0]!.elements).find((r) =>
      r.text.includes('AI SDK for Python'),
    );
    expect(run).toBeDefined();
    expect(run!.style.fontName).toBe('Geist-Medium');
    expect(run!.style.fontFamily).toBe('Geist');
    expect(run!.style.fontWeight).toBe(500);
    expect(run!.style.fontSize).toBe(40);
    expect(run!.style.color).toMatchObject({ space: 'srgb', a: 1 });
  });

  it('resolves bullets from the list style', async () => {
    const { deck } = await load();
    const bulleted = deck.slides
      .flatMap((slide) => flatten(slide.elements))
      .filter((element) => element.kind === 'shape' && element.text?.paragraphs[0]?.bullet)
      .map((element) => (element.kind === 'shape' ? element.text!.paragraphs[0]!.bullet! : null));

    expect(bulleted.length).toBeGreaterThan(10);
    expect(bulleted.every((bullet) => bullet!.kind === 'text')).toBe(true);
    expect(new Set(bulleted.map((bullet) => bullet!.text))).toContain('•');
  });

  // @lat: [[tests#Whole-deck parse#Anchors auto-height text boxes on their alignment]]
  it('anchors auto-height text boxes on their vertical alignment', async () => {
    const { deck } = await load();
    const centred = flatten(deck.slides[5]!.elements).find(
      (element) =>
        element.kind === 'shape' && element.text?.plainText.startsWith(' Compute is more'),
    );
    expect(centred).toBeDefined();
    expect(centred!.frame.autoHeight).toBe(true);
    // Verified against the PDF: the box is centred on the stored y, not top-aligned.
    expect(centred!.frame.anchorY).toBe('center');
  });

  // @lat: [[tests#Whole-deck parse#Turns an image mask into a frame plus a crop]]
  it('turns an image mask into a frame plus a crop rectangle', async () => {
    const { deck } = await load();
    const masked = deck.slides
      .flatMap((slide) => flatten(slide.elements).concat(flatten(slide.masterElements)))
      .find((element) => element.kind === 'image' && element.crop !== undefined);

    expect(masked).toBeDefined();
    if (masked?.kind !== 'image' || !masked.crop) throw new Error('unreachable');
    // The crop is the full picture positioned relative to the visible frame, so
    // it must be at least as large as the frame it is seen through.
    expect(masked.crop.width).toBeGreaterThanOrEqual(masked.frame.width - 1);
    expect(masked.crop.height).toBeGreaterThanOrEqual(masked.frame.height - 1);
  });

  // @lat: [[tests#Whole-deck parse#Prefers image data a browser can display]]
  it('prefers image data a browser can display', async () => {
    const { deck } = await load();
    const referenced = new Set(
      deck.slides
        .flatMap((slide) => flatten(slide.elements))
        .flatMap((element) => (element.kind === 'image' && element.resource ? [element.resource] : [])),
    );
    // The deck embeds a TIFF; the model must point at its PNG sidecar instead.
    for (const id of referenced) {
      expect(deck.resources[id]!.mimeType).not.toBe('image/tiff');
    }
  });

  it('exposes every referenced font and resource', async () => {
    const { deck } = await load();
    expect(deck.fonts).toContain('Geist-Medium');
    expect(deck.fonts).toContain('HelveticaNeue');
    expect(Object.values(deck.resources).every((resource) => resource.available)).toBe(true);
  });

  // @lat: [[tests#Whole-deck parse#Produces a JSON-serialisable model]]
  it('produces a JSON-serialisable model', async () => {
    const { deck } = await load();
    const roundTripped = JSON.parse(JSON.stringify(deck));
    expect(roundTripped.slides[3]).toEqual(deck.slides[3]);
  });

  it('reads presenter notes', async () => {
    const { deck } = await load();
    const withNotes = deck.slides.filter((slide) => slide.notes);
    expect(withNotes.length).toBeGreaterThan(0);
    expect(withNotes[0]!.notes!.plainText.length).toBeGreaterThan(0);
  });

  it('serves media bytes for a resource', async () => {
    const document = await load();
    const [id] = Object.keys(document.deck.resources);
    const bytes = document.resourceBytes(id!);
    expect(bytes?.length).toBeGreaterThan(0);
  });
});

function flatten(elements: readonly Element[]): Element[] {
  return elements.flatMap((element) =>
    element.kind === 'group' ? [element, ...flatten(element.children)] : [element],
  );
}

function findRuns(elements: readonly Element[]) {
  return flatten(elements).flatMap((element) =>
    element.kind === 'shape' && element.text
      ? element.text.paragraphs.flatMap((paragraph) => paragraph.runs)
      : [],
  );
}
