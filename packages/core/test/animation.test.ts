import { describe, expect, it } from 'vitest';

import { directionVector, toBuilds, toTransition } from '../src/build/animation.js';
import { BuildContext } from '../src/build/context.js';
import { KeynoteBundle } from '../src/document/bundle.js';
import { ArchiveStore } from '../src/document/store.js';
import { readKeynoteFile } from '../src/node.js';
import { describeWithPinnedDeck, fixturePath } from './fixture.js';
import type { ArchiveRecord } from '../src/iwa/stream.js';

describe('toTransition', () => {
  const wrap = (attributes: unknown) => ({ attributes: { animationAttributes: attributes } });

  it('reads effect, duration and delay', () => {
    expect(
      toTransition(wrap({ effect: 'apple:dissolve', duration: 1.5, delay: 0.5, animation_type: 'Transition' })),
    ).toMatchObject({ effect: 'apple:dissolve', kind: 'dissolve', duration: 1.5, delay: 0.5 });
  });

  it('treats a "none" effect as no transition', () => {
    // Keynote writes a full attribute record even for slides with no transition.
    expect(toTransition(wrap({ effect: 'none', duration: 1, delay: 0.5 }))).toBeUndefined();
    expect(toTransition(wrap({}))).toBeUndefined();
    expect(toTransition(undefined)).toBeUndefined();
  });

  it.each([
    ['apple:dissolve', 'dissolve'],
    ['apple:magic-move', 'magicMove'],
    ['apple:fade-through-color', 'fadeThroughColor'],
    ['apple:push', 'push'],
    ['apple:move-in', 'moveIn'],
    ['apple:reveal', 'reveal'],
    ['apple:wipe', 'wipe'],
    ['apple:objectcube', 'cube'],
    ['apple:confetti', 'unsupported'],
  ])('classifies %s as %s', (effect, kind) => {
    expect(toTransition(wrap({ effect }))?.kind).toBe(kind);
  });

  // @lat: [[tests#Animation#Normalises effect ids to a renderable family]]
  it('prefers the longest matching effect name', () => {
    // "objectcube" must not be mistaken for "cube" alone, nor "move-in" for "reveal".
    expect(toTransition(wrap({ effect: 'apple:objectzoom' }))?.kind).toBe('scale');
  });

  it('marks automatic advance and direction', () => {
    const transition = toTransition(wrap({ effect: 'apple:push', is_automatic: true, direction: 1 }));
    expect(transition).toMatchObject({ automatic: true, direction: 'rightToLeft', directionValue: 1 });
  });
});

describe('directionVector', () => {
  it('maps directions to screen-space unit vectors', () => {
    expect(directionVector('leftToRight')).toEqual({ x: 1, y: 0 });
    expect(directionVector('rightToLeft')).toEqual({ x: -1, y: 0 });
    expect(directionVector('topToBottom')).toEqual({ x: 0, y: 1 });
    expect(directionVector('bottomToTop')).toEqual({ x: 0, y: -1 });
  });
});

describe('toBuilds', () => {
  /** Assemble a store of build/chunk archives without touching a real file. */
  function context(objects: Record<number, { name: string; value: unknown }>): BuildContext {
    const store = new ArchiveStore();
    const records: ArchiveRecord[] = Object.entries(objects).map(([id, object]) => ({
      id: Number(id),
      messages: [{ type: 0, name: object.name, version: [], value: object.value }],
    }));
    store.add('test.iwa', records);
    // BuildContext only needs the store and the data index for this test.
    return new BuildContext({ store, data: () => undefined } as unknown as KeynoteBundle);
  }

  const build = (drawable: number, effect: string, type = 'In', extra: object = {}) => ({
    name: 'KN.BuildArchive',
    value: {
      drawable: { identifier: drawable },
      delivery: 'All at Once',
      attributes: { animationAttributes: { animation_type: type, effect, duration: 1 }, ...extra },
    },
  });

  const chunk = (buildId: number, automatic: boolean, duration = 1) => ({
    name: 'KN.BuildChunkArchive',
    value: { build: { identifier: buildId }, automatic, duration, delay: 0 },
  });

  // @lat: [[tests#Animation#Assigns a click stage per non-automatic chunk]]
  it('gives each click chunk its own stage', () => {
    const ctx = context({
      10: build(1, 'apple:dissolve'),
      11: build(2, 'apple:dissolve'),
      20: chunk(10, false),
      21: chunk(11, false),
    });
    const result = toBuilds(ctx, [{ identifier: 10 }, { identifier: 11 }], [
      { identifier: 20 },
      { identifier: 21 },
    ]);
    expect(result.stageCount).toBe(2);
    expect(result.builds.map((b) => b.stage)).toEqual([1, 2]);
    expect(result.builds.map((b) => b.trigger)).toEqual(['onClick', 'onClick']);
  });

  it('joins automatic chunks to the stage in progress', () => {
    const ctx = context({
      10: build(1, 'apple:dissolve'),
      11: build(2, 'apple:dissolve'),
      12: build(3, 'apple:dissolve'),
      20: chunk(10, false),
      21: chunk(11, true),
      22: chunk(12, false),
    });
    const result = toBuilds(
      ctx,
      [{ identifier: 10 }, { identifier: 11 }, { identifier: 12 }],
      [{ identifier: 20 }, { identifier: 21 }, { identifier: 22 }],
    );
    expect(result.stageCount).toBe(2);
    expect(result.builds.map((b) => b.stage)).toEqual([1, 1, 2]);
    expect(result.builds.map((b) => b.trigger)).toEqual(['onClick', 'automatic', 'onClick']);
  });

  // @lat: [[tests#Animation#Plays a leading automatic chunk on slide entry]]
  it('puts a leading automatic chunk on stage 0, so the slide needs no click', () => {
    const ctx = context({
      10: build(1, 'apple:movie-start'),
      20: chunk(10, true),
    });
    const result = toBuilds(ctx, [{ identifier: 10 }], [{ identifier: 20 }]);
    expect(result.stageCount).toBe(0);
    expect(result.builds[0]).toMatchObject({ stage: 0, animation: { type: 'media' } });
  });

  it('takes duration and delay from the chunk, which overrides the build', () => {
    const ctx = context({
      10: build(1, 'apple:dissolve'),
      20: { name: 'KN.BuildChunkArchive', value: { build: { identifier: 10 }, automatic: false, duration: 0.4, delay: 0.25 } },
    });
    const result = toBuilds(ctx, [{ identifier: 10 }], [{ identifier: 20 }]);
    expect(result.builds[0]).toMatchObject({ duration: 0.4, delay: 0.25 });
  });

  it('still plays builds the chunk list forgot', () => {
    const ctx = context({ 10: build(1, 'apple:dissolve') });
    const result = toBuilds(ctx, [{ identifier: 10 }], []);
    expect(result.stageCount).toBe(1);
    expect(result.builds).toHaveLength(1);
  });

  it.each([
    ['apple:appear', 'appear'],
    ['apple:bc-appear', 'appear'],
    ['apple:dissolve', 'fade'],
    ['apple:dissolve character', 'fade'],
    ['apple:move-in', 'move'],
    ['apple:scale', 'scale'],
    ['apple:blur', 'blur'],
    ['apple:blinds', 'wipe'],
    ['apple:movie-start', 'media'],
  ])('maps the %s build-in to %s', (effect, type) => {
    const ctx = context({ 10: build(1, effect) });
    const result = toBuilds(ctx, [{ identifier: 10 }], []);
    expect(result.builds[0]!.animation.type).toBe(type);
  });

  it('reads an opacity action target', () => {
    const ctx = context({
      10: build(1, 'apple:action-opacity', 'Action', { action_colorAlpha: 0.25 }),
    });
    const result = toBuilds(ctx, [{ identifier: 10 }], []);
    expect(result.builds[0]!.animation).toEqual({ type: 'opacity', to: 0.25 });
    expect(result.builds[0]!.kind).toBe('action');
  });

  it('reads a rotation action', () => {
    const ctx = context({
      10: build(1, 'apple:action-rotate', 'Action', {
        action_rotationAngle: 180,
        action_rotationDirection: 'kCounterclockwise',
      }),
    });
    const result = toBuilds(ctx, [{ identifier: 10 }], []);
    expect(result.builds[0]!.animation).toEqual({ type: 'rotate', angle: 180, clockwise: false });
  });

  // @lat: [[tests#Animation#Reads a motion path as offsets from the element position]]
  it('reads a motion path as offsets from the element position', () => {
    const ctx = context({
      10: build(1, 'apple:action-motion-path', 'Action', {
        action_motionPathSource: {
          editable_bezier_path_source: {
            naturalSize: { width: 100, height: 0 },
            subpaths: [
              {
                closed: false,
                nodes: [
                  {
                    inControlPoint: { x: 0, y: 0 },
                    nodePoint: { x: 0, y: 0 },
                    outControlPoint: { x: 0, y: 0 },
                    type: 'sharp',
                  },
                  {
                    inControlPoint: { x: 100, y: 0 },
                    nodePoint: { x: 100, y: 0 },
                    outControlPoint: { x: 100, y: 0 },
                    type: 'sharp',
                  },
                ],
              },
            ],
          },
        },
      }),
    });
    const animation = toBuilds(ctx, [{ identifier: 10 }], []).builds[0]!.animation;
    expect(animation.type).toBe('motionPath');
    if (animation.type !== 'motionPath') throw new Error('unreachable');
    expect(animation.d).toBe('M0 0 C0 0 100 0 100 0');
  });

  it('maps acceleration onto an easing curve', () => {
    const ctx = context({
      10: build(1, 'apple:dissolve', 'In', { action_acceleration: 'kEaseIn' }),
    });
    expect(toBuilds(ctx, [{ identifier: 10 }], []).builds[0]!.easing).toBe('easeIn');
  });

  it('reads text delivery', () => {
    const ctx = context({
      10: build(1, 'apple:dissolve', 'In', { custom_textDelivery: 'kTextDeliveryByWord' }),
    });
    expect(toBuilds(ctx, [{ identifier: 10 }], []).builds[0]!.delivery).toBe('word');
  });

  it('returns nothing when the slide has no builds', () => {
    expect(toBuilds(context({}), [], [])).toEqual({ builds: [], stageCount: 0 });
    expect(toBuilds(context({}), undefined, undefined)).toEqual({ builds: [], stageCount: 0 });
  });
});


describeWithPinnedDeck('animation in a real deck', () => {
  it('extracts every build and recognises every effect', async () => {
    const { deck } = await readKeynoteFile(fixturePath!);
    const builds = deck.slides.flatMap((slide) => slide.builds);
    expect(builds).toHaveLength(70);
    expect(builds.every((build) => build.animation.type !== 'unsupported')).toBe(true);
  });

  it('sequences the action builds on the title slide', async () => {
    const { deck } = await readKeynoteFile(fixturePath!);
    const slide = deck.slides[0]!;
    expect(slide.stageCount).toBe(1);
    // One click, then all three actions play together.
    expect(slide.builds.map((build) => [build.stage, build.animation.type, build.trigger])).toEqual([
      [1, 'motionPath', 'onClick'],
      [1, 'opacity', 'automatic'],
      [1, 'motionPath', 'automatic'],
    ]);
  });

  it('gives each dissolve build-in its own click', async () => {
    const { deck } = await readKeynoteFile(fixturePath!);
    const slide = deck.slides[7]!;
    expect(slide.stageCount).toBe(7);
    expect(slide.builds.map((build) => build.stage)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(slide.builds.every((build) => build.kind === 'in')).toBe(true);
  });

  it('reads the deck\'s one transition', async () => {
    const { deck } = await readKeynoteFile(fixturePath!);
    const withTransition = deck.slides.filter((slide) => slide.transition);
    expect(withTransition).toHaveLength(1);
    expect(withTransition[0]!.transition).toMatchObject({
      effect: 'apple:dissolve',
      kind: 'dissolve',
      duration: 1.5,
    });
  });

  it('only animates elements that survived into the model', async () => {
    const { deck } = await readKeynoteFile(fixturePath!);
    for (const slide of deck.slides) {
      const ids = new Set<string>();
      const walk = (elements: typeof slide.elements) => {
        for (const element of elements) {
          ids.add(element.id);
          if (element.kind === 'group') walk(element.children);
        }
      };
      walk(slide.elements);
      for (const build of slide.builds) expect(ids.has(build.elementId)).toBe(true);
    }
  });

  it('drops all animation when includeAnimation is off', async () => {
    const { deck } = await readKeynoteFile(fixturePath!, { includeAnimation: false });
    expect(deck.slides.every((slide) => slide.builds.length === 0)).toBe(true);
    expect(deck.slides.every((slide) => slide.stageCount === 0)).toBe(true);
    expect(deck.slides.every((slide) => slide.transition === undefined)).toBe(true);
  });
});
