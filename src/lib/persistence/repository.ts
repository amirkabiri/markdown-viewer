// Module: lib/persistence/repository — createDocumentRepository, the API the
// UI consumes on top of a PersistenceDriver. Owns the autosave pipeline
// (saveContent mutates the cache immediately and coalesces puts behind a
// trailing debounce — default 400ms; flush/dispose write through; failed
// timer commits return to the dirty set and retry on the next save/flush),
// the sorted document cache (sortIndex, then updatedAt; new docs append at
// max+1), and the change fan-out (onChange fires after every COMMITTED
// mutation — created, removed, updated, reordered, reconciled — with
// remote:true marking changes that arrived from another tab).
//
// Multi-tab (v2): with a TabSyncHub wired in, local mutations broadcast and
// incoming events refresh the cache (dirty buffers survive the refresh —
// pending edits are never reverted by a remote event). With a
// DocumentLockAdapter wired in, openDocument grants an exclusive per-document
// session: 'edit' while this tab holds the lock, 'readonly' otherwise, and
// saveContent is a no-op (returns false) for readonly sessions. When a session
// lock is STOLEN by another tab, the dirty buffer is preserved as a
// "<name> (copy)" record — text is never lost — the session flips readonly
// and emits its terminal { type: 'stolen', copyId } event. Window focus and
// visibilitychange reconcile the cache as a backstop for missed broadcasts.
// An edit session holds its lock for its lifetime, so every debounced save
// inside it runs under the lock; saves without any session are the v1
// single-tab path (unlocked — pair them with openDocument for cross-tab
// safety). Unknown ids are handled defensively: saveContent returns false,
// rename/remove no-op (a remote removal may race any local call).
//
// The repository is single-use: after dispose() every method throws.

import type {
  DocumentRecord,
  DocumentRepository,
  DocumentRepositoryOptions,
  DocumentSession,
  PersistenceDriver,
  RepositoryChangeEvent,
  RepositoryChangeType,
  SessionEvent,
  TabSyncEventType,
} from './types';
import { PersistenceError } from './types';

const DEFAULT_DEBOUNCE_MS = 400;

const randomId = (): string => crypto.randomUUID();

/** True when two record lists carry identical documents. */
function sameDocuments(a: DocumentRecord[], b: DocumentRecord[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((record, index) => JSON.stringify(record) === JSON.stringify(b[index]));
}

interface SessionState {
  session: DocumentSession;
  /** The record as observed at open time — saveContent's fallback base. */
  record: DocumentRecord;
  mode: 'edit' | 'readonly';
  release: () => void;
  listeners: Set<(event: SessionEvent) => void>;
}

export default function createDocumentRepository(
  driver: PersistenceDriver,
  opts: DocumentRepositoryOptions = {},
): DocumentRepository {
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const idFactory = opts.idFactory ?? randomId;
  const now = opts.now ?? ((): number => Date.now());
  const hub = opts.hub ?? null;
  const locks = opts.locks ?? null;

  let disposed = false;
  let initialized = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const cache = new Map<string, DocumentRecord>();
  const dirty = new Map<string, DocumentRecord>(); // id → pending record snapshot
  const listeners = new Set<(event: RepositoryChangeEvent) => void>();
  const sessions = new Map<string, SessionState>();
  const focusController = new AbortController();

  const assertUsable = (): void => {
    if (disposed) throw new PersistenceError('unknown', 'repository is disposed');
    if (!initialized) throw new PersistenceError('unknown', 'repository is not initialized');
  };

  /* ---------------- cache + change fan-out ---------------- */

  const sortedSnapshot = (): DocumentRecord[] => [...cache.values()]
    .sort((a, b) => a.sortIndex - b.sortIndex || a.updatedAt - b.updatedAt)
    .map((record) => ({ ...record }));

  const notify = (type: RepositoryChangeType, ids: string[], remote: boolean): void => {
    listeners.forEach((listener) => listener({ type, ids, remote }));
  };

  /** Rebuild the cache from the driver, keeping uncommitted local edits on top. */
  const refreshCache = async (): Promise<void> => {
    const all = await driver.list();
    cache.clear();
    all.forEach((record) => cache.set(record.id, record));
    dirty.forEach((pending, id) => cache.set(id, pending));
  };

  /** Read-through: trust the cache unless the id is unknown to it. */
  const resolveRecord = async (id: string): Promise<DocumentRecord | null> => {
    const cached = cache.get(id);
    if (cached) return cached;
    return driver.get(id);
  };

  /** Cache-sync after a committed put: adopt the driver's stored revision. */
  const adoptStored = async (id: string): Promise<void> => {
    const stored = await driver.get(id);
    if (stored) cache.set(id, stored);
  };

  /* ---------------- autosave pipeline ---------------- */

  const commitDirty = async (): Promise<void> => {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    const pending = [...dirty.entries()];
    if (pending.length === 0) return;
    dirty.clear();

    try {
      await Promise.all(pending.map(([, record]) => driver.put({ ...record })));
      await Promise.all(pending.map(([id]) => adoptStored(id)));
    } catch (err) {
      pending.forEach(([id, record]) => dirty.set(id, record));
      throw err;
    }

    const ids = pending.map(([id]) => id);
    if (hub) {
      hub.broadcast({ type: 'updated', ids, revision: cache.get(ids[0])?.revision });
    }
    notify('updated', ids, false);
  };

  /** Timer-path failures re-enter the dirty set; the next save/flush retries. */
  const swallowCommitError = (): void => {};

  const scheduleCommit = (): void => {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      commitDirty().catch(swallowCommitError);
    }, debounceMs);
  };

  /* ---------------- remote changes + reconciliation ---------------- */

  const applyRemote = async (type: TabSyncEventType, ids: string[]): Promise<void> => {
    await refreshCache();
    notify(type, ids, true);
  };

  const reconcile = async (): Promise<void> => {
    const before = sortedSnapshot();
    await refreshCache();
    const after = sortedSnapshot();
    if (sameDocuments(before, after)) return;
    const changedIds = after
      .filter((record, index) => JSON.stringify(record) !== JSON.stringify(before[index]))
      .map((record) => record.id);
    notify('reconciled', changedIds, true);
  };

  const runReconcile = (): void => {
    reconcile().catch(swallowCommitError);
  };

  const attachFocusBackstop = (): void => {
    const target =
      opts.focusTarget ?? (globalThis as { window?: EventTarget }).window;
    if (!target) return;
    const { signal } = focusController;
    target.addEventListener('focus', runReconcile, { signal });
    target.addEventListener('visibilitychange', () => {
      const doc = (globalThis as { document?: { visibilityState?: string } }).document;
      if (doc?.visibilityState === 'hidden') return;
      runReconcile();
    }, { signal });
  };

  /* ---------------- the repository ---------------- */

  // Assigned after the repo object exists (the handler needs repo.create to
  // preserve the dirty buffer as a copy record).
  let onLockLost: (id: string) => void = () => {};

  const repo: DocumentRepository = {
    async init() {
      if (disposed) throw new PersistenceError('unknown', 'repository is disposed');
      await driver.init();
      await refreshCache();
      initialized = true;
      attachFocusBackstop();
      if (hub) {
        hub.subscribe((event) => {
          applyRemote(event.type, event.ids).catch(swallowCommitError);
        });
      }
    },

    async list() {
      assertUsable();
      return sortedSnapshot();
    },

    async get(id) {
      assertUsable();
      const found = await resolveRecord(id);
      return found ? { ...found } : null;
    },

    async create(input) {
      assertUsable();
      const maxSort = [...cache.values()].reduce((max, r) => Math.max(max, r.sortIndex), 0);
      const record: DocumentRecord = {
        id: idFactory(),
        name: input.name,
        content: input.content,
        createdAt: now(),
        updatedAt: now(),
        sortIndex: maxSort + 1,
        revision: 0,
        ...(input.source ? { source: input.source } : {}),
      };
      await driver.put({ ...record });
      await adoptStored(record.id);
      if (hub) hub.broadcast({ type: 'created', ids: [record.id] });
      notify('created', [record.id], false);
      const stored = await driver.get(record.id);
      return stored ? { ...stored } : { ...record };
    },

    async remove(id) {
      assertUsable();
      sessions.get(id)?.release();
      dirty.delete(id);
      await driver.delete(id);
      cache.delete(id);
      if (hub) hub.broadcast({ type: 'removed', ids: [id] });
      notify('removed', [id], false);
    },

    async rename(id, name) {
      assertUsable();
      const record = await resolveRecord(id);
      if (!record) return; // removed remotely mid-rename — nothing to do
      await driver.put({ ...record, name, updatedAt: now() });
      await adoptStored(id);
      if (hub) hub.broadcast({ type: 'updated', ids: [id], revision: cache.get(id)?.revision });
      notify('updated', [id], false);
    },

    async reorder(orderedIds) {
      assertUsable();
      const known = orderedIds.filter((id) => cache.has(id));
      await driver.reorder(known);
      known.forEach((id, index) => {
        const record = cache.get(id);
        if (record) cache.set(id, { ...record, sortIndex: index });
      });
      if (hub) hub.broadcast({ type: 'reordered', ids: known });
      notify('reordered', known, false);
    },

    saveContent(id, content) {
      assertUsable();
      const session = sessions.get(id);
      if (session && session.mode === 'readonly') return false;

      // A session proves this tab knows the document even when the shared
      // cache has not been refreshed since it was created in another tab.
      const record = cache.get(id) ?? session?.record;
      if (!record) return false; // unknown or removed — nothing to save

      const updated = { ...record, content, updatedAt: now() };
      dirty.set(id, updated);
      cache.set(id, updated);
      scheduleCommit();
      return true;
    },

    async flush() {
      assertUsable();
      await commitDirty();
    },

    async dispose() {
      if (disposed) return;
      disposed = true;
      focusController.abort();
      if (initialized) await commitDirty().catch(swallowCommitError);
      dirty.clear();
      sessions.forEach((state) => state.release());
      sessions.clear();
      hub?.close();
      await driver.close();
    },

    onChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },

    async openDocument(id) {
      assertUsable();
      const record = await resolveRecord(id);
      if (!record) throw new PersistenceError('unknown', `document not found: ${id}`);

      const acquisition = locks
        ? await locks.acquire(id, { ifAvailable: true, onLost: () => onLockLost(id) })
        : { held: true, release: () => {} };

      const state: SessionState = {
        session: null as unknown as DocumentSession,
        record: { ...record },
        mode: acquisition.held ? 'edit' : 'readonly',
        release: acquisition.held ? acquisition.release : () => {},
        listeners: new Set(),
      };
      const session: DocumentSession = {
        id,
        record: { ...record },
        get mode() {
          return state.mode;
        },
        release(): void {
          state.release();
          sessions.delete(id);
        },
        async takeover() {
          if (state.mode === 'edit') return 'edit';
          const stolen = locks ? await locks.steal(id) : { held: true, release: () => {} };
          state.mode = 'edit';
          state.release = stolen.release;
          return 'edit';
        },
        onEvent(cb) {
          state.listeners.add(cb);
          return () => {
            state.listeners.delete(cb);
          };
        },
      };
      state.session = session;
      sessions.set(id, state);
      return session;
    },
  };

  /** Lock lost to another tab: preserve the dirty buffer, flip readonly, emit. */
  function stealPreserveBuffer(id: string): Promise<void> {
    const state = sessions.get(id);
    if (!state) return Promise.resolve();
    let copyId: string | null = null;
    const pending = dirty.get(id);
    if (pending) {
      dirty.delete(id);
      return repo
        .create({ name: `${pending.name} (copy)`, content: pending.content })
        .then((copy) => {
          copyId = copy.id;
        })
        .then(() => {
          const current = sessions.get(id);
          if (!current) return;
          current.mode = 'readonly';
          current.release = () => {};
          current.listeners.forEach((listener) => listener({ type: 'stolen', copyId }));
        });
    }
    state.mode = 'readonly';
    state.release = () => {};
    state.listeners.forEach((listener) => listener({ type: 'stolen', copyId }));
    return Promise.resolve();
  }

  // Fired by the lock adapter when another tab steals a lock we held.
  onLockLost = (id: string): void => {
    const state = sessions.get(id);
    if (!state || state.mode !== 'edit') return;
    stealPreserveBuffer(id).catch(swallowCommitError);
  };

  return repo;
}
