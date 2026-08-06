import { toColor, type RawColor } from '../model/color.js';
import type { Fill, Gradient, LineCap, LineJoin, Shadow, Stroke } from '../model/types.js';
import type { BuildContext } from './context.js';
import { isBag, type PropertyBag } from './styles.js';

interface RawGradientStop {
  color?: RawColor;
  fraction?: number;
  inflection?: number;
}

interface RawGradient {
  type?: string;
  stops?: RawGradientStop[];
  opacity?: number;
  anglegradient?: { gradientangle?: number };
  /** "Advanced" gradients store an axis instead of an angle. */
  transformgradient?: {
    start?: { x?: number; y?: number };
    end?: { x?: number; y?: number };
    baseNaturalSize?: { width?: number; height?: number };
  };
}

interface RawImageFill {
  imagedata?: { identifier?: number };
  technique?: string;
  tint?: RawColor;
  fillsize?: { width?: number; height?: number };
}

interface RawFill {
  color?: RawColor;
  gradient?: RawGradient;
  image?: RawImageFill;
}

interface RawStroke {
  color?: RawColor;
  width?: number;
  cap?: string;
  join?: string;
  pattern?: { type?: string; pattern?: number[]; phase?: number };
}

interface RawShadow {
  color?: RawColor;
  angle?: number;
  offset?: number;
  radius?: number;
  opacity?: number;
  is_enabled?: boolean;
}

const FILL_TECHNIQUE = {
  NaturalSize: 'natural',
  Stretch: 'stretch',
  Tile: 'tile',
  ScaleToFill: 'fill',
  ScaleToFit: 'fit',
} as const;

const LINE_CAP: Record<string, LineCap> = {
  ButtCap: 'butt',
  RoundCap: 'round',
  SquareCap: 'square',
};

const LINE_JOIN: Record<string, LineJoin> = {
  MiterJoin: 'miter',
  RoundJoin: 'round',
  BevelJoin: 'bevel',
};

export function toFill(context: BuildContext, raw: unknown): Fill | undefined {
  if (!isBag(raw)) return undefined;
  const fill = raw as RawFill;

  if (fill.color) {
    const color = toColor(fill.color);
    return color ? { type: 'color', color } : undefined;
  }

  if (fill.gradient) {
    const gradient = toGradient(fill.gradient);
    return gradient ? { type: 'gradient', gradient } : undefined;
  }

  if (fill.image) {
    const resource = context.resource(fill.image.imagedata);
    const technique =
      FILL_TECHNIQUE[(fill.image.technique ?? 'NaturalSize') as keyof typeof FILL_TECHNIQUE] ??
      'natural';
    const tint = toColor(fill.image.tint);
    const size = fill.image.fillsize;
    return {
      type: 'image',
      resource,
      technique,
      ...(tint ? { tint } : {}),
      ...(size?.width && size.height
        ? { size: { width: size.width, height: size.height } }
        : {}),
    };
  }

  return undefined;
}

function toGradient(raw: RawGradient): Gradient | undefined {
  const stops = (raw.stops ?? [])
    .map((stop) => {
      const color = toColor(stop.color);
      if (!color) return undefined;
      return {
        color,
        offset: stop.fraction ?? 0,
        ...(stop.inflection !== undefined ? { inflection: stop.inflection } : {}),
      };
    })
    .filter((stop): stop is NonNullable<typeof stop> => stop !== undefined)
    .sort((a, b) => a.offset - b.offset);

  if (stops.length === 0) return undefined;

  return {
    type: raw.type === 'Radial' ? 'radial' : 'linear',
    stops,
    angle: gradientAngle(raw),
    ...(raw.opacity !== undefined ? { opacity: raw.opacity } : {}),
  };
}

/**
 * Keynote measures gradient angles counter-clockwise from "pointing right";
 * CSS measures clockwise from "pointing up", so the axes have to be swapped.
 * A gradient at 0° therefore runs left-to-right, which is CSS's `90deg`.
 *
 * An "advanced" gradient stores its axis as two points rather than an angle.
 */
function gradientAngle(raw: RawGradient): number {
  const angle = raw.anglegradient?.gradientangle;
  if (angle !== undefined) return normalizeDegrees(90 - angle);

  const start = raw.transformgradient?.start;
  const end = raw.transformgradient?.end;
  if (start && end) {
    const dx = (end.x ?? 0) - (start.x ?? 0);
    const dy = (end.y ?? 0) - (start.y ?? 0);
    if (dx !== 0 || dy !== 0) {
      // Both spaces have y growing downward, so this is a direct conversion
      // from "pointing right is 0" to "pointing up is 0".
      return normalizeDegrees(90 + (Math.atan2(dy, dx) * 180) / Math.PI);
    }
  }

  // Keynote's own default for a gradient with no recorded axis.
  return 180;
}

export function toStroke(raw: unknown): Stroke | undefined {
  if (!isBag(raw)) return undefined;
  const stroke = raw as RawStroke;
  const color = toColor(stroke.color);
  const width = stroke.width ?? 0;
  if (!color || width <= 0 || color.a <= 0) return undefined;

  // Keynote always writes a stroke record; `TSDEmptyPattern` is how it spells
  // "no border", so unbordered text boxes still carry a 1pt black stroke here.
  const patternType = stroke.pattern?.type ?? 'TSDSolidPattern';
  if (patternType === 'TSDEmptyPattern') return undefined;

  const dash =
    patternType === 'TSDSolidPattern'
      ? []
      : (stroke.pattern?.pattern ?? []).filter((n) => n > 0).map((n) => n * width);

  return {
    color,
    width,
    cap: LINE_CAP[stroke.cap ?? 'ButtCap'] ?? 'butt',
    join: LINE_JOIN[stroke.join ?? 'MiterJoin'] ?? 'miter',
    dash,
    dashOffset: stroke.pattern?.phase ?? 0,
  };
}

export function toShadow(raw: unknown): Shadow | undefined {
  if (!isBag(raw)) return undefined;
  const shadow = raw as RawShadow;
  if (shadow.is_enabled === false) return undefined;
  const color = toColor(shadow.color);
  if (!color) return undefined;

  const opacity = shadow.opacity ?? 1;
  if (opacity <= 0 || color.a <= 0) return undefined;

  return {
    color,
    // Same convention swap as gradients.
    angle: normalizeDegrees(90 - (shadow.angle ?? 315)),
    offset: shadow.offset ?? 5,
    radius: shadow.radius ?? 1,
    opacity,
  };
}

/** Pull fill/stroke/opacity/shadow out of a resolved `shape_properties` bag. */
export function shapePaint(
  context: BuildContext,
  properties: PropertyBag,
): { fill?: Fill; stroke?: Stroke; shadow?: Shadow; opacity: number } {
  const fill = toFill(context, properties['fill']);
  const stroke = toStroke(properties['stroke']);
  const shadow = toShadow(properties['shadow']);
  const rawOpacity = properties['opacity'];
  const opacity = typeof rawOpacity === 'number' ? rawOpacity : 1;
  return {
    ...(fill ? { fill } : {}),
    ...(stroke ? { stroke } : {}),
    ...(shadow ? { shadow } : {}),
    opacity,
  };
}

function normalizeDegrees(value: number): number {
  const wrapped = value % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}
