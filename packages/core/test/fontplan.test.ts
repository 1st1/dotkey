import { describe, expect, it } from 'vitest';

import { googleFontsUrl, planFonts } from '../src/fonts/plan.js';
import { isSystemFamily, normalizeFamily } from '../src/fonts/system.js';
import { readKeynoteFile } from '../src/node.js';
import { describeWithPinnedDeck, fixturePath } from './fixture.js';

const face = (f: { weight: number; style: string }) => `${f.weight}${f.style === 'italic' ? 'i' : ''}`;
const find = (planned: ReturnType<typeof planFonts>, family: string) =>
  planned.find((font) => font.family === family)!;

describe('isSystemFamily', () => {
  // @lat: [[tests#Font matching#Classifies installed families as system]]
  it.each(['Helvetica Neue', 'Arial', 'Times New Roman', 'Menlo', 'PingFang SC', 'Segoe UI'])(
    'treats %s as installed',
    (family) => expect(isSystemFamily(family)).toBe(true),
  );

  it.each(['Geist', 'Geist Mono', 'Inter', 'Lobster'])('treats %s as not installed', (family) =>
    expect(isSystemFamily(family)).toBe(false),
  );

  it('ignores spacing and case', () => {
    expect(isSystemFamily('helveticaneue')).toBe(true);
    expect(normalizeFamily('Geist Mono')).toBe('geistmono');
  });
});

describe('planFonts', () => {
  it('groups PostScript names into families with the faces in use', () => {
    const planned = planFonts(['Geist-Medium', 'Geist-Bold', 'GeistMono-Regular']);
    expect(planned.map((font) => font.family)).toEqual(['Geist', 'Geist Mono']);
    expect(find(planned, 'Geist').faces.map(face)).toEqual(['500', '700']);
    expect(find(planned, 'Geist').postScriptNames).toEqual(['Geist-Bold', 'Geist-Medium']);
  });

  it('marks installed families as system and asks for nothing', () => {
    const planned = planFonts(['HelveticaNeue', 'HelveticaNeue-Bold', 'ArialMT']);
    expect(planned.every((font) => font.source === 'system')).toBe(true);
    expect(planned.every((font) => font.available.length === 0)).toBe(true);
  });

  it('marks a family with no known source as unavailable', () => {
    const planned = planFonts(['TotallyMadeUpFace-Bold']);
    expect(planned[0]).toMatchObject({ source: 'unavailable', available: [] });
  });

  // @lat: [[tests#Font matching#Snaps a requested weight onto one the family publishes]]
  it('snaps a requested weight to one the family publishes', () => {
    // Lobster ships only 400; asking Google Fonts for 700 returns 400 and takes
    // the whole stylesheet down, so the plan must never contain it.
    const planned = planFonts(['Lobster-Bold']);
    expect(find(planned, 'Lobster').faces.map(face)).toEqual(['700']);
    expect(find(planned, 'Lobster').available.map(face)).toEqual(['400']);
  });

  it('falls back to roman when a family has no italics', () => {
    const planned = planFonts(['Lobster-Italic']);
    expect(find(planned, 'Lobster').available.map(face)).toEqual(['400']);
  });

  it('keeps italics for a family that publishes them', () => {
    const planned = planFonts(['GeistMono-Italic', 'GeistMono-Regular']);
    expect(find(planned, 'Geist Mono').available.map(face)).toEqual(['400', '400i']);
  });

  it('uses the catalogue spelling of the family', () => {
    // The parser produces "Geist Mono" from "GeistMono"; the CSS name has to be
    // whatever the service actually serves.
    expect(find(planFonts(['GeistMono-Regular']), 'Geist Mono').source).toBe('google');
  });

  it('deduplicates faces that snap onto the same weight', () => {
    const planned = planFonts(['Lobster-Regular', 'Lobster-Medium', 'Lobster-Bold']);
    expect(find(planned, 'Lobster').available).toHaveLength(1);
  });
});

describe('googleFontsUrl', () => {
  it('builds one stylesheet request for every loadable family', () => {
    const url = googleFontsUrl(planFonts(['Geist-Medium', 'Geist-Bold', 'GeistMono-Regular']))!;
    expect(url).toContain('family=Geist:wght@500;700');
    expect(url).toContain('family=Geist+Mono:wght@400');
    expect(url).toContain('display=block');
  });

  // @lat: [[tests#Font matching#Orders italic axis tuples for css2]]
  it('emits ital,wght tuples in ascending order when italics are needed', () => {
    // css2 rejects axis tuples that are not sorted.
    const url = googleFontsUrl(planFonts(['GeistMono-Italic', 'GeistMono-SemiBold']))!;
    expect(url).toContain('family=Geist+Mono:ital,wght@0,600;1,400');
  });

  // @lat: [[tests#Font matching#Requests nothing when every font is installed]]
  it('returns undefined when everything is already installed', () => {
    expect(googleFontsUrl(planFonts(['HelveticaNeue', 'ArialMT']))).toBeUndefined();
    expect(googleFontsUrl([])).toBeUndefined();
  });

  it('honours display and a self-hosted origin', () => {
    const url = googleFontsUrl(planFonts(['Geist-Medium']), {
      display: 'swap',
      origin: 'https://fonts.example.com',
    })!;
    expect(url.startsWith('https://fonts.example.com/css2?')).toBe(true);
    expect(url).toContain('display=swap');
  });
});


describeWithPinnedDeck('planning the sample deck', () => {
  it('loads only the two families macOS does not ship', async () => {
    const { deck } = await readKeynoteFile(fixturePath!);
    const planned = planFonts(deck.fonts);

    expect(planned.filter((f) => f.source === 'google').map((f) => f.family)).toEqual([
      'Geist',
      'Geist Mono',
    ]);
    expect(planned.filter((f) => f.source === 'system').map((f) => f.family)).toEqual([
      'Arial',
      'Helvetica Neue',
    ]);
    expect(planned.filter((f) => f.source === 'unavailable')).toEqual([]);
  });

  it('requests exactly the weights the deck uses', async () => {
    const { deck } = await readKeynoteFile(fixturePath!);
    const url = googleFontsUrl(planFonts(deck.fonts))!;
    // Geist appears as Medium and Bold; Geist Mono as Regular, SemiBold, Italic.
    expect(url).toBe(
      'https://fonts.googleapis.com/css2?family=Geist:wght@500;700' +
        '&family=Geist+Mono:ital,wght@0,400;0,600;1,400&display=block',
    );
  });
});
