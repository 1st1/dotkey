import { expect, it } from 'vitest';

import { googleFontsUrl, planFonts } from '../src/fonts/plan.js';
import { readKeynoteFile } from '../src/node.js';
import type { Deck, Element } from '../src/model/types.js';
import { describeWithDeck, fixturePath } from './fixture.js';

/**
 * Properties that must hold for *any* presentation.
 *
 * These are the tests that keep working when the deck is swapped, so they are
 * the ones that catch a regression on someone else's file. Anything asserting a
 * particular slide, colour or size belongs in a pinned suite instead.
 */

function flatten(elements: readonly Element[]): Element[] {
  return elements.flatMap((element) =>
    element.kind === 'group' ? [element, ...flatten(element.children)] : [element],
  );
}

function everyElement(deck: Deck): Element[] {
  return deck.slides.flatMap((slide) => [
    ...flatten(slide.elements),
    ...flatten(slide.masterElements),
  ]);
}

const load = () => readKeynoteFile(fixturePath!);

// @lat: [[tests#Invariants hold for any deck#Holds structural properties on any deck]]
describeWithDeck('any deck', () => {
  it('parses without warnings', async () => {
    const { warnings } = await load();
    expect(warnings).toEqual([]);
  });

  it('reports a size, a format version and at least one slide', async () => {
    const { deck } = await load();
    expect(deck.size.width).toBeGreaterThan(0);
    expect(deck.size.height).toBeGreaterThan(0);
    expect(deck.metadata.fileFormatVersion).toMatch(/^\d+\./);
    expect(deck.slides.length).toBeGreaterThan(0);
  });

  it('numbers slides contiguously and only counts the ones on show', async () => {
    const { deck } = await load();
    expect(deck.slides.map((slide) => slide.index)).toEqual([...deck.slides.keys()]);
    const numbered = deck.slides.filter((slide) => !slide.skipped);
    expect(numbered.map((slide) => slide.number)).toEqual(numbered.map((_, i) => i + 1));
    expect(deck.slides.filter((slide) => slide.skipped).every((s) => s.number === null)).toBe(true);
  });

  it('gives every element a finite frame and a unique id', async () => {
    const { deck } = await load();
    const seen = new Set<string>();
    for (const element of everyElement(deck)) {
      for (const value of [element.frame.x, element.frame.y, element.frame.width, element.frame.height]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(element.opacity).toBeGreaterThanOrEqual(0);
      expect(element.opacity).toBeLessThanOrEqual(1);
      seen.add(element.id);
    }
    // Ids come from archive identifiers, which are unique per document.
    expect(seen.size).toBe(everyElement(deck).length);
  });

  it('resolves every text run to a usable font and size', async () => {
    const { deck } = await load();
    for (const element of everyElement(deck)) {
      if (element.kind !== 'shape' || !element.text) continue;
      for (const paragraph of element.text.paragraphs) {
        for (const run of paragraph.runs) {
          expect(run.style.fontSize).toBeGreaterThan(0);
          expect(run.style.fontFamily.length).toBeGreaterThan(0);
          expect(run.style.fontWeight).toBeGreaterThanOrEqual(100);
          expect(run.style.fontWeight).toBeLessThanOrEqual(900);
        }
      }
    }
  });

  it('only references resources the document declares', async () => {
    const { deck } = await load();
    for (const element of everyElement(deck)) {
      const ids =
        element.kind === 'image' ? [element.resource]
        : element.kind === 'movie' ? [element.resource, element.poster]
        : [];
      for (const id of ids) {
        if (id === null || id === undefined) continue;
        expect(deck.resources[id]).toBeDefined();
      }
    }
  });

  it('never points an image at a format the browser cannot show', async () => {
    const { deck } = await load();
    // TIFF is transcoded on access; anything still undisplayable would render
    // as a broken image.
    const undisplayable = ['image/tiff', 'image/heic', 'application/octet-stream'];
    for (const element of everyElement(deck)) {
      if (element.kind !== 'image' || !element.resource) continue;
      const resource = deck.resources[element.resource]!;
      if (!resource.available) continue;
      expect(undisplayable).not.toContain(resource.mimeType);
    }
  });

  it('serves bytes matching each resource\'s advertised type', async () => {
    const document = await load();
    for (const resource of Object.values(document.deck.resources)) {
      if (!resource.available) continue;
      const bytes = document.resourceBytes(resource.id);
      expect(bytes).toBeDefined();
      if (resource.mimeType === 'image/png') {
        expect([...bytes!.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
      }
    }
  });

  it('only animates elements that exist on the slide', async () => {
    const { deck } = await load();
    for (const slide of deck.slides) {
      const ids = new Set(flatten(slide.elements).map((element) => element.id));
      for (const build of slide.builds) expect(ids.has(build.elementId)).toBe(true);
    }
  });

  it('keeps build stages within the slide\'s stage count', async () => {
    const { deck } = await load();
    for (const slide of deck.slides) {
      for (const build of slide.builds) {
        expect(build.stage).toBeGreaterThanOrEqual(0);
        expect(build.stage).toBeLessThanOrEqual(slide.stageCount);
        expect(build.duration).toBeGreaterThanOrEqual(0);
        expect(build.delay).toBeGreaterThanOrEqual(0);
      }
      // A slide needing clicks must have a build on its last stage.
      if (slide.stageCount > 0) {
        expect(slide.builds.some((build) => build.stage === slide.stageCount)).toBe(true);
      }
    }
  });

  it('produces a JSON-serialisable model', async () => {
    const { deck } = await load();
    expect(JSON.parse(JSON.stringify(deck))).toEqual(deck);
  });

  it('plans a font request that names only weights the family publishes', async () => {
    const { deck } = await load();
    const planned = planFonts(deck.fonts);
    expect(planned.every((font) => font.faces.length > 0)).toBe(true);
    for (const font of planned) {
      if (font.source !== 'google') expect(font.available).toEqual([]);
    }
    const url = googleFontsUrl(planned);
    if (url) expect(url).toMatch(/^https:\/\/fonts\.googleapis\.com\/css2\?family=/);
  });

  it('reports unsupported archives rather than throwing', async () => {
    const { deck } = await load();
    // Tables and charts are modelled but not drawn; they must degrade to a
    // placeholder with geometry, never take the parse down.
    for (const [archive, count] of Object.entries(deck.metadata.unsupported)) {
      expect(typeof archive).toBe('string');
      expect(count).toBeGreaterThan(0);
    }
    for (const element of everyElement(deck)) {
      if (element.kind === 'unsupported') expect(element.archive.length).toBeGreaterThan(0);
    }
  });
});
