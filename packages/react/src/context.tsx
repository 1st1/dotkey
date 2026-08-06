import type { Deck, KeynoteDocument, ResourceId } from '@dotkey/core';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { Playback } from './animation/usePlayback.js';
import { DEFAULT_LINE_HEIGHT_BASIS } from './css.js';

export interface KeynoteRenderContext {
  deck: Deck;
  /** Resolve a media resource to a URL the browser can load. */
  resolveUrl: (id: ResourceId) => string | undefined;
  /** Multiplier converting Keynote's relative line spacing into CSS. */
  lineHeightBasis: number;
  /** Render `movie` elements as playable video rather than a still poster. */
  playMedia: boolean;
  /**
   * Build state for the slide being rendered. Absent when a slide is drawn
   * fully built — thumbnails, printing, or `animate={false}`.
   */
  playback?: Playback;
}

const DeckContext = createContext<Omit<KeynoteRenderContext, 'playback'> | null>(null);
const PlaybackContext = createContext<Playback | undefined>(undefined);

export function useKeynoteContext(): KeynoteRenderContext {
  const deck = useContext(DeckContext);
  const playback = useContext(PlaybackContext);
  if (!deck) {
    throw new Error('Keynote components must be rendered inside <KeynoteProvider>.');
  }
  return playback ? { ...deck, playback } : deck;
}

export interface KeynoteProviderProps {
  deck: Deck;
  /**
   * Where media comes from. Pass a `KeynoteDocument` to serve blob URLs
   * straight out of the parsed package, or a function to point at your own CDN
   * when the deck was parsed server-side.
   */
  source?: KeynoteDocument | ((id: ResourceId) => string | undefined);
  lineHeightBasis?: number;
  playMedia?: boolean;
  children: ReactNode;
}

export function KeynoteProvider({
  deck,
  source,
  lineHeightBasis = DEFAULT_LINE_HEIGHT_BASIS,
  playMedia = true,
  children,
}: KeynoteProviderProps) {
  const value = useMemo(() => {
    const resolveUrl =
      typeof source === 'function'
        ? source
        : source
          ? (id: ResourceId) => source.resourceUrl(id)
          : () => undefined;
    return { deck, resolveUrl, lineHeightBasis, playMedia };
  }, [deck, source, lineHeightBasis, playMedia]);

  return <DeckContext.Provider value={value}>{children}</DeckContext.Provider>;
}

/** Supplies build state to the elements of one slide. */
export function PlaybackProvider({
  playback,
  children,
}: {
  playback: Playback | undefined;
  children: ReactNode;
}) {
  return <PlaybackContext.Provider value={playback}>{children}</PlaybackContext.Provider>;
}
