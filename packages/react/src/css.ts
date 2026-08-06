import {
  colorToCss,
  expandGradientStops,
  fontStack,
  type CharacterStyle,
  type Color,
  type Fill,
  type Gradient,
  type LineSpacing,
  type Shadow,
  type Stroke,
  type TextAlign,
} from '@dotkey/core';
import type { CSSProperties } from 'react';

/**
 * Keynote uses the font's own default line height as the unit for "relative"
 * line spacing; CSS numeric `line-height` is a multiple of the font size.
 * Without font metrics the two differ by the font's natural leading, so a
 * single ratio stands in for it. 1.2 is close for the grotesques Keynote themes
 * use, and is overridable per render.
 */
export const DEFAULT_LINE_HEIGHT_BASIS = 1.2;

export function toCss(color: Color): string {
  return colorToCss(color);
}

/** Background CSS for a fill. Image fills need a resolved URL. */
export function fillStyle(
  fill: Fill | undefined,
  resolveUrl: (id: string) => string | undefined,
): CSSProperties {
  if (!fill) return {};

  switch (fill.type) {
    case 'color':
      return { backgroundColor: colorToCss(fill.color) };

    case 'gradient':
      return { backgroundImage: gradientCss(fill.gradient), opacity: fill.gradient.opacity };

    case 'image': {
      const url = fill.resource ? resolveUrl(fill.resource) : undefined;
      if (!url) return fill.tint ? { backgroundColor: colorToCss(fill.tint) } : {};
      const common: CSSProperties = {
        backgroundImage: `url(${JSON.stringify(url)})`,
        backgroundPosition: 'center',
      };
      switch (fill.technique) {
        case 'tile':
          return {
            ...common,
            backgroundRepeat: 'repeat',
            backgroundPosition: 'top left',
            ...(fill.size ? { backgroundSize: `${fill.size.width}px ${fill.size.height}px` } : {}),
          };
        case 'stretch':
          return { ...common, backgroundRepeat: 'no-repeat', backgroundSize: '100% 100%' };
        case 'fit':
          return { ...common, backgroundRepeat: 'no-repeat', backgroundSize: 'contain' };
        case 'fill':
          return { ...common, backgroundRepeat: 'no-repeat', backgroundSize: 'cover' };
        case 'natural':
        default:
          return { ...common, backgroundRepeat: 'no-repeat', backgroundSize: 'auto' };
      }
    }
  }
}

export function gradientCss(gradient: Gradient): string {
  const stops = expandGradientStops(gradient)
    .map((stop) => `${colorToCss(stop.color)} ${(stop.offset * 100).toFixed(2)}%`)
    .join(', ');
  return gradient.type === 'radial'
    ? `radial-gradient(circle at center, ${stops})`
    : `linear-gradient(${gradient.angle.toFixed(2)}deg, ${stops})`;
}

/** Keynote shadows are polar (angle + distance); CSS wants an offset. */
export function shadowOffset(shadow: Shadow): { x: number; y: number } {
  const radians = ((shadow.angle - 90) * Math.PI) / 180;
  return {
    x: Math.cos(radians) * shadow.offset,
    y: Math.sin(radians) * shadow.offset,
  };
}

export function boxShadowCss(shadow: Shadow | undefined): string | undefined {
  if (!shadow) return undefined;
  const { x, y } = shadowOffset(shadow);
  const color = colorToCss({ ...shadow.color, a: shadow.color.a * shadow.opacity });
  return `${x.toFixed(2)}px ${y.toFixed(2)}px ${shadow.radius.toFixed(2)}px ${color}`;
}

export function dropShadowFilter(shadow: Shadow | undefined): string | undefined {
  if (!shadow) return undefined;
  const { x, y } = shadowOffset(shadow);
  const color = colorToCss({ ...shadow.color, a: shadow.color.a * shadow.opacity });
  // `drop-shadow` follows the alpha silhouette, which is what Keynote does for
  // shapes and images with transparency. Its blur is a std-deviation, roughly
  // half the box-shadow radius.
  return `drop-shadow(${x.toFixed(2)}px ${y.toFixed(2)}px ${(shadow.radius / 2).toFixed(2)}px ${color})`;
}

export function textShadowCss(shadow: Shadow | undefined): string | undefined {
  if (!shadow) return undefined;
  const { x, y } = shadowOffset(shadow);
  const color = colorToCss({ ...shadow.color, a: shadow.color.a * shadow.opacity });
  return `${x.toFixed(2)}px ${y.toFixed(2)}px ${shadow.radius.toFixed(2)}px ${color}`;
}

export function strokeAttributes(stroke: Stroke | undefined): {
  stroke?: string;
  strokeWidth?: number;
  strokeLinecap?: 'butt' | 'round' | 'square';
  strokeLinejoin?: 'miter' | 'round' | 'bevel';
  strokeDasharray?: string;
  strokeDashoffset?: number;
} {
  if (!stroke) return { stroke: 'none' };
  return {
    stroke: colorToCss(stroke.color),
    strokeWidth: stroke.width,
    strokeLinecap: stroke.cap,
    strokeLinejoin: stroke.join,
    ...(stroke.dash.length > 0
      ? { strokeDasharray: stroke.dash.join(' '), strokeDashoffset: stroke.dashOffset }
      : {}),
  };
}

const TEXT_ALIGN_CSS: Record<TextAlign, CSSProperties['textAlign']> = {
  left: 'left',
  center: 'center',
  right: 'right',
  justify: 'justify',
  natural: 'start',
};

export function textAlignCss(align: TextAlign): CSSProperties['textAlign'] {
  return TEXT_ALIGN_CSS[align];
}

export function lineHeightCss(
  spacing: LineSpacing,
  fontSize: number,
  basis = DEFAULT_LINE_HEIGHT_BASIS,
): string | number {
  switch (spacing.mode) {
    case 'exact':
      return `${spacing.amount}px`;
    case 'minimum':
      return `${Math.max(spacing.amount, fontSize * basis)}px`;
    case 'maximum':
      return `${Math.min(spacing.amount, fontSize * basis)}px`;
    case 'between':
      // Extra leading added between lines, on top of the natural height.
      return `${fontSize * basis + spacing.amount}px`;
    case 'relative':
    default:
      return spacing.amount * basis;
  }
}

const TEXT_TRANSFORM: Record<CharacterStyle['capitalization'], CSSProperties['textTransform']> = {
  none: undefined,
  uppercase: 'uppercase',
  smallCaps: undefined,
  titleCase: 'capitalize',
};

export function runStyle(style: CharacterStyle): CSSProperties {
  const decorations: string[] = [];
  if (style.underline !== 'none') decorations.push('underline');
  if (style.strikethrough !== 'none') decorations.push('line-through');

  const css: CSSProperties = {
    fontFamily: fontStack(style.fontFamily),
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    fontSize: `${style.fontSize}px`,
    ...(style.color ? { color: colorToCss(style.color) } : {}),
    ...(style.backgroundColor ? { backgroundColor: colorToCss(style.backgroundColor) } : {}),
  };

  if (style.capitalization === 'smallCaps') css.fontVariantCaps = 'small-caps';
  const transform = TEXT_TRANSFORM[style.capitalization];
  if (transform) css.textTransform = transform;

  if (style.tracking !== 0) css.letterSpacing = `${style.tracking * style.fontSize}px`;

  if (decorations.length > 0) {
    css.textDecorationLine = decorations.join(' ');
    if (style.underline === 'double' || style.strikethrough === 'double') {
      css.textDecorationStyle = 'double';
    } else if (style.underline === 'wavy') {
      css.textDecorationStyle = 'wavy';
    }
    const decorationColor = style.underlineColor ?? style.strikethroughColor;
    if (decorationColor) css.textDecorationColor = colorToCss(decorationColor);
  }

  if (style.superscript !== 'none') {
    css.verticalAlign = style.superscript === 'super' ? 'super' : 'sub';
    css.fontSize = `${style.fontSize * 0.65}px`;
  } else if (style.baselineShift !== 0) {
    // Positive values raise the glyphs, matching Keynote.
    css.verticalAlign = `${style.baselineShift * style.fontSize}px`;
  }

  // Gradient- and image-filled text: paint the background and clip it to the
  // glyphs. `color: transparent` is what makes the clip visible.
  if (style.fill?.type === 'gradient') {
    css.backgroundImage = gradientCss(style.fill.gradient);
    css.backgroundClip = 'text';
    css.WebkitBackgroundClip = 'text';
    css.color = 'transparent';
  }

  if (style.shadow) css.textShadow = textShadowCss(style.shadow);

  if (style.outlineWidth && style.outlineColor) {
    css.WebkitTextStrokeWidth = `${style.outlineWidth * style.fontSize}px`;
    css.WebkitTextStrokeColor = colorToCss(style.outlineColor);
  }

  return css;
}
