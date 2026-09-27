// Module: lib/persistence — the document persistence layer (public entry).
// Frozen contract: types.ts (DocumentRecord/DriverName/PersistenceDriver +
// the v2 multi-tab additions). Consumers (the UI) should need only
// createDocumentRepository, createDefaultDriver, the sync/lock helpers and
// these types; the drivers themselves are swappable (IndexedDB now, browser
// File System Access later — see FILE_SYSTEM_ACCESS.md in this folder).

import createMemoryDriver from './memory-driver';
import createDocumentRepository from './repository';

export { createDefaultDriver } from './default-driver';
export type { DefaultDriverOptions } from './default-driver';
export { DB_VERSION, createIndexedDbDriver } from './indexeddb-driver';
export type { IndexedDbDriverOptions } from './indexeddb-driver';
export { MIGRATION_FLAG_KEY, migrateLegacyLocalStorage } from './migrate';
export type { LegacyRecentItem } from './migrate';
export { createMemoryDriver };
export { createDocumentRepository };
export {
  DEFAULT_SYNC_CHANNEL,
  LOCK_NAME_PREFIX,
  createDefaultLockAdapter,
  createInProcessLockAdapter,
  createNoLockAdapter,
  createTabSyncHub,
  createWebLockAdapter,
} from './sync';
export { PersistenceError } from './types';
export type {
  DocumentLockAdapter,
  DocumentRecord,
  DocumentRepository,
  DocumentRepositoryOptions,
  DocumentSession,
  DocumentSource,
  DriverName,
  LockAcquisition,
  PersistenceDriver,
  PersistenceErrorCode,
  RepositoryChangeEvent,
  RepositoryChangeType,
  SessionEvent,
  TabSyncEvent,
  TabSyncEventType,
  TabSyncHub,
} from './types';
