// Module: lib/persistence/types — the FROZEN public persistence contract (v2,
// multi-tab amendment). The UI consumes createDocumentRepository + these types
// exclusively; drivers are swappable behind PersistenceDriver (IndexedDB now,
// browser File System Access later — see FILE_SYSTEM_ACCESS.md in this folder).
// Dependency-free and DOM-free: the only environment touchpoints (IDBFactory,
// BroadcastChannel, Web Locks, timers, the clock and the id source) are all
// injectable, so the whole layer runs in the node test project.
//
// v2 (multi-tab safety): DocumentRecord carries a `revision` that the DRIVER
// bumps atomically on every put — the single place where cross-tab conflict
// detection lives. Sessions, locks and change broadcasting are described in
// sync.ts and repository.ts.

/** Where a document originally came from. */
export interface DocumentSource {
  kind: 'local' | 'url' | 'file' | 'share';
  url?: string;
}

/** A stored document. `revision` starts at 0 and is bumped by the driver on every put. */
export interface DocumentRecord {
  id: string; // crypto.randomUUID() or injected idFactory
  name: string;
  content: string;
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
  sortIndex: number; // manual ordering
  revision: number; // driver-managed, monotonically increasing per record
  source?: DocumentSource;
}

export type DriverName = 'indexeddb' | 'memory';

/**
 * The storage boundary. Implementations must be safe under concurrent tabs:
 * put/delete/reorder run as single atomic transactions and put() bumps
 * `revision` from the STORED record (not the incoming one), so a stale tab can
 * never silently overwrite a newer revision without the bump exposing it.
 */
export interface PersistenceDriver {
  readonly name: DriverName;
  init(): Promise<void>;
  list(): Promise<DocumentRecord[]>; // ordered by sortIndex, then updatedAt
  get(id: string): Promise<DocumentRecord | null>;
  put(doc: DocumentRecord): Promise<void>; // upsert; bumps revision atomically
  delete(id: string): Promise<void>;
  reorder(orderedIds: string[]): Promise<void>; // persist sortIndex order
  close(): Promise<void>;
}

/** Codes for PersistenceError — typed init/mutation failures, never bare strings. */
export type PersistenceErrorCode =
  | 'blocked' // another tab holds an older/newer DB version open
  | 'upgrade-failed' // the schema upgrade itself threw
  | 'open-failed' // open rejected for any other reason (storage disabled, version mismatch)
  | 'permission' // (future FSA driver) directory access denied
  | 'unknown';

/** Typed persistence failure. `cause` carries the underlying error when any. */
export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;

  constructor(code: PersistenceErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PersistenceError';
    this.code = code;
  }
}

/** What changed, for repository-level change events. */
export type RepositoryChangeType =
  | 'created'
  | 'removed'
  | 'updated' // rename, flushed save
  | 'reordered'
  | 'reconciled'; // focus backstop picked up missed remote changes

/** Payload handed to repository onChange subscribers. */
export interface RepositoryChangeEvent {
  type: RepositoryChangeType;
  ids: string[];
  /** True when the change originated outside this tab (broadcast or reconciliation). */
  remote: boolean;
}

/** An editing session over one document, opened via repository.openDocument(). */
export interface DocumentSession {
  readonly id: string;
  /** The record as observed when the session opened (fresh reads via repository.get). */
  readonly record: DocumentRecord;
  /** 'edit' only while this tab holds the document lock. */
  readonly mode: 'edit' | 'readonly';
  /** Release the lock and end the session. */
  release(): void;
  /** Steal the lock from whoever holds it; on success the session flips to 'edit'. */
  takeover(): Promise<'edit'>;
  /** Terminal session events — currently only { type: 'stolen', copyId }. */
  onEvent(cb: (event: SessionEvent) => void): () => void;
}

/** Terminal session events. 'stolen' always carries the preserved copy's id. */
export type SessionEvent = { type: 'stolen'; copyId: string };

/** Options for createDocumentRepository — everything injectable for tests. */
export interface DocumentRepositoryOptions {
  /** Autosave debounce window in ms (trailing). Default 400. */
  debounceMs?: number;
  /** Document id source. Default () => crypto.randomUUID(). */
  idFactory?: () => string;
  /** Clock for createdAt/updatedAt stamps. Default () => Date.now(). */
  now?: () => number;
  /** Multi-tab change hub (see sync.ts). Absent → no broadcasting/listening. */
  hub?: TabSyncHub;
  /** Document lock source (see sync.ts). Absent → saves are unlocked (single tab). */
  locks?: DocumentLockAdapter;
  /** Event target observed for focus reconciliation. Default globalThis.window. */
  focusTarget?: EventTarget;
}

/** The repository API the UI consumes — created via createDocumentRepository(). */
export interface DocumentRepository {
  init(): Promise<void>;
  list(): Promise<DocumentRecord[]>;
  get(id: string): Promise<DocumentRecord | null>;
  create(input: { name: string; content: string; source?: DocumentSource }): Promise<DocumentRecord>;
  remove(id: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  reorder(orderedIds: string[]): Promise<void>;
  /**
   * THE autosave entry point: cache updates immediately, the put is debounced.
   * Returns false (no-op) when the document is locked by another tab's
   * 'edit' session (i.e. this tab holds it 'readonly'); unowned documents save
   * through a short ifAvailable lock so a stray write cannot clobber a peer.
   */
  saveContent(id: string, content: string): boolean;
  /** Write every pending debounced change now (also invoked by the debounce). */
  flush(): Promise<void>;
  /** flush() + driver.close(). The repository is single-use after this. */
  dispose(): Promise<void>;
  /** Notified after every committed mutation, local or remote. */
  onChange(cb: (event: RepositoryChangeEvent) => void): () => void;
  /** Open a locked editing session (readonly when another tab holds the lock). */
  openDocument(id: string): Promise<DocumentSession>;
}

/* ---------------- multi-tab sync (implemented in sync.ts) ---------------- */

export type TabSyncEventType = 'created' | 'updated' | 'removed' | 'reordered';

/** Broadcast payload for cross-tab document changes. */
export interface TabSyncEvent {
  type: TabSyncEventType;
  ids: string[];
  /** Stored revision after the change ('updated' events). */
  revision?: number;
  /** clientId of the emitting tab — receivers ignore their own. */
  from: string;
}

/** BroadcastChannel wrapper: per-tab clientId, echo-suppressed fan-out. */
export interface TabSyncHub {
  readonly clientId: string;
  broadcast(event: Omit<TabSyncEvent, 'from'>): void;
  subscribe(cb: (event: TabSyncEvent) => void): () => void;
  close(): void;
}

/** Result of a lock acquisition attempt. */
export interface LockAcquisition {
  /** True when this caller holds the lock. */
  held: boolean;
  /** Release the lock — no-op when not held. */
  release(): void;
}

/**
 * Document lock boundary (Web Locks in the browser; faked in node). A held
 * lock must be observable as lost (another tab stole it): `onLost` fires at
 * most once per acquisition, after which the handle is inert.
 */
export interface DocumentLockAdapter {
  acquire(
    id: string,
    opts?: { ifAvailable?: boolean; onLost?: () => void },
  ): Promise<LockAcquisition>;
  /** Forcibly take the lock from any holder (Web Locks { steal: true }). */
  steal(id: string): Promise<void>;
}
