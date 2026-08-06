import type { KeynoteBundle } from '../document/bundle.js';
import type { ArchiveStore, Ref } from '../document/store.js';
import { canTranscode } from '../media/transcode.js';
import type { Resource, ResourceId } from '../model/types.js';

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  bmp: 'image/bmp',
  mov: 'video/quicktime',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  avi: 'video/x-msvideo',
  webm: 'video/webm',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aiff: 'audio/aiff',
  caf: 'audio/x-caf',
};

export function mimeTypeFor(fileName: string): string {
  const extension = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

/**
 * Formats every browser can decode in an `<img>`. Keynote happily embeds TIFF,
 * HEIC and PDF, and keeps a PNG sidecar for exactly this reason.
 */
const WEB_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/svg+xml',
]);

export function isWebImage(mimeType: string): boolean {
  return WEB_IMAGE_TYPES.has(mimeType);
}

/** Shared state threaded through the extractors while a deck is built. */
export class BuildContext {
  readonly store: ArchiveStore;
  readonly resources = new Map<ResourceId, Resource>();
  readonly fonts = new Set<string>();
  readonly unsupported: Record<string, number> = {};

  constructor(readonly bundle: KeynoteBundle) {
    this.store = bundle.store;
  }

  /** Register a `TSP.DataReference` and return the resource id to put in the model. */
  resource(ref: Ref | null | undefined): ResourceId | null {
    const id = ref?.identifier;
    if (id === undefined) return null;
    const entry = this.bundle.data(id);
    if (!entry) return null;

    const resourceId = String(id);
    if (!this.resources.has(resourceId)) {
      const fileName = entry.fileName || entry.preferredFileName;
      const stored = mimeTypeFor(fileName);
      const served = canTranscode(stored) ? 'image/png' : stored;
      this.resources.set(resourceId, {
        id: resourceId,
        fileName,
        mimeType: served,
        ...(served === stored ? {} : { sourceMimeType: stored }),
        byteLength: entry.bytes?.length ?? 0,
        available: entry.bytes !== undefined,
      });
    }
    return resourceId;
  }

  /**
   * Pick the first candidate that will end up displayable, falling back to the
   * first that exists at all.
   *
   * Keynote stores originals in formats like TIFF or HEIC and keeps a PNG
   * derivative beside them — but that derivative is a *thumbnail*, so preferring
   * it throws away most of the resolution. A format we can transcode therefore
   * counts as displayable, and only one we can neither show nor decode sends us
   * to the derivative.
   */
  displayableResource(...candidates: (Ref | null | undefined)[]): ResourceId | null {
    const resolved = candidates
      .map((ref) => this.resource(ref))
      .filter((id): id is ResourceId => id !== null);
    const usable = resolved.find((id) => {
      const resource = this.resources.get(id);
      if (resource?.available !== true) return false;
      return isWebImage(resource.mimeType) || canTranscode(resource.sourceMimeType ?? '');
    });
    return usable ?? resolved[0] ?? null;
  }

  font(name: string | undefined): void {
    if (name) this.fonts.add(name);
  }

  noteUnsupported(archive: string): void {
    this.unsupported[archive] = (this.unsupported[archive] ?? 0) + 1;
  }
}
