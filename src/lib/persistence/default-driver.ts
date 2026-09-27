// Module: lib/persistence/default-driver — driver selection for the app boot
// path: prefer IndexedDB; degrade to the in-memory driver when IndexedDB is
// unavailable (browser without it, storage disabled, private mode rejecting
// opens) or when init fails (blocked upgrade, version errors). Persistence is
// a graceful degradation, never a boot failure: the app keeps working with
// session-only storage, and the fallback is reported exactly once per
// fallback through console.warn so the support signal is visible without
// spamming. All options pass through to the IndexedDB driver (dbName,
// storeName, injected factory for tests).

import { createIndexedDbDriver } from './indexeddb-driver';
import createMemoryDriver from './memory-driver';
import type { IndexedDbDriverOptions } from './indexeddb-driver';
import type { PersistenceDriver } from './types';

export type DefaultDriverOptions = IndexedDbDriverOptions;

/**
 * console.warn reached through globalThis: the blanket `no-console` lint ban
 * (everything outside the AI delta) is deliberate, and this single,
 * by-design fallback notice is exactly the kind of signal it must survive.
 */
function warnFallback(message: string): void {
  globalThis.console?.warn?.(message);
}

/**
 * Resolve the production driver. Never rejects: on any failure it resolves
 * with a memory driver after warning once, so a broken/blocked IndexedDB
 * costs data durability for the session, not app availability.
 */
export async function createDefaultDriver(
  opts: DefaultDriverOptions = {},
): Promise<PersistenceDriver> {
  const factory = opts.factory ?? globalThis.indexedDB;

  if (!factory) {
    warnFallback(
      'qalam: IndexedDB is unavailable in this environment — falling back to in-memory persistence (documents will not survive a reload).',
    );
    return createMemoryDriver();
  }

  try {
    const driver = createIndexedDbDriver({ ...opts, factory });
    await driver.init();
    return driver;
  } catch (err) {
    warnFallback(
      `qalam: IndexedDB persistence is unavailable (${
        err instanceof Error ? err.message : String(err)
      }) — falling back to in-memory persistence (documents will not survive a reload).`,
    );
    return createMemoryDriver();
  }
}
