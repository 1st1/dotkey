import { parseKeynote, type KeynoteDocument, type ParseOptions } from '@dotkey/core';
import { useEffect, useState } from 'react';

/** Anything `useKeynote` knows how to turn into a document. */
export type KeynoteSource =
  | string
  | URL
  | Blob
  | ArrayBuffer
  | Uint8Array
  | KeynoteDocument
  | null
  | undefined;

export type KeynoteStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UseKeynoteResult {
  document: KeynoteDocument | null;
  status: KeynoteStatus;
  error: Error | null;
}

function isDocument(source: KeynoteSource): source is KeynoteDocument {
  return typeof source === 'object' && source !== null && 'deck' in source && 'bundle' in source;
}

/**
 * Load and parse a `.key` file.
 *
 * Blob URLs created for the deck's media are revoked when the document is
 * replaced or the component unmounts — but only for documents this hook parsed,
 * since a caller-supplied one may outlive the component.
 */
export function useKeynote(source: KeynoteSource, options?: ParseOptions): UseKeynoteResult {
  const [state, setState] = useState<UseKeynoteResult>(() =>
    isDocument(source)
      ? { document: source, status: 'ready', error: null }
      : { document: null, status: source ? 'loading' : 'idle', error: null },
  );

  useEffect(() => {
    if (!source) {
      setState({ document: null, status: 'idle', error: null });
      return;
    }

    if (isDocument(source)) {
      setState({ document: source, status: 'ready', error: null });
      return;
    }

    let cancelled = false;
    let owned: KeynoteDocument | null = null;

    setState((previous) => ({ ...previous, status: 'loading', error: null }));

    void (async () => {
      try {
        const bytes =
          typeof source === 'string' || source instanceof URL
            ? await fetchBytes(source)
            : source;
        const document = await parseKeynote(bytes, options);
        if (cancelled) {
          document.revokeResourceUrls();
          return;
        }
        owned = document;
        setState({ document, status: 'ready', error: null });
      } catch (cause) {
        if (cancelled) return;
        setState({
          document: null,
          status: 'error',
          error: cause instanceof Error ? cause : new Error(String(cause)),
        });
      }
    })();

    return () => {
      cancelled = true;
      owned?.revokeResourceUrls();
    };
    // `options` is intentionally not a dependency: it is usually an inline
    // object literal, and re-parsing on every render would be pathological.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  return state;
}

async function fetchBytes(source: string | URL): Promise<ArrayBuffer> {
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Failed to load Keynote file: ${response.status} ${response.statusText}`);
  }
  return response.arrayBuffer();
}
