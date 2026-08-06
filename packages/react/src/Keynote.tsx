import type { KeynoteDocument, ParseOptions, Slide } from '@dotkey/core';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from 'react';

import type { Playback } from './animation/usePlayback.js';
import { useIsomorphicLayoutEffect } from './animation/useIsomorphicLayoutEffect.js';
import { KeynoteProvider } from './context.jsx';
import { SlidePlayer } from './SlidePlayer.jsx';
import { SlideStage, Stage } from './SlideView.jsx';
import { useKeynoteFonts, type KeynoteFontOptions } from './fonts/useKeynoteFonts.js';
import { useKeynote, type KeynoteSource } from './useKeynote.js';

export type KeynoteMode = 'slide' | 'scroll' | 'grid';

/**
 * Imperative navigation, for chrome rendered outside the component.
 *
 * `advance`/`retreat` are the same actions a click or an arrow key performs, so
 * a custom "next" button plays the slide's builds first and only then moves on —
 * which is what a viewer expects, and what driving `slide` directly cannot do.
 */
export interface KeynoteControls {
  advance(): void;
  retreat(): void;
  /** Jump to a slide, skipping any builds in between. */
  goToSlide(index: number, options?: { atEnd?: boolean }): void;
  /** Build state of the slide currently on screen. */
  readonly stage: number;
  readonly stageCount: number;
}

export interface KeynoteProps {
  /** A URL, a `File`/`Blob`, raw bytes, or an already-parsed document. */
  src: KeynoteSource;
  /** How the deck is presented. Default `slide`. */
  mode?: KeynoteMode;
  /** Controlled slide index. Omit for uncontrolled navigation. */
  slide?: number;
  defaultSlide?: number;
  onSlideChange?: (index: number, slide: Slide) => void;
  /**
   * Play object builds and slide transitions. When off, every slide is drawn
   * fully built. Default `true`. A user who has asked for reduced motion always
   * gets the fully-built rendering regardless.
   */
  animate?: boolean;
  /** Skip slides marked "skip" in Keynote when navigating. Default `true`. */
  respectSkipped?: boolean;
  /** Arrow keys, space and page up/down advance the deck. Default `true`. */
  keyboard?: boolean;
  /** Clicking the slide advances it. Default `true` in `slide` mode. */
  clickToAdvance?: boolean;
  /** Autoplay video and animated media. Default `true`. */
  playMedia?: boolean;
  /**
   * Load the fonts the deck references but the machine may not have.
   *
   * Keynote embeds no font data, and auto-sized text boxes are measured by the
   * browser, so a missing typeface changes geometry rather than just
   * letterforms. Families already installed (Helvetica Neue, Arial, …) are never
   * fetched; the rest are matched against Google Fonts and requested in exactly
   * the weights the deck uses. Pass `false` to opt out of the third-party
   * request entirely and render with whatever is installed.
   */
  fonts?: KeynoteFontOptions | false;
  /**
   * Multiplier that turns Keynote's relative line spacing into a CSS
   * `line-height`. Raise it if a specific theme's text sits too tight.
   */
  lineHeightBasis?: number;
  /** Thumbnail width in pixels for `mode="grid"`. Default 280. */
  thumbnailWidth?: number;
  parseOptions?: ParseOptions;
  loading?: ReactNode;
  error?: (error: Error) => ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Receives imperative navigation once the deck is ready. */
  controlsRef?: MutableRefObject<KeynoteControls | null>;
  /** Called once the deck is parsed. */
  onLoad?: (document: KeynoteDocument) => void;
  /** Called whenever the build stage changes, including on slide entry. */
  onStageChange?: (stage: number, stageCount: number) => void;
}

/**
 * Render a Keynote presentation.
 *
 * ```tsx
 * <Keynote src={file} style={{ height: '100dvh' }} />
 * ```
 *
 * In `slide` mode a click or arrow key advances the next object build, and only
 * moves to the next slide once the current one is fully built — the same
 * sequence Keynote itself plays.
 */
export function Keynote({
  src,
  mode = 'slide',
  slide,
  defaultSlide = 0,
  onSlideChange,
  animate = true,
  respectSkipped = true,
  keyboard = true,
  clickToAdvance = true,
  playMedia = true,
  fonts,
  lineHeightBasis,
  thumbnailWidth = 280,
  parseOptions,
  loading,
  error,
  className,
  style,
  controlsRef,
  onLoad,
  onStageChange,
}: KeynoteProps) {
  const { document, status, error: loadError } = useKeynote(src, parseOptions);
  // Slides are held back until the fonts are usable: laying out with fallback
  // metrics and then swapping reflows every auto-sized text box.
  const fontState = useKeynoteFonts(document?.deck.fonts, fonts ?? {});
  const [uncontrolled, setUncontrolled] = useState(defaultSlide);
  const current = slide ?? uncontrolled;

  // Set when the deck is being navigated backwards, so the slide we land on
  // shows its builds already played.
  const [enterAtEnd, setEnterAtEnd] = useState(false);
  const playbackRef = useRef<Playback | null>(null);

  useEffect(() => {
    if (document) onLoad?.(document);
  }, [document, onLoad]);

  const slides = document?.deck.slides;

  const navigable = useMemo(
    () =>
      (slides ?? [])
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => !respectSkipped || !item.skipped)
        .map(({ index }) => index),
    [slides, respectSkipped],
  );

  const goToSlide = useCallback(
    (index: number, options: { atEnd?: boolean } = {}) => {
      if (!slides) return;
      const clamped = Math.max(0, Math.min(index, slides.length - 1));
      setEnterAtEnd(options.atEnd === true);
      if (slide === undefined) setUncontrolled(clamped);
      onSlideChange?.(clamped, slides[clamped]!);
    },
    [slides, slide, onSlideChange],
  );

  /** Move `delta` slides through the navigable list. */
  const stepSlide = useCallback(
    (delta: number) => {
      if (navigable.length === 0) return false;
      const position = navigable.indexOf(current);
      const from =
        position === -1 ? Math.max(0, navigable.findIndex((index) => index >= current)) : position;
      const next = from + delta;
      if (next < 0 || next >= navigable.length) return false;
      goToSlide(navigable[next]!, { atEnd: delta < 0 });
      return true;
    },
    [navigable, current, goToSlide],
  );

  /**
   * Builds first, then slides — exactly how Keynote advances. The decision is
   * made from `hasNext`, which is derived from committed state, rather than from
   * whatever `next()` reports.
   */
  const advance = useCallback(() => {
    const playback = playbackRef.current;
    if (playback?.hasNext) {
      playback.next();
      return;
    }
    stepSlide(1);
  }, [stepSlide]);

  const retreat = useCallback(() => {
    const playback = playbackRef.current;
    if (playback?.hasPrevious) {
      playback.previous();
      return;
    }
    stepSlide(-1);
  }, [stepSlide]);

  useIsomorphicLayoutEffect(() => {
    if (!controlsRef) return;
    controlsRef.current = {
      advance,
      retreat,
      goToSlide,
      stage: playbackRef.current?.stage ?? 0,
      stageCount: playbackRef.current?.stageCount ?? 0,
    };
  });

  useEffect(() => {
    if (!keyboard || mode !== 'slide') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
        case 'Enter':
          event.preventDefault();
          advance();
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
          event.preventDefault();
          retreat();
          break;
        case 'Home':
          event.preventDefault();
          goToSlide(navigable[0] ?? 0);
          break;
        case 'End':
          event.preventDefault();
          goToSlide(navigable[navigable.length - 1] ?? 0, { atEnd: true });
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [keyboard, mode, advance, retreat, goToSlide, navigable]);

  if (status === 'error' && loadError) {
    return <>{error ? error(loadError) : <DefaultError error={loadError} style={style} />}</>;
  }
  const fontsPending = fontState.status === 'idle' || fontState.status === 'loading';
  if (!document || !slides || fontsPending) {
    return <>{loading ?? <DefaultLoading style={style} />}</>;
  }

  const providerProps = {
    deck: document.deck,
    source: document,
    playMedia,
    ...(lineHeightBasis !== undefined ? { lineHeightBasis } : {}),
  };
  const aspectRatio = `${document.deck.size.width} / ${document.deck.size.height}`;

  if (mode === 'scroll') {
    return (
      <KeynoteProvider {...providerProps}>
        <div className={className} style={{ display: 'grid', gap: 24, ...style }}>
          {slides.map((item) => (
            <SlideStage key={item.id} slide={item} containerStyle={{ aspectRatio }} />
          ))}
        </div>
      </KeynoteProvider>
    );
  }

  if (mode === 'grid') {
    return (
      <KeynoteProvider {...providerProps}>
        <div
          className={className}
          style={{
            display: 'grid',
            gap: 16,
            gridTemplateColumns: `repeat(auto-fill, minmax(${thumbnailWidth}px, 1fr))`,
            ...style,
          }}
        >
          {slides.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => goToSlide(item.index)}
              style={{
                all: 'unset',
                cursor: 'pointer',
                display: 'block',
                opacity: item.skipped ? 0.4 : 1,
              }}
              aria-label={`Slide ${item.number ?? item.index + 1}`}
            >
              <SlideStage
                slide={item}
                containerStyle={{
                  aspectRatio,
                  outline: item.index === current ? '2px solid currentColor' : 'none',
                }}
              />
            </button>
          ))}
        </div>
      </KeynoteProvider>
    );
  }

  const active = slides[current] ?? slides[0]!;

  return (
    <KeynoteProvider {...providerProps}>
      <div
        className={className}
        style={{ position: 'relative', width: '100%', height: '100%', ...style }}
        onClick={
          clickToAdvance
            ? (event) => {
                // Clicking a link inside the slide must not also advance it.
                if ((event.target as HTMLElement).closest('a')) return;
                advance();
              }
            : undefined
        }
      >
        <Stage containerStyle={{ width: '100%', height: '100%' }}>
          <SlidePlayer
            slide={active}
            animate={animate}
            enterAtEnd={enterAtEnd}
            playbackRef={playbackRef}
            {...(onStageChange ? { onStageChange } : {})}
          />
        </Stage>
      </div>
    </KeynoteProvider>
  );
}

function DefaultLoading({ style }: { style?: CSSProperties }) {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: 120, opacity: 0.6, ...style }}>
      Loading presentation…
    </div>
  );
}

function DefaultError({ error, style }: { error: Error; style?: CSSProperties }) {
  return (
    <div
      style={{
        display: 'grid',
        placeItems: 'center',
        minHeight: 120,
        color: '#b00020',
        font: '14px ui-sans-serif, system-ui, sans-serif',
        ...style,
      }}
      role="alert"
    >
      {error.message}
    </div>
  );
}
