import type { Color, Gradient, GradientStop } from './types.js';

/**
 * Keynote lets the author drag the *midpoint* between two gradient stops, which
 * it stores as an `inflection` on the first of the pair: the fraction of the way
 * along the span where the two colours are mixed 50/50. CSS and SVG gradients
 * always mix linearly, so a shifted midpoint has to be expressed as an extra
 * explicit stop.
 *
 * With the default midpoint (0.5) this returns the stops unchanged, so it is
 * free for the common case.
 */
export function expandGradientStops(gradient: Gradient): GradientStop[] {
  const stops = gradient.stops;
  if (stops.length < 2) return [...stops];

  const out: GradientStop[] = [];
  for (const [index, stop] of stops.entries()) {
    out.push(stop);
    const next = stops[index + 1];
    if (!next) continue;

    const inflection = stop.inflection;
    if (inflection === undefined || Math.abs(inflection - 0.5) < 0.01) continue;

    const offset = stop.offset + (next.offset - stop.offset) * clamp01(inflection);
    // Nothing to add if the midpoint has collapsed onto one of the ends.
    if (offset <= stop.offset || offset >= next.offset) continue;

    out.push({ color: mix(stop.color, next.color, 0.5), offset });
  }
  return out;
}

/** Linear interpolation between two colours in their own colour space. */
export function mix(a: Color, b: Color, t: number): Color {
  const amount = clamp01(t);
  const lerp = (from: number, to: number) => from + (to - from) * amount;
  return {
    // Two stops in one gradient always share a space in practice; prefer the
    // wider one if they somehow differ.
    space: a.space === 'p3' || b.space === 'p3' ? 'p3' : 'srgb',
    r: lerp(a.r, b.r),
    g: lerp(a.g, b.g),
    b: lerp(a.b, b.b),
    a: lerp(a.a, b.a),
  };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
