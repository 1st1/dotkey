import type { KeynoteDocument } from '@dotkey/core';
import { Keynote, type KeynoteControls, type KeynoteMode } from '@dotkey/react';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A deck to open on load, if one has been provided. Presentations are not
 * committed, so this is normally absent and the file picker is the way in.
 * Copy any `.key` to `apps/demo/public/sample.key` to have it open by default.
 */
const SAMPLE = '/sample.key';

/**
 * `?bare=<index>` renders a single slide at its exact authored size with no
 * surrounding UI, so screenshots can be diffed against the PDF export. Add
 * `&animate=1` to play builds instead of drawing the slide fully built.
 */
function bareOptions(): { index: number; animate: boolean } | null {
  const params = new URLSearchParams(window.location.search);
  const value = params.get('bare');
  if (value === null) return null;
  const index = Number(value);
  return { index: Number.isFinite(index) ? index : 0, animate: params.get('animate') === '1' };
}

export function App() {
  const bare = bareOptions();
  if (bare) return <BareSlide index={bare.index} animate={bare.animate} />;
  return <Workbench />;
}

function BareSlide({ index, animate }: { index: number; animate: boolean }) {
  const [document_, setDocument] = useState<KeynoteDocument | null>(null);
  const [stage, setStage] = useState(0);
  const onLoad = useCallback((doc: KeynoteDocument) => {
    setDocument(doc);
    (window as unknown as { keynote?: KeynoteDocument }).keynote = doc;
  }, []);

  // Exposed so the verification script can watch build progress.
  useEffect(() => {
    (window as unknown as { keynoteStage?: number }).keynoteStage = stage;
  }, [stage]);

  return (
    <div
      style={{
        width: document_?.deck.size.width ?? 1920,
        height: document_?.deck.size.height ?? 1080,
        overflow: 'hidden',
      }}
      data-bare-ready={document_ ? 'true' : 'false'}
    >
      <Keynote
        src={SAMPLE}
        mode="slide"
        slide={index}
        // Static comparisons need every build already played, which is also how
        // Keynote exports to PDF.
        animate={animate}
        keyboard={animate}
        clickToAdvance={false}
        playMedia={false}
        onLoad={onLoad}
        onStageChange={setStage}
        style={{ width: '100%', height: '100%' }}
        loading={null}
      />
    </div>
  );
}

function Workbench() {
  const [source, setSource] = useState<string | File | null>(null);
  const [missing, setMissing] = useState(false);
  const [mode, setMode] = useState<KeynoteMode>('slide');
  const [slide, setSlide] = useState(0);
  const [animate, setAnimate] = useState(true);
  const [stage, setStage] = useState({ stage: 0, count: 0 });
  const [document_, setDocument] = useState<KeynoteDocument | null>(null);
  const controls = useRef<KeynoteControls | null>(null);

  const onLoad = useCallback((doc: KeynoteDocument) => setDocument(doc), []);

  // Try the optional bundled deck once; fall back to the picker if absent.
  // A dev server answers a missing file with the SPA fallback rather than a
  // 404, so the content type is what actually says whether the deck is there.
  useEffect(() => {
    let cancelled = false;
    void fetch(SAMPLE, { method: 'HEAD' })
      .then((response) => {
        if (cancelled) return;
        const html = response.headers.get('content-type')?.includes('text/html');
        if (response.ok && !html) setSource(SAMPLE);
        else setMissing(true);
      })
      .catch(() => !cancelled && setMissing(true));
    return () => {
      cancelled = true;
    };
  }, []);
  const onStageChange = useCallback(
    (value: number, count: number) =>
      // Bail out when nothing changed, so a new object never forces a re-render.
      setStage((previous) =>
        previous.stage === value && previous.count === count
          ? previous
          : { stage: value, count },
      ),
    [],
  );

  // Expose the parsed deck for scripted verification and quick console poking.
  useEffect(() => {
    (window as unknown as { keynote?: KeynoteDocument | null }).keynote = document_;
  }, [document_]);

  const total = document_?.deck.slides.length ?? 0;
  const active = document_?.deck.slides[slide];

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', height: '100%' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 14px',
          borderBottom: '1px solid #232326',
          fontSize: 13,
          flexWrap: 'wrap',
        }}
      >
        <strong style={{ fontWeight: 600 }}>@dotkey/react</strong>

        <input
          type="file"
          accept=".key"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              setSlide(0);
              setSource(file);
            }
          }}
          style={{ fontSize: 12 }}
        />

        <select
          value={mode}
          onChange={(event) => setMode(event.target.value as KeynoteMode)}
          style={{ fontSize: 12 }}
        >
          <option value="slide">Slide</option>
          <option value="scroll">Scroll</option>
          <option value="grid">Grid</option>
        </select>

        <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <input
            type="checkbox"
            checked={animate}
            onChange={(event) => setAnimate(event.target.checked)}
          />
          Animate
        </label>

        {mode === 'slide' && total > 0 ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" onClick={() => controls.current?.retreat()}>
              ‹
            </button>
            <span style={{ minWidth: 72, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
              {slide + 1} / {total}
            </span>
            <button type="button" onClick={() => controls.current?.advance()}>
              ›
            </button>
            {stage.count > 0 ? (
              <span style={{ opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>
                build {stage.stage} / {stage.count}
              </span>
            ) : null}
          </span>
        ) : null}

        {active && mode === 'slide' ? (
          <span style={{ opacity: 0.5 }}>
            {active.builds.length} builds
            {active.transition ? ` · ${active.transition.kind} ${active.transition.duration}s` : ''}
          </span>
        ) : null}

        {document_ ? (
          <span style={{ opacity: 0.55, marginLeft: 'auto' }}>
            iWork {document_.deck.metadata.fileFormatVersion} · {document_.deck.metadata.theme} ·{' '}
            {document_.deck.size.width}×{document_.deck.size.height} ·{' '}
            {Object.keys(document_.deck.resources).length} media ·{' '}
            {document_.deck.fonts.length} fonts
            {document_.warnings.length > 0 ? ` · ${document_.warnings.length} warnings` : ''}
          </span>
        ) : null}
      </header>

      <main
        style={{
          overflow: mode === 'slide' ? 'hidden' : 'auto',
          padding: mode === 'slide' ? 0 : 16,
        }}
      >
        {source === null ? (
          <div style={{ display: 'grid', placeItems: 'center', height: '100%', opacity: 0.6 }}>
            {missing ? 'Choose a .key file to open.' : 'Looking for a deck…'}
          </div>
        ) : (
        <Keynote
          src={source}
          mode={mode}
          slide={mode === 'slide' ? slide : undefined}
          onSlideChange={setSlide}
          onStageChange={onStageChange}
          onLoad={onLoad}
          controlsRef={controls}
          animate={animate}
          style={{ height: mode === 'slide' ? '100%' : undefined }}
        />
        )}
      </main>
    </div>
  );
}
