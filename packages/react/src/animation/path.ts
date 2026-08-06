/**
 * Motion-path geometry.
 *
 * Keynote action builds carry an SVG path whose coordinates are offsets in
 * points from the element's own position. Browsers can measure such a path
 * exactly, so curved motion is sampled with `getPointAtLength`; without a DOM
 * (server rendering, tests) the code falls back to the path's endpoint, which
 * still puts the element in the right final place.
 */

export interface PathPoint {
  x: number;
  y: number;
}

const NUMBER = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;

/**
 * Final absolute point of a path built from `M`/`L`/`C`/`Q`/`Z` commands, which
 * is what `@dotkey/core` emits.
 */
export function pathEndPoint(d: string): PathPoint {
  let current: PathPoint = { x: 0, y: 0 };
  let start: PathPoint = { x: 0, y: 0 };

  for (const [command, args] of commands(d)) {
    switch (command) {
      case 'M':
        current = { x: args[0] ?? 0, y: args[1] ?? 0 };
        start = current;
        break;
      case 'L':
        current = { x: args[0] ?? current.x, y: args[1] ?? current.y };
        break;
      case 'Q':
      case 'C': {
        // The last coordinate pair is always the endpoint.
        const x = args[args.length - 2];
        const y = args[args.length - 1];
        if (x !== undefined && y !== undefined) current = { x, y };
        break;
      }
      case 'Z':
        current = start;
        break;
      default:
        break;
    }
  }
  return current;
}

function* commands(d: string): Generator<[string, number[]]> {
  const pattern = /([MLCQZmlcqz])([^MLCQZmlcqz]*)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(d)) !== null) {
    const args = (match[2] ?? '').match(NUMBER)?.map(Number) ?? [];
    yield [match[1]!.toUpperCase(), args];
  }
}

/**
 * Points evenly spaced along the path, always including both ends. Straight
 * paths need no intermediate samples, so they short-circuit to two points.
 */
export function samplePath(d: string, steps = 24): PathPoint[] {
  const end = pathEndPoint(d);
  const start: PathPoint = { x: 0, y: 0 };

  if (typeof document === 'undefined') return [start, end];

  try {
    const element = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    element.setAttribute('d', d);
    const length = element.getTotalLength();
    if (!Number.isFinite(length) || length === 0) return [start, end];

    // A path whose length matches the straight-line distance is a line.
    const straight = Math.hypot(end.x - start.x, end.y - start.y);
    if (Math.abs(length - straight) < 0.5) {
      const first = element.getPointAtLength(0);
      return [
        { x: first.x, y: first.y },
        { x: end.x, y: end.y },
      ];
    }

    const points: PathPoint[] = [];
    for (let i = 0; i <= steps; i++) {
      const point = element.getPointAtLength((length * i) / steps);
      points.push({ x: point.x, y: point.y });
    }
    return points;
  } catch {
    return [start, end];
  }
}
