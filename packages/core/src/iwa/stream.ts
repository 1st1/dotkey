import { readVarint } from './chunks.js';
import type { Schema } from './schema.js';

/** One protobuf message inside an archive record. */
export interface ArchiveMessage {
  /** Numeric `TSPRegistry` type. */
  readonly type: number;
  /** Resolved message name, if the registry knows this type. */
  readonly name: string | undefined;
  readonly version: readonly number[];
  /** Decoded plain object, or `undefined` when the type is unmapped. */
  readonly value: unknown;
}

/**
 * A persisted object. The first message is the object itself; additional
 * messages carry version-specific alternates that iWork writes for forward
 * compatibility (older/newer readers pick the one they understand).
 */
export interface ArchiveRecord {
  readonly id: number;
  readonly messages: readonly ArchiveMessage[];
}

interface RawMessageInfo {
  type?: number;
  version?: number[];
  length?: number;
}
interface RawArchiveInfo {
  identifier?: number;
  message_infos?: RawMessageInfo[];
}

/**
 * The decompressed `.iwa` payload is a flat sequence of
 * `varint(headerLength) TSP.ArchiveInfo <payloads...>` records.
 */
export function parseArchiveStream(bytes: Uint8Array, schema: Schema): ArchiveRecord[] {
  const records: ArchiveRecord[] = [];
  let pos = 0;

  while (pos < bytes.length) {
    const [headerLength, afterVarint] = readVarint(bytes, pos);
    pos = afterVarint;
    if (pos + headerLength > bytes.length) throw new Error('truncated ArchiveInfo header');

    const info = schema.decodeAs(
      'TSP.ArchiveInfo',
      bytes.subarray(pos, pos + headerLength),
    ) as RawArchiveInfo | undefined;
    pos += headerLength;
    if (!info) throw new Error('schema is missing TSP.ArchiveInfo');

    const messages: ArchiveMessage[] = [];
    for (const messageInfo of info.message_infos ?? []) {
      const length = messageInfo.length ?? 0;
      const payload = bytes.subarray(pos, pos + length);
      pos += length;

      const type = messageInfo.type ?? 0;
      const name = schema.messageName(type);
      let value: unknown;
      if (name !== undefined) {
        try {
          value = schema.decode(type, payload);
        } catch {
          // A single malformed object must not take down the whole document;
          // it surfaces as an "unsupported" element downstream.
          value = undefined;
        }
      }
      messages.push({ type, name, version: messageInfo.version ?? [], value });
    }

    records.push({ id: info.identifier ?? 0, messages });
  }

  return records;
}
