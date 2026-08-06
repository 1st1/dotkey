// protobufjs is CommonJS; a default import is the only form that works
// unchanged across Node ESM, bundlers and CJS consumers.
import protobuf from 'protobufjs/light';
import type { Root as RootType, Type } from 'protobufjs/light';

import schemaJson from '../generated/schema.json';
import registryJson from '../generated/registry.json';
import metaJson from '../generated/meta.json';

const { Root } = protobuf;

/**
 * Maps the numeric archive type stored in every `TSP.MessageInfo` to a
 * protobuf message name. iWork keeps this table (`TSPRegistry`) inside the
 * application binary; the vendored copy is version-specific.
 */
export type RegistryTable = Record<string, string>;

export interface Schema {
  readonly iworkVersion: string;
  /** Message name for an archive type id, or `undefined` if unmapped. */
  messageName(typeId: number): string | undefined;
  /** Decode an archive payload into a plain object, or `undefined` if unmapped. */
  decode(typeId: number, payload: Uint8Array): unknown;
  /** Decode by message name — used for the container-level messages. */
  decodeAs(messageName: string, payload: Uint8Array): unknown;
}

export interface SchemaSource {
  /** protobuf.js JSON descriptor (output of `Root#toJSON`). */
  schema: unknown;
  /** Archive type id -> message name. */
  registry: RegistryTable;
  iworkVersion?: string;
}

/**
 * `defaults: false` is deliberate: proto2 declares defaults for many style
 * properties, and the style cascade has to tell "absent, inherit from parent"
 * apart from "explicitly set to the default value".
 */
const TO_OBJECT_OPTIONS = {
  longs: Number,
  enums: String,
  bytes: Array,
  defaults: false,
  arrays: true,
  objects: false,
  oneofs: true,
} as const;

class ProtobufSchema implements Schema {
  readonly iworkVersion: string;
  readonly #root: RootType;
  readonly #registry: RegistryTable;
  readonly #types = new Map<string, Type | null>();

  constructor(source: SchemaSource) {
    this.#root = Root.fromJSON(source.schema as Parameters<typeof Root.fromJSON>[0]);
    this.#registry = source.registry;
    this.iworkVersion = source.iworkVersion ?? 'unknown';
  }

  messageName(typeId: number): string | undefined {
    return this.#registry[String(typeId)];
  }

  decode(typeId: number, payload: Uint8Array): unknown {
    const name = this.messageName(typeId);
    if (name === undefined) return undefined;
    return this.decodeAs(name, payload);
  }

  decodeAs(messageName: string, payload: Uint8Array): unknown {
    const type = this.#lookup(messageName);
    if (!type) return undefined;
    return type.toObject(type.decode(payload), TO_OBJECT_OPTIONS);
  }

  #lookup(name: string): Type | null {
    const cached = this.#types.get(name);
    if (cached !== undefined) return cached;
    let type: Type | null = null;
    try {
      type = this.#root.lookupType(name);
    } catch {
      type = null;
    }
    this.#types.set(name, type);
    return type;
  }
}

export function createSchema(source: SchemaSource): Schema {
  return new ProtobufSchema(source);
}

let bundled: Schema | undefined;

/** The schema compiled from the vendored iWork definitions (see `tools/gen-schema.mjs`). */
export function bundledSchema(): Schema {
  bundled ??= createSchema({
    schema: schemaJson,
    registry: registryJson as RegistryTable,
    iworkVersion: (metaJson as { iworkVersion: string }).iworkVersion,
  });
  return bundled;
}
