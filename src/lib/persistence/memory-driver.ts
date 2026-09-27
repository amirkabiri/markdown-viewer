// Module: lib/persistence/memory-driver — the in-memory PersistenceDriver.
// Doubles as the test fake for every higher layer AND the graceful runtime
// fallback when IndexedDB is unavailable (private browsing, disabled storage —
// see createDefaultDriver). Same atomic put()/revision semantics as the real
// driver so tests exercise one contract. Ephemeral by design: state lives and
// dies with the instance, close() is a no-op, records are copied at the
// boundary so callers can never mutate the store through a returned reference.

import type { DocumentRecord, PersistenceDriver } from './types';

/** Records to prepopulate the store with (copied, never aliased). */
export function createMemoryDriver(seed: readonly DocumentRecord[] = []): PersistenceDriver {
  const docs = new Map<string, DocumentRecord>();
  for (const record of seed) docs.set(record.id, { ...record });

  const sortedValues = (): DocumentRecord[] =>
    [...docs.values()].sort(
      (a, b) => a.sortIndex - b.sortIndex || a.updatedAt - b.updatedAt,
    );

  return {
    name: 'memory',

    async init() {
      /* nothing to establish — the store is live immediately */
    },

    async list() {
      return sortedValues().map((d) => ({ ...d }));
    },

    async get(id) {
      const found = docs.get(id);
      return found ? { ...found } : null;
    },

    async put(doc) {
      // Revision bumps from the STORED record — identical to the IndexedDB
      // driver, so a stale copy can never silently reset the revision.
      const stored = docs.get(doc.id);
      const revision = (stored ? stored.revision : doc.revision) + 1;
      docs.set(doc.id, { ...doc, revision });
    },

    async delete(id) {
      docs.delete(id);
    },

    async reorder(orderedIds) {
      orderedIds.forEach((id, index) => {
        const found = docs.get(id);
        if (found) docs.set(id, { ...found, sortIndex: index });
      });
    },

    async close() {
      /* nothing to release */
    },
  };
}
