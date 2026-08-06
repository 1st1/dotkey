import type { Color } from './types.js';

/** `TSP.Color` as decoded from the wire. */
export interface RawColor {
  model?: string;
  rgbspace?: string;
  r?: number;
  g?: number;
  b?: number;
  a?: number;
  c?: number;
  m?: number;
  y?: number;
  k?: number;
  w?: number;
}

export const BLACK: Color = { space: 'srgb', r: 0, g: 0, b: 0, a: 1 };
export const WHITE: Color = { space: 'srgb', r: 1, g: 1, b: 1, a: 1 };
export const TRANSPARENT: Color = { space: 'srgb', r: 0, g: 0, b: 0, a: 0 };

export function toColor(raw: RawColor | null | undefined): Color | undefined {
  if (!raw) return undefined;
  const alpha = clamp01(raw.a ?? 1);

  switch (raw.model) {
    case 'cmyk': {
      // Naive conversion; iWork stores CMYK rarely and without a profile.
      const c = clamp01(raw.c ?? 0);
      const m = clamp01(raw.m ?? 0);
      const y = clamp01(raw.y ?? 0);
      const k = clamp01(raw.k ?? 0);
      return {
        space: 'srgb',
        r: (1 - c) * (1 - k),
        g: (1 - m) * (1 - k),
        b: (1 - y) * (1 - k),
        a: alpha,
      };
    }
    case 'white': {
      const w = clamp01(raw.w ?? 0);
      return { space: 'srgb', r: w, g: w, b: w, a: alpha };
    }
    case 'rgb':
    default: {
      if (raw.r === undefined && raw.g === undefined && raw.b === undefined) return undefined;
      return {
        space: raw.rgbspace === 'p3' ? 'p3' : 'srgb',
        r: clamp01(raw.r ?? 0),
        g: clamp01(raw.g ?? 0),
        b: clamp01(raw.b ?? 0),
        a: alpha,
      };
    }
  }
}

export function withAlpha(color: Color, a: number): Color {
  return { ...color, a: clamp01(a) };
}

export function isTransparent(color: Color | undefined): boolean {
  return !color || color.a <= 0;
}

/** CSS colour string. `display-p3` is emitted only when the source used it. */
export function colorToCss(color: Color): string {
  if (color.space === 'p3') {
    return `color(display-p3 ${round(color.r)} ${round(color.g)} ${round(color.b)}${
      color.a < 1 ? ` / ${round(color.a)}` : ''
    })`;
  }
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  return color.a < 1 ? `rgba(${r}, ${g}, ${b}, ${round(color.a)})` : `rgb(${r}, ${g}, ${b})`;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
