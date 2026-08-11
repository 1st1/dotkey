import type { KeynoteDocument } from '@dotkey/core';
import { Preview } from '@dotkey/preview';
import { Keynote } from '@dotkey/react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';

import './app.css';

/**
 * A deck to open on load, if one has been provided. Presentations are not
 * committed, so this is normally absent and the file picker is the way in.
 * Copy any `.key` to `apps/demo/public/sample.key` to use the bare route.
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
  return <KeynotePreview />;
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

function KeynotePreview() {
  const [source, setSource] = useState<File | null>(null);

  if (source) return <Preview src={source} />;
  return <KeynoteDropZone onSelect={setSource} />;
}

function KeynoteDropZone({ onSelect }: { onSelect: (file: File) => void }) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragDepth = useRef(0);

  const select = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      if (!file.name.toLowerCase().endsWith('.key')) {
        setError('Choose a Keynote .key file.');
        return;
      }

      setError(null);
      onSelect(file);
    },
    [onSelect],
  );

  const onDragEnter = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };

  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    select(event.dataTransfer.files[0]);
  };

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    select(event.target.files?.[0]);
  };

  return (
    <main
      className={`keynote-drop-page${dragging ? ' is-dragging' : ''}`}
      onDragEnter={onDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <section className="keynote-drop-target" aria-label="Open a Keynote presentation">
        <svg className="keynote-drop-icon" viewBox="0 0 48 48" aria-hidden="true">
          <rect x="7" y="5" width="34" height="38" rx="5" />
          <path d="M15 31 22 24l5 5 4-4 5 6" />
          <circle cx="31" cy="16" r="3" />
        </svg>
        <h1>Drop a Keynote file</h1>
        <p>Drag and drop a <code>.key</code> presentation here</p>
        <label className="keynote-file-button">
          Choose file
          <input type="file" accept=".key" onChange={onChange} />
        </label>
        {error ? <p className="keynote-drop-error" role="alert">{error}</p> : null}
      </section>
    </main>
  );
}
