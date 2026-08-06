import type { ArchiveRecord } from '../iwa/stream.js';

/** A `TSP.Reference` / `TSP.DataReference` as decoded from the wire. */
export interface Ref {
  identifier?: number;
}

export interface ArchiveObject {
  readonly id: number;
  readonly type: number;
  readonly name: string | undefined;
  readonly value: Record<string, unknown> | undefined;
  /** `Index/…iwa` the object was read from. */
  readonly component: string;
}

/**
 * Every persisted object in the document, keyed by identifier, with helpers for
 * chasing `TSP.Reference` fields. Identifiers are unique across components.
 */
export class ArchiveStore {
  readonly #objects = new Map<number, ArchiveObject>();
  readonly #byName = new Map<string, ArchiveObject[]>();

  add(component: string, records: readonly ArchiveRecord[]): void {
    for (const record of records) {
      // The first message is the object; later ones are version alternates.
      const primary = record.messages[0];
      if (!primary) continue;
      const object: ArchiveObject = {
        id: record.id,
        type: primary.type,
        name: primary.name,
        value: primary.value as Record<string, unknown> | undefined,
        component,
      };
      this.#objects.set(record.id, object);
      if (primary.name !== undefined) {
        const list = this.#byName.get(primary.name);
        if (list) list.push(object);
        else this.#byName.set(primary.name, [object]);
      }
    }
  }

  get size(): number {
    return this.#objects.size;
  }

  object(id: number | undefined): ArchiveObject | undefined {
    return id === undefined ? undefined : this.#objects.get(id);
  }

  /** Resolve a reference to the referenced object. */
  deref(ref: Ref | null | undefined): ArchiveObject | undefined {
    return ref?.identifier === undefined ? undefined : this.#objects.get(ref.identifier);
  }

  /** Resolve a reference straight to the decoded message body. */
  resolve<T = Record<string, unknown>>(ref: Ref | null | undefined): T | undefined {
    return this.deref(ref)?.value as T | undefined;
  }

  /** Resolve only if the target has the expected message name. */
  resolveAs<T = Record<string, unknown>>(
    ref: Ref | null | undefined,
    messageName: string,
  ): T | undefined {
    const object = this.deref(ref);
    return object?.name === messageName ? (object.value as T | undefined) : undefined;
  }

  typeName(ref: Ref | null | undefined): string | undefined {
    return this.deref(ref)?.name;
  }

  all(messageName: string): readonly ArchiveObject[] {
    return this.#byName.get(messageName) ?? [];
  }

  first(messageName: string): ArchiveObject | undefined {
    return this.#byName.get(messageName)?.[0];
  }

  /** Message names present in the document, with counts. Useful for diagnostics. */
  inventory(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [name, list] of this.#byName) out[name] = list.length;
    return out;
  }
}
