// Module: lib/persistence/indexeddb-driver — the real PersistenceDriver: raw
// IndexedDB, no wrapper library. Schema v1: one object store (keyPath 'id')
// with an index on sortIndex. The IDBFactory is injectable so the node test
// project runs the exact same code against fake-indexeddb; in the browser the
// global indexedDB is used. Every write (put/delete/reorder) is a single
// transaction — atomic per record set — and put() bumps `revision` from the
// STORED record, the single place where cross-tab conflict detection lives
// (a stale tab's write still advances the revision, never resets it).
//
// Init failures are typed: another tab blocking the version upgrade rejects
// with PersistenceError('blocked'), a throwing upgrade with 'upgrade-failed',
// everything else (storage disabled, db at a newer version) with
// 'open-failed'. See createDefaultDriver for the graceful fallback story.

import { PersistenceError } from './types';
import type { DocumentRecord, PersistenceDriver } from './types';

/** Schema version — bump only with a migration in onupgradeneeded. */
export const DB_VERSION = 1;

export interface IndexedDbDriverOptions {
  /** Database name. Default 'qalam'. */
  dbName?: string;
  /** Object store name. Default 'documents'. */
  storeName?: string;
  /** Injectable factory — tests pass `new IDBFactory()` from fake-indexeddb. */
  factory?: IDBFactory;
}

/** Resolve an IDBRequest to its result, mapping errors to PersistenceError. */
function requestDone<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      reject(
        new PersistenceError('unknown', 'IndexedDB request failed', { cause: request.error }),
      );
    };
  });
}

/** Resolve when a transaction commits; rejects with the abort reason. */
function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.addEventListener('complete', () => resolve());
    tx.addEventListener('abort', () => {
      reject(
        new PersistenceError('unknown', 'IndexedDB transaction aborted', { cause: tx.error }),
      );
    });
    tx.addEventListener('error', () => {
      reject(
        new PersistenceError('unknown', 'IndexedDB transaction failed', { cause: tx.error }),
      );
    });
  });
}

export function createIndexedDbDriver(opts: IndexedDbDriverOptions = {}): PersistenceDriver {
  const dbName = opts.dbName ?? 'qalam';
  const storeName = opts.storeName ?? 'documents';

  let db: IDBDatabase | null = null;

  const assertOpen = (): IDBDatabase => {
    if (!db) throw new PersistenceError('unknown', 'driver not initialized — call init() first');
    return db;
  };

  const withStore = (
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => void,
  ): Promise<void> => {
    const database = assertOpen();
    const tx = database.transaction(storeName, mode);
    run(tx.objectStore(storeName));
    return transactionDone(tx);
  };

  return {
    name: 'indexeddb',

    async init() {
      if (db) return;
      const factory = opts.factory ?? globalThis.indexedDB;
      if (!factory) {
        throw new PersistenceError('open-failed', 'IndexedDB is not available in this environment');
      }

      let upgraded = false;
      const request = factory.open(dbName, DB_VERSION);

      const opened = new Promise<IDBDatabase>((resolve, reject) => {
        request.onupgradeneeded = () => {
          upgraded = true;
          const database = request.result;
          if (!database.objectStoreNames.contains(storeName)) {
            const os = database.createObjectStore(storeName, { keyPath: 'id' });
            os.createIndex('sortIndex', 'sortIndex');
          }
        };
        request.onblocked = () => {
          reject(
            new PersistenceError(
              'blocked',
              `IndexedDB upgrade for "${dbName}" is blocked by another tab holding an old version`,
            ),
          );
        };
        request.onerror = () => {
          reject(
            new PersistenceError(
              upgraded ? 'upgrade-failed' : 'open-failed',
              upgraded
                ? `IndexedDB upgrade for "${dbName}" failed`
                : `Could not open IndexedDB database "${dbName}"`,
              { cause: request.error },
            ),
          );
        };
        request.onsuccess = () => resolve(request.result);
      });

      try {
        db = await opened;
      } catch (err) {
        // The open may still complete after a block/error was reported —
        // never leak the connection in that case. The rejection itself was
        // already handled above, so the second handler is a silent no-op.
        opened.catch(() => {});
        if (request.readyState === 'done' && request.result) request.result.close();
        throw err;
      }

      // Politely yield when another tab requests a version upgrade.
      db.onversionchange = () => {
        db?.close();
        db = null;
      };
    },

    async list() {
      const database = assertOpen();
      const tx = database.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).getAll() as IDBRequest<DocumentRecord[]>;
      const all = await requestDone(request);
      return all.sort(
        (a, b) => a.sortIndex - b.sortIndex || a.updatedAt - b.updatedAt,
      );
    },

    async get(id) {
      const database = assertOpen();
      const tx = database.transaction(storeName, 'readonly');
      const found = await requestDone(
        tx.objectStore(storeName).get(id) as IDBRequest<DocumentRecord | undefined>,
      );
      return found ?? null;
    },

    async put(doc) {
      await withStore('readwrite', (store) => {
        const getReq = store.get(doc.id);
        getReq.onsuccess = () => {
          const stored = getReq.result as DocumentRecord | undefined;
          const revision = (stored ? stored.revision : doc.revision) + 1;
          store.put({ ...doc, revision });
        };
      });
    },

    async delete(id) {
      await withStore('readwrite', (store) => {
        store.delete(id);
      });
    },

    async reorder(orderedIds) {
      await withStore('readwrite', (store) => {
        orderedIds.forEach((id, index) => {
          const getReq = store.get(id);
          getReq.onsuccess = () => {
            const found = getReq.result as DocumentRecord | undefined;
            if (found) store.put({ ...found, sortIndex: index });
          };
        });
      });
    },

    async close() {
      if (!db) return;
      db.close();
      db = null;
    },
  };
}
