import { describe, expect, it } from 'vitest';

import { toFill, toStroke } from '../src/build/paint.js';
import { BuildContext } from '../src/build/context.js';
import { ArchiveStore } from '../src/document/store.js';
import type { KeynoteBundle } from '../src/document/bundle.js';
import { expandGradientStops, mix } from '../src/model/gradient.js';
import type { Gradient } from '../src/model/types.js';

function context(): BuildContext {
  return new BuildContext({
    store: new ArchiveStore(),
    data: () => undefined,
  } as unknown as KeynoteBundle);
}

const black = { model: 'rgb', r: 0, g: 0, b: 0, a: 1 };
const clear = { model: 'rgb', r: 0, g: 0, b: 0, a: 0 };

describe('gradient fills', () => {
  const linear = (gradient: object) => ({
    gradient: { type: 'Linear', stops: [{ color: black, fraction: 0 }, { color: clear, fraction: 1 }], ...gradient },
  });

  // @lat: [[tests#Paint#Reads the gradient angle from the gradientangle field]]
  it('reads the angle from `gradientangle`', () => {
    // Keynote measures counter-clockwise from "pointing right", so its 0 degrees
    // is a left-to-right ramp, which CSS spells as 90deg.
    const fill = toFill(context(), linear({ anglegradient: { gradientangle: 0 } }));
    expect(fill).toMatchObject({ type: 'gradient', gradient: { angle: 90, type: 'linear' } });
  });

  it.each([
    [0, 90],
    [90, 0],
    [180, 270],
    [270, 180],
  ])('converts a %s degree Keynote angle to %s degrees of CSS', (stored, css) => {
    const fill = toFill(context(), linear({ anglegradient: { gradientangle: stored } }));
    expect(fill?.type === 'gradient' && fill.gradient.angle).toBe(css);
  });

  // @lat: [[tests#Paint#Preserves stop alpha]]
  it('preserves stop alpha, so a fade to transparent survives', () => {
    const fill = toFill(context(), linear({ anglegradient: { gradientangle: 0 } }));
    if (fill?.type !== 'gradient') throw new Error('unreachable');
    expect(fill.gradient.stops.map((stop) => stop.color.a)).toEqual([1, 0]);
  });

  // @lat: [[tests#Paint#Derives an angle from an advanced gradient axis]]
  it('derives the angle from the axis of an advanced gradient', () => {
    const horizontal = toFill(
      context(),
      linear({ transformgradient: { start: { x: 0, y: 5 }, end: { x: 10, y: 5 } } }),
    );
    expect(horizontal?.type === 'gradient' && horizontal.gradient.angle).toBe(90);

    const vertical = toFill(
      context(),
      linear({ transformgradient: { start: { x: 5, y: 0 }, end: { x: 5, y: 10 } } }),
    );
    expect(vertical?.type === 'gradient' && vertical.gradient.angle).toBe(180);
  });

  it('falls back to top-to-bottom when no axis is recorded', () => {
    const fill = toFill(context(), linear({}));
    expect(fill?.type === 'gradient' && fill.gradient.angle).toBe(180);
  });

  it('sorts stops by position', () => {
    const fill = toFill(context(), {
      gradient: {
        type: 'Linear',
        stops: [{ color: clear, fraction: 1 }, { color: black, fraction: 0 }],
        anglegradient: { gradientangle: 0 },
      },
    });
    if (fill?.type !== 'gradient') throw new Error('unreachable');
    expect(fill.gradient.stops.map((stop) => stop.offset)).toEqual([0, 1]);
  });

  it('reads a radial gradient', () => {
    const fill = toFill(context(), { gradient: { type: 'Radial', stops: [{ color: black, fraction: 0 }] } });
    expect(fill?.type === 'gradient' && fill.gradient.type).toBe('radial');
  });
});

describe('expandGradientStops', () => {
  const stops = (inflection?: number): Gradient => ({
    type: 'linear',
    angle: 90,
    stops: [
      { color: { space: 'srgb', r: 0, g: 0, b: 0, a: 1 }, offset: 0, ...(inflection !== undefined ? { inflection } : {}) },
      { color: { space: 'srgb', r: 1, g: 1, b: 1, a: 1 }, offset: 1 },
    ],
  });

  it('leaves a default midpoint untouched', () => {
    expect(expandGradientStops(stops(0.5))).toHaveLength(2);
    expect(expandGradientStops(stops())).toHaveLength(2);
  });

  // @lat: [[tests#Paint#Expands a dragged gradient midpoint]]
  it('inserts an explicit stop for a dragged midpoint', () => {
    // CSS and SVG always blend linearly, so an off-centre midpoint has to become
    // a real stop holding the 50/50 mix.
    const expanded = expandGradientStops(stops(0.25));
    expect(expanded).toHaveLength(3);
    expect(expanded[1]).toMatchObject({ offset: 0.25 });
    expect(expanded[1]!.color.r).toBeCloseTo(0.5);
  });

  it('skips a midpoint that has collapsed onto an end', () => {
    expect(expandGradientStops(stops(0))).toHaveLength(2);
    expect(expandGradientStops(stops(1))).toHaveLength(2);
  });

  it('passes a single stop straight through', () => {
    const single: Gradient = { type: 'linear', angle: 0, stops: [stops().stops[0]!] };
    expect(expandGradientStops(single)).toHaveLength(1);
  });
});

describe('mix', () => {
  it('interpolates every channel including alpha', () => {
    expect(
      mix(
        { space: 'srgb', r: 0, g: 0, b: 0, a: 1 },
        { space: 'srgb', r: 1, g: 1, b: 1, a: 0 },
        0.5,
      ),
    ).toEqual({ space: 'srgb', r: 0.5, g: 0.5, b: 0.5, a: 0.5 });
  });

  it('widens to p3 when either side is p3', () => {
    expect(
      mix({ space: 'p3', r: 1, g: 0, b: 0, a: 1 }, { space: 'srgb', r: 0, g: 0, b: 0, a: 1 }, 0.5).space,
    ).toBe('p3');
  });
});

describe('toStroke', () => {
  const stroke = (pattern: string) => ({
    color: black,
    width: 1,
    pattern: { type: pattern, pattern: [2, 2], phase: 0 },
  });

  // @lat: [[tests#Paint#Treats an empty stroke pattern as no border]]
  it('treats an empty pattern as no border', () => {
    // Keynote writes a 1pt black stroke for every unbordered text box.
    expect(toStroke(stroke('TSDEmptyPattern'))).toBeUndefined();
  });

  it('keeps a solid stroke and drops its dash array', () => {
    expect(toStroke(stroke('TSDSolidPattern'))).toMatchObject({ width: 1, dash: [] });
  });

  it('scales a dash pattern by the stroke width', () => {
    expect(toStroke({ ...stroke('TSDPattern'), width: 3 })?.dash).toEqual([6, 6]);
  });

  it('ignores a zero-width or invisible stroke', () => {
    expect(toStroke({ color: black, width: 0 })).toBeUndefined();
    expect(toStroke({ color: clear, width: 4 })).toBeUndefined();
  });
});
