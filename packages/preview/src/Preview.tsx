import {
  Keynote,
  type KeynoteControls,
  type KeynoteMode,
  type KeynoteProps,
  type KeynoteSource,
} from '@dotkey/react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

import './styles.css';

type ForwardedKeynoteProps = Omit<
  KeynoteProps,
  | 'src'
  | 'mode'
  | 'slide'
  | 'defaultSlide'
  | 'controlsRef'
  | 'onLoad'
  | 'onSlideChange'
  | 'className'
  | 'style'
>;

export interface PreviewProps {
  src: KeynoteSource;
  mode?: KeynoteMode;
  defaultMode?: KeynoteMode;
  onModeChange?: (mode: KeynoteMode) => void;
  slide?: number;
  defaultSlide?: number;
  onSlideChange?: NonNullable<KeynoteProps['onSlideChange']>;
  onLoad?: NonNullable<KeynoteProps['onLoad']>;
  /** Optional content placed at the leading edge of the header. */
  brand?: ReactNode;
  /** Show the fullscreen control when the browser supports it. Default `true`. */
  fullscreenButton?: boolean;
  onFullscreenChange?: (fullscreen: boolean) => void;
  /** Props forwarded to the underlying `@dotkey/react` renderer. */
  keynoteProps?: ForwardedKeynoteProps;
  className?: string;
  style?: CSSProperties;
}

/** Full-screen presentation GUI around the `@dotkey/react` renderer. */
export function Preview({
  src,
  mode,
  defaultMode = 'slide',
  onModeChange,
  slide,
  defaultSlide = 0,
  onSlideChange,
  onLoad,
  brand,
  fullscreenButton = true,
  onFullscreenChange,
  keynoteProps,
  className,
  style,
}: PreviewProps) {
  const root = useRef<HTMLDivElement | null>(null);
  const controls = useRef<KeynoteControls | null>(null);
  const [internalMode, setInternalMode] = useState<KeynoteMode>(defaultMode);
  const [internalSlide, setInternalSlide] = useState(defaultSlide);
  const [slideCount, setSlideCount] = useState(0);
  const [fullscreenAvailable, setFullscreenAvailable] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const activeMode = mode ?? internalMode;
  const currentSlide = slide ?? internalSlide;

  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = document.fullscreenElement === root.current;
      setFullscreen(active);
      onFullscreenChange?.(active);
    };

    setFullscreenAvailable(document.fullscreenEnabled);
    handleFullscreenChange();
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [onFullscreenChange]);

  const changeMode = useCallback(
    (next: KeynoteMode) => {
      if (mode === undefined) setInternalMode(next);
      onModeChange?.(next);
    },
    [mode, onModeChange],
  );

  const changeSlide = useCallback(
    (index: number, item?: Parameters<NonNullable<KeynoteProps['onSlideChange']>>[1]) => {
      if (slide === undefined) setInternalSlide(index);
      if (item) onSlideChange?.(index, item);
    },
    [slide, onSlideChange],
  );

  const handleLoad = useCallback<NonNullable<KeynoteProps['onLoad']>>(
    (document) => {
      setSlideCount(document.deck.slides.length);
      onLoad?.(document);
    },
    [onLoad],
  );

  const openSlide = useCallback(
    (index: number) => {
      controls.current?.goToSlide(index);
      changeMode('slide');
    },
    [changeMode],
  );

  const rootClassName = ['dotkey-preview', className].filter(Boolean).join(' ');

  const toggleFullscreen = useCallback(() => {
    void (async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await root.current?.requestFullscreen();
      } catch {
        // Browsers may reject fullscreen when permission or user activation is absent.
      }
    })();
  }, []);

  return (
    <div ref={root} className={rootClassName} style={style}>
      <Header
        current={currentSlide}
        total={Math.max(0, slideCount - 1)}
        mode={activeMode}
        onModeChange={changeMode}
        brand={brand}
        fullscreen={fullscreen}
        showFullscreen={fullscreenButton && fullscreenAvailable}
        onToggleFullscreen={toggleFullscreen}
      />

      <main
        className={
          activeMode === 'slide'
            ? 'dotkey-preview__deck'
            : 'dotkey-preview__deck dotkey-preview__deck--browse'
        }
        aria-label="Presentation"
        onDoubleClick={
          activeMode === 'grid'
            ? (event) => {
                const target = event.target as HTMLElement;
                const thumbnail = target.closest<HTMLButtonElement>('button[aria-label^="Slide "]');
                const container = thumbnail?.parentElement;
                if (!thumbnail || !container) return;
                const thumbnails = Array.from(
                  container.querySelectorAll<HTMLButtonElement>(
                    ':scope > button[aria-label^="Slide "]',
                  ),
                );
                const index = thumbnails.indexOf(thumbnail);
                if (index >= 0) openSlide(index);
              }
            : undefined
        }
      >
        <Keynote
          {...keynoteProps}
          src={src}
          mode={activeMode}
          slide={currentSlide}
          controlsRef={controls}
          onLoad={handleLoad}
          onSlideChange={changeSlide}
          className="dotkey-preview__keynote"
          thumbnailWidth={keynoteProps?.thumbnailWidth ?? 260}
          loading={keynoteProps?.loading ?? <Status>Loading presentation…</Status>}
          error={
            keynoteProps?.error ??
            ((error) => <Status error>Could not load the presentation: {error.message}</Status>)
          }
        />
      </main>

      <Footer
        current={currentSlide}
        total={slideCount}
        navigation={activeMode === 'slide'}
        onPrevious={() => controls.current?.retreat()}
        onNext={() => controls.current?.advance()}
        onSelectSlide={openSlide}
      />
    </div>
  );
}

function Header({
  current,
  total,
  mode,
  onModeChange,
  brand,
  fullscreen,
  showFullscreen,
  onToggleFullscreen,
}: {
  current: number;
  total: number;
  mode: KeynoteMode;
  onModeChange: (mode: KeynoteMode) => void;
  brand?: ReactNode;
  fullscreen: boolean;
  showFullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  return (
    <header className="dotkey-preview__header">
      <div className="dotkey-preview__brand">{brand}</div>
      <div className="dotkey-preview__header-controls">
        <nav className="dotkey-preview__view-switcher" aria-label="Presentation view">
          <ViewButton label="Single slide" mode="slide" activeMode={mode} onSelect={onModeChange} />
          <ViewButton label="Grid" mode="grid" activeMode={mode} onSelect={onModeChange} />
          <ViewButton label="Continuous scroll" mode="scroll" activeMode={mode} onSelect={onModeChange} />
        </nav>
        {showFullscreen ? (
          <button
            type="button"
            className="dotkey-preview__fullscreen-button"
            aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            title={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            onClick={onToggleFullscreen}
          >
            <FullscreenIcon active={fullscreen} />
          </button>
        ) : null}
        <div className="dotkey-preview__counter" aria-live="polite">
          <span>{formatCount(current)}</span>
          <span className="dotkey-preview__counter-separator">/</span>
          <span>{formatCount(total)}</span>
        </div>
      </div>
    </header>
  );
}

function FullscreenIcon({ active }: { active: boolean }) {
  return active ? (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4" />
    </svg>
  );
}

function ViewButton({
  label,
  mode,
  activeMode,
  onSelect,
}: {
  label: string;
  mode: KeynoteMode;
  activeMode: KeynoteMode;
  onSelect: (mode: KeynoteMode) => void;
}) {
  const active = mode === activeMode;
  return (
    <button
      type="button"
      className={
        active
          ? 'dotkey-preview__view-button dotkey-preview__view-button--active'
          : 'dotkey-preview__view-button'
      }
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={() => onSelect(mode)}
    >
      <ViewIcon mode={mode} />
    </button>
  );
}

function ViewIcon({ mode }: { mode: KeynoteMode }) {
  if (mode === 'grid') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2" y="2" width="4.5" height="4.5" rx="0.8" />
        <rect x="9.5" y="2" width="4.5" height="4.5" rx="0.8" />
        <rect x="2" y="9.5" width="4.5" height="4.5" rx="0.8" />
        <rect x="9.5" y="9.5" width="4.5" height="4.5" rx="0.8" />
      </svg>
    );
  }
  if (mode === 'scroll') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2.5" y="1.5" width="11" height="5" rx="1" />
        <rect x="2.5" y="9.5" width="11" height="5" rx="1" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="3" width="13" height="10" rx="1.5" />
    </svg>
  );
}

function Footer({
  current,
  total,
  onPrevious,
  onNext,
  onSelectSlide,
  navigation,
}: {
  current: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
  onSelectSlide: (index: number) => void;
  navigation: boolean;
}) {
  return (
    <footer className="dotkey-preview__footer">
      <nav
        className="dotkey-preview__progress"
        aria-label={`Slide navigation, currently ${current + 1} of ${total}`}
      >
        {Array.from({ length: total }, (_, index) => (
          <button
            type="button"
            className={
              index === current
                ? 'dotkey-preview__progress-segment dotkey-preview__progress-segment--active'
                : 'dotkey-preview__progress-segment'
            }
            aria-label={`Go to slide ${index + 1}`}
            aria-current={index === current ? 'page' : undefined}
            onClick={() => onSelectSlide(index)}
            key={index}
          />
        ))}
      </nav>
      {navigation ? (
        <nav className="dotkey-preview__navigation" aria-label="Slide navigation">
          <button type="button" onClick={onPrevious} aria-label="Previous slide">
            <Chevron direction="left" />
          </button>
          <button type="button" onClick={onNext} aria-label="Next slide">
            <Chevron direction="right" />
          </button>
        </nav>
      ) : (
        <div className="dotkey-preview__navigation-placeholder" aria-hidden="true" />
      )}
    </footer>
  );
}

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d={direction === 'left' ? 'm12.5 4.5-5.5 5.5 5.5 5.5' : 'M7.5 4.5 13 10l-5.5 5.5'} />
    </svg>
  );
}

function Status({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <div
      className={error ? 'dotkey-preview__status dotkey-preview__status--error' : 'dotkey-preview__status'}
      role={error ? 'alert' : 'status'}
    >
      {children}
    </div>
  );
}

function formatCount(value: number) {
  return String(Math.max(0, value)).padStart(2, '0');
}
