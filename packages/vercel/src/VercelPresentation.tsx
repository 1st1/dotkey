import {
  Keynote,
  type KeynoteControls,
  type KeynoteMode,
  type KeynoteProps,
  type KeynoteSource,
} from '@dotkey/react';
import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

import vercelLogo from './vercel-logotype.svg';
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

export interface VercelPresentationProps {
  src: KeynoteSource;
  mode?: KeynoteMode;
  defaultMode?: KeynoteMode;
  onModeChange?: (mode: KeynoteMode) => void;
  slide?: number;
  defaultSlide?: number;
  onSlideChange?: NonNullable<KeynoteProps['onSlideChange']>;
  onLoad?: NonNullable<KeynoteProps['onLoad']>;
  /** Replace the official Vercel logotype with custom branding. */
  brand?: ReactNode;
  /** Props forwarded to the underlying `@dotkey/react` renderer. */
  keynoteProps?: ForwardedKeynoteProps;
  className?: string;
  style?: CSSProperties;
}

/** Full-screen Vercel-style chrome around the `@dotkey/react` renderer. */
export function VercelPresentation({
  src,
  mode,
  defaultMode = 'slide',
  onModeChange,
  slide,
  defaultSlide = 0,
  onSlideChange,
  onLoad,
  brand,
  keynoteProps,
  className,
  style,
}: VercelPresentationProps) {
  const controls = useRef<KeynoteControls | null>(null);
  const [internalMode, setInternalMode] = useState<KeynoteMode>(defaultMode);
  const [internalSlide, setInternalSlide] = useState(defaultSlide);
  const [slideCount, setSlideCount] = useState(0);
  const activeMode = mode ?? internalMode;
  const currentSlide = slide ?? internalSlide;

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

  const rootClassName = ['dotkey-vercel', className].filter(Boolean).join(' ');

  return (
    <div className={rootClassName} style={style}>
      <Header
        current={currentSlide}
        total={Math.max(0, slideCount - 1)}
        mode={activeMode}
        onModeChange={changeMode}
        brand={brand}
      />

      <main
        className={
          activeMode === 'slide'
            ? 'dotkey-vercel__deck'
            : 'dotkey-vercel__deck dotkey-vercel__deck--browse'
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
          className="dotkey-vercel__keynote"
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
}: {
  current: number;
  total: number;
  mode: KeynoteMode;
  onModeChange: (mode: KeynoteMode) => void;
  brand?: ReactNode;
}) {
  return (
    <header className="dotkey-vercel__header">
      {brand ?? <img className="dotkey-vercel__brand" src={vercelLogo} alt="Vercel" />}
      <div className="dotkey-vercel__header-controls">
        <nav className="dotkey-vercel__view-switcher" aria-label="Presentation view">
          <ViewButton label="Single slide" mode="slide" activeMode={mode} onSelect={onModeChange} />
          <ViewButton label="Grid" mode="grid" activeMode={mode} onSelect={onModeChange} />
          <ViewButton label="Continuous scroll" mode="scroll" activeMode={mode} onSelect={onModeChange} />
        </nav>
        <div className="dotkey-vercel__counter" aria-live="polite">
          <span>{formatCount(current)}</span>
          <span className="dotkey-vercel__counter-separator">/</span>
          <span>{formatCount(total)}</span>
        </div>
      </div>
    </header>
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
          ? 'dotkey-vercel__view-button dotkey-vercel__view-button--active'
          : 'dotkey-vercel__view-button'
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
    <footer className="dotkey-vercel__footer">
      <nav
        className="dotkey-vercel__progress"
        aria-label={`Slide navigation, currently ${current + 1} of ${total}`}
      >
        {Array.from({ length: total }, (_, index) => (
          <button
            type="button"
            className={
              index === current
                ? 'dotkey-vercel__progress-segment dotkey-vercel__progress-segment--active'
                : 'dotkey-vercel__progress-segment'
            }
            aria-label={`Go to slide ${index + 1}`}
            aria-current={index === current ? 'page' : undefined}
            onClick={() => onSelectSlide(index)}
            key={index}
          />
        ))}
      </nav>
      {navigation ? (
        <nav className="dotkey-vercel__navigation" aria-label="Slide navigation">
          <button type="button" onClick={onPrevious} aria-label="Previous slide">
            <Chevron direction="left" />
          </button>
          <button type="button" onClick={onNext} aria-label="Next slide">
            <Chevron direction="right" />
          </button>
        </nav>
      ) : (
        <div className="dotkey-vercel__navigation-placeholder" aria-hidden="true" />
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
      className={error ? 'dotkey-vercel__status dotkey-vercel__status--error' : 'dotkey-vercel__status'}
      role={error ? 'alert' : 'status'}
    >
      {children}
    </div>
  );
}

function formatCount(value: number) {
  return String(Math.max(0, value)).padStart(2, '0');
}
