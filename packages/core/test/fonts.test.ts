import { describe, expect, it } from 'vitest';

import { fontStack, parseFontName } from '../src/model/fonts.js';

describe('parseFontName', () => {
  it.each([
    ['HelveticaNeue', 'Helvetica Neue', 400, 'normal'],
    ['HelveticaNeue-Bold', 'Helvetica Neue', 700, 'normal'],
    ['HelveticaNeue-Medium', 'Helvetica Neue', 500, 'normal'],
    ['HelveticaNeue-BoldItalic', 'Helvetica Neue', 700, 'italic'],
    ['Geist-Light', 'Geist', 300, 'normal'],
    ['GeistMono-SemiBold', 'Geist Mono', 600, 'normal'],
    ['GeistMono-Italic', 'Geist Mono', 400, 'italic'],
    ['ArialMT', 'Arial', 400, 'normal'],
    ['Arial-BoldMT', 'Arial', 700, 'normal'],
    ['TimesNewRomanPSMT', 'Times New Roman', 400, 'normal'],
    ['Avenir-Black', 'Avenir', 900, 'normal'],
    ['Helvetica', 'Helvetica', 400, 'normal'],
  ])('parses %s', (postScript, family, weight, style) => {
    const parsed = parseFontName(postScript);
    expect(parsed.family).toBe(family);
    expect(parsed.weight).toBe(weight);
    expect(parsed.style).toBe(style);
  });

  it('extracts width as font-stretch', () => {
    expect(parseFontName('HelveticaNeue-CondensedBold')).toMatchObject({
      family: 'Helvetica Neue',
      weight: 700,
      stretch: 'condensed',
    });
  });

  it('falls back for an empty name', () => {
    expect(parseFontName('').family).toBe('Helvetica');
  });
});

describe('fontStack', () => {
  it('quotes families that need it and appends sans-serif fallbacks', () => {
    expect(fontStack('Helvetica Neue')).toMatch(/^"Helvetica Neue", /);
    expect(fontStack('Helvetica Neue')).toMatch(/sans-serif$/);
  });

  it('picks a monospace fallback chain for monospace families', () => {
    expect(fontStack('Geist Mono')).toMatch(/monospace$/);
  });

  it('picks a serif fallback chain for serif families', () => {
    expect(fontStack('Times New Roman')).toMatch(/serif$/);
    expect(fontStack('Times New Roman')).not.toMatch(/sans-serif$/);
  });
});
