import { unzipSync } from 'fflate';

import { decompressIwa } from '../iwa/chunks.js';
import { parseArchiveStream } from '../iwa/stream.js';
import { bundledSchema, type Schema } from '../iwa/schema.js';
import { ArchiveStore } from './store.js';

export interface BundleOptions {
  /** Override the protobuf schema, e.g. for a different iWork release. */
  schema?: Schema;
  /**
   * Called when a component fails to parse. Default behaviour is to skip the
   * component and keep going, so one bad stream can't lose the whole deck.
   */
  onWarning?: (warning: BundleWarning) => void;
}

export interface BundleWarning {
  scope: string;
  message: string;
  cause?: unknown;
}

/** A media payload referenced from the document (`Data/…`). */
export interface DataEntry {
  readonly id: number;
  /** Name as stored in the package. */
  readonly fileName: string;
  /** Original name at import time, when it differs. */
  readonly preferredFileName: string;
  readonly bytes: Uint8Array | undefined;
}

interface RawDataInfo {
  identifier?: number;
  file_name?: string;
  preferred_file_name?: string;
}
interface RawPackageMetadata {
  datas?: RawDataInfo[];
  file_format_version?: number[];
}

const INDEX_PREFIX = 'Index/';
const DATA_PREFIX = 'Data/';

/**
 * A decoded `.key` package: the raw member files, every persisted object, and
 * the media index. This is the layer the document model is built on.
 */
export class KeynoteBundle {
  readonly store = new ArchiveStore();
  readonly warnings: BundleWarning[] = [];
  readonly schema: Schema;
  readonly #files: ReadonlyMap<string, Uint8Array>;
  readonly #data = new Map<number, DataEntry>();
  #fileFormatVersion = '';

  private constructor(files: ReadonlyMap<string, Uint8Array>, options: BundleOptions) {
    this.#files = files;
    this.schema = options.schema ?? bundledSchema();

    const warn = (warning: BundleWarning) => {
      this.warnings.push(warning);
      options.onWarning?.(warning);
    };

    for (const [name, bytes] of files) {
      if (!name.startsWith(INDEX_PREFIX) || !name.endsWith('.iwa')) continue;
      try {
        this.store.add(name, parseArchiveStream(decompressIwa(bytes), this.schema));
      } catch (cause) {
        warn({ scope: name, message: 'failed to parse component', cause });
      }
    }

    this.#indexData(warn);
  }

  /** Open a zipped `.key` file. */
  static fromZip(zip: Uint8Array, options: BundleOptions = {}): KeynoteBundle {
    const entries = unzipSync(zip);
    const files = new Map<string, Uint8Array>();
    for (const [name, bytes] of Object.entries(entries)) {
      if (bytes.length === 0 && name.endsWith('/')) continue;
      files.set(name, bytes);
    }
    return new KeynoteBundle(files, options);
  }

  /** Open an already-expanded package (a `.key` directory, or a custom loader). */
  static fromFiles(
    files: ReadonlyMap<string, Uint8Array>,
    options: BundleOptions = {},
  ): KeynoteBundle {
    return new KeynoteBundle(files, options);
  }

  /** iWork file format version from `TSP.PackageMetadata`, e.g. `"14.4"`. */
  get fileFormatVersion(): string {
    return this.#fileFormatVersion;
  }

  file(name: string): Uint8Array | undefined {
    return this.#files.get(name);
  }

  fileNames(): string[] {
    return [...this.#files.keys()];
  }

  /** Look up a media payload by `TSP.DataReference` identifier. */
  data(id: number | undefined): DataEntry | undefined {
    return id === undefined ? undefined : this.#data.get(id);
  }

  dataEntries(): readonly DataEntry[] {
    return [...this.#data.values()];
  }

  #indexData(warn: (warning: BundleWarning) => void): void {
    const metadata = this.store.first('TSP.PackageMetadata')?.value as
      | RawPackageMetadata
      | undefined;
    if (!metadata) {
      warn({ scope: 'Index/Metadata.iwa', message: 'no TSP.PackageMetadata found' });
      return;
    }

    const version = metadata.file_format_version;
    if (version?.length) this.#fileFormatVersion = version.join('.');

    for (const info of metadata.datas ?? []) {
      if (info.identifier === undefined) continue;
      const fileName = info.file_name ?? info.preferred_file_name ?? '';
      this.#data.set(info.identifier, {
        id: info.identifier,
        fileName,
        preferredFileName: info.preferred_file_name ?? fileName,
        // Missing bytes are normal: iCloud decks can carry unmaterialised media.
        bytes: this.#files.get(DATA_PREFIX + fileName),
      });
    }
  }
}
