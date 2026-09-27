// Unit + integration tests for src/lib/persistence/repository.ts.
// Single-tab behaviors (autosave coalescing, flush/dispose, onChange, sorted
// cache) run against the memory driver — the layer's own fake. The multi-tab
// integration tests wire TWO repositories over ONE fake-indexeddb database
// with the REAL BroadcastChannel and the in-process lock adapter: edit-in-A
// appears in B, readonly sessions cannot write, a steal preserves the loser's
// dirty buffer as a copy, focus reconciliation picks up missed changes, and
// revisions climb monotonically across tabs.

import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIndexedDbDriver } from './indexeddb-driver';
import { createMemoryDriver } from './memory-driver';
import { createDocumentRepository } from './repository';
import { createInProcessLockAdapter, createTabSyncHub } from './sync';
import type {
  DocumentLockAdapter,
  DocumentRecord,
  DocumentRepository,
  RepositoryChangeEvent,
  TabSyncHub,
} from './types';

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Fake ONLY the autosave timers. The default toFake list also captures
 * setImmediate, which fake-indexeddb uses to schedule transaction callbacks —
 * faking it would leave every IndexedDB operation pending forever.
 */
function useDebounceTimers(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
}

function makeClock(): { now: () => number } {
  let tick = 1000;
  return { now: () => tick };
}

/** A memory driver with call counters — real behavior, observable boundary. */
function instrumentDriver() {
  const memory = createMemoryDriver();
  const calls = { puts: 0, closed: false };
  const driver = {
    ...memory,
    async put(doc: DocumentRecord) {
      calls.puts += 1;
      await memory.put(doc);
    },
    async close() {
      calls.closed = true;
      await memory.close();
    },
  };
  return { driver, memory, calls };
}

function makeIds(...ids: string[]): () => string {
  const queue = [...ids];
  return () => queue.shift() ?? 'extra-id';
}

interface RepoOptions {
  debounceMs?: number;
  hub?: TabSyncHub;
  locks?: DocumentLockAdapter;
  focusTarget?: EventTarget;
}

async function makeRepository(
  overrides: RepoOptions = {},
): Promise<{
  repo: DocumentRepository;
  memory: ReturnType<typeof instrumentDriver>['memory'];
  calls: ReturnType<typeof instrumentDriver>['calls'];
}> {
  const { driver, memory, calls } = instrumentDriver();
  const repo = createDocumentRepository(driver, {
    idFactory: makeIds('doc-1', 'doc-2', 'doc-3', 'doc-4'),
    now: makeClock().now,
    ...overrides,
  });
  await repo.init();
  return { repo, memory, calls };
}

/** Two repositories over one fake-indexeddb database + one lock adapter. */
async function makeTwoTabs(options: { closeHubB?: boolean; focusB?: EventTarget } = {}) {
  const factory = new IDBFactory();
  const locks = createInProcessLockAdapter();
  const hubA = createTabSyncHub('tabs-test');
  const hubB = createTabSyncHub('tabs-test');
  if (options.closeHubB) hubB.close();
  let idCounter = 0;
  const nextId = (): string => {
    idCounter += 1;
    return `doc-${idCounter}`;
  };

  const mkRepo = async (hub: TabSyncHub | undefined, focusTarget?: EventTarget) => {
    const driver = createIndexedDbDriver({ factory, dbName: 'tabs' });
    const repo = createDocumentRepository(driver, {
      idFactory: nextId,
      now: makeClock().now,
      locks,
      ...(hub ? { hub } : {}),
      ...(focusTarget ? { focusTarget } : {}),
    });
    await repo.init();
    return repo;
  };

  const tabA = await mkRepo(hubA);
  const tabB = await mkRepo(hubB, options.focusB);
  return { tabA, tabB, hubA, hubB };
}

describe('createDocumentRepository (single tab)', () => {
  it('creates documents at max sortIndex + 1 with injected id and timestamps', async () => {
    const { repo } = await makeRepository();

    const first = await repo.create({ name: 'First', content: 'a' });
    const second = await repo.create({ name: 'Second', content: 'b' });

    expect(first).toMatchObject({ id: 'doc-1', sortIndex: 1, revision: 1 });
    expect(second).toMatchObject({ id: 'doc-2', sortIndex: 2, revision: 1 });
    expect(await repo.list()).toEqual([first, second]);
  });

  it('carries source metadata through to storage', async () => {
    const { repo } = await makeRepository();

    const doc = await repo.create({
      name: 'From URL',
      content: '',
      source: { kind: 'url', url: 'https://example.com/a.md' },
    });

    expect(doc.source).toEqual({ kind: 'url', url: 'https://example.com/a.md' });
  });

  it('persists renames to the driver', async () => {
    const { repo } = await makeRepository();
    const doc = await repo.create({ name: 'Before', content: '' });

    await repo.rename(doc.id, 'After');

    expect(await repo.get(doc.id)).toMatchObject({ name: 'After' });
  });

  it('removes documents from cache and storage', async () => {
    const { repo } = await makeRepository();
    const doc = await repo.create({ name: 'Doomed', content: '' });

    await repo.remove(doc.id);

    expect(await repo.get(doc.id)).toBeNull();
    expect(await repo.list()).toEqual([]);
  });

  it('reorders persist: list follows the given id order', async () => {
    const { repo } = await makeRepository();
    const a = await repo.create({ name: 'A', content: '' });
    const b = await repo.create({ name: 'B', content: '' });
    const c = await repo.create({ name: 'C', content: '' });

    await repo.reorder([c.id, a.id, b.id]);

    expect((await repo.list()).map((d) => d.id)).toEqual([c.id, a.id, b.id]);
  });

  it('reflects saveContent in the cache immediately, before the debounce', async () => {
    useDebounceTimers();
    const { repo } = await makeRepository();
    const doc = await repo.create({ name: 'Notes', content: '' });

    repo.saveContent(doc.id, '# typed');

    expect(await repo.get(doc.id)).toMatchObject({ content: '# typed' });
  });

  it('coalesces three rapid saveContent calls into one driver put', async () => {
    useDebounceTimers();
    const { repo, calls } = await makeRepository();
    const doc = await repo.create({ name: 'Notes', content: '' });
    const putsAfterCreate = calls.puts;

    repo.saveContent(doc.id, 'one');
    repo.saveContent(doc.id, 'two');
    repo.saveContent(doc.id, 'three');
    expect(calls.puts).toBe(putsAfterCreate);

    await vi.advanceTimersByTimeAsync(400);

    expect(calls.puts).toBe(putsAfterCreate + 1);
    expect(await repo.get(doc.id)).toMatchObject({ content: 'three' });
  });

  it('flush writes pending changes immediately', async () => {
    useDebounceTimers();
    const { repo, calls } = await makeRepository();
    const doc = await repo.create({ name: 'Notes', content: '' });
    const putsAfterCreate = calls.puts;

    repo.saveContent(doc.id, 'flushed');
    await repo.flush();

    expect(calls.puts).toBe(putsAfterCreate + 1);
    expect(await repo.get(doc.id)).toMatchObject({ content: 'flushed' });
  });

  it('dispose flushes pending changes and closes the driver', async () => {
    useDebounceTimers();
    const { repo, memory, calls } = await makeRepository();
    const doc = await repo.create({ name: 'Notes', content: '' });

    repo.saveContent(doc.id, 'survives dispose');
    await repo.dispose();

    expect(calls.closed).toBe(true);
    expect(await memory.get(doc.id)).toMatchObject({ content: 'survives dispose' });
  });

  it('notifies onChange after each committed mutation, and stops after unsubscribe', async () => {
    const { repo } = await makeRepository();
    const events: RepositoryChangeEvent[] = [];
    const unsubscribe = repo.onChange((event) => events.push(event));

    const doc = await repo.create({ name: 'A', content: '' });
    repo.saveContent(doc.id, 'typed');
    await repo.flush();
    await repo.reorder([doc.id]);
    unsubscribe();
    await repo.remove(doc.id);

    expect(events.map((e) => e.type)).toEqual(['created', 'updated', 'reordered']);
    expect(events.every((e) => !e.remote)).toBe(true);
  });

  it('saveContent is a no-op returning false for unknown documents', async () => {
    const { repo } = await makeRepository();

    expect(repo.saveContent('missing', 'x')).toBe(false);
  });

  it('rejects operations after dispose', async () => {
    const { repo } = await makeRepository();
    await repo.dispose();

    expect(() => repo.saveContent('doc-1', 'x')).toThrow();
    await expect(repo.list()).rejects.toMatchObject({ code: 'unknown' });
  });
});

describe('createDocumentRepository (sessions + locks)', () => {
  it('grants an edit session when the lock is free, and saves inside it', async () => {
    useDebounceTimers();
    const locks = createInProcessLockAdapter();
    const { repo } = await makeRepository({ locks });
    const doc = await repo.create({ name: 'Notes', content: '' });

    const session = await repo.openDocument(doc.id);

    expect(session.mode).toBe('edit');
    expect(repo.saveContent(doc.id, 'editing')).toBe(true);
    await vi.advanceTimersByTimeAsync(400);
    expect(await repo.get(doc.id)).toMatchObject({ content: 'editing' });
    session.release();
  });

  it('marks a session readonly and rejects its saves when another tab holds the lock', async () => {
    const locks = createInProcessLockAdapter();
    const { driver } = instrumentDriver();
    const mkRepo = async (id: string) => {
      const repo = createDocumentRepository(driver, {
        idFactory: makeIds(id),
        now: makeClock().now,
        locks,
      });
      await repo.init();
      return repo;
    };
    const tabA = await mkRepo('doc-1');
    const tabB = await mkRepo('doc-2');
    const doc = await tabA.create({ name: 'Notes', content: '' });

    const sessionA = await tabA.openDocument(doc.id);
    const sessionB = await tabB.openDocument(doc.id);

    expect(sessionA.mode).toBe('edit');
    expect(sessionB.mode).toBe('readonly');
    expect(tabB.saveContent(doc.id, 'clobber attempt')).toBe(false);
    expect(await tabA.get(doc.id)).toMatchObject({ content: '' });

    sessionA.release();
    const againB = await tabB.openDocument(doc.id);
    expect(againB.mode).toBe('edit');
    againB.release();
  });

  it('takeover steals the lock and flips the session to edit', async () => {
    useDebounceTimers();
    const locks = createInProcessLockAdapter();
    const { driver } = instrumentDriver();
    const mkRepo = async (id: string) => {
      const repo = createDocumentRepository(driver, {
        idFactory: makeIds(id),
        now: makeClock().now,
        locks,
      });
      await repo.init();
      return repo;
    };
    const tabA = await mkRepo('doc-1');
    const tabB = await mkRepo('doc-2');
    const doc = await tabA.create({ name: 'Notes', content: '' });
    const sessionA = await tabA.openDocument(doc.id);
    const sessionB = await tabB.openDocument(doc.id);
    expect(sessionB.mode).toBe('readonly');

    await expect(sessionB.takeover()).resolves.toBe('edit');

    expect(sessionB.mode).toBe('edit');
    expect(tabB.saveContent(doc.id, 'mine now')).toBe(true);
    await vi.advanceTimersByTimeAsync(400);
    expect(await tabB.get(doc.id)).toMatchObject({ content: 'mine now' });
    sessionA.release();
    sessionB.release();
  });

  it('on steal, the stolen tab’s dirty buffer survives as a "(copy)" record and the session flips readonly', async () => {
    useDebounceTimers();
    const locks = createInProcessLockAdapter();
    const { driver } = instrumentDriver();
    const mkRepo = async (ids: string[]) => {
      const repo = createDocumentRepository(driver, {
        idFactory: makeIds(...ids),
        now: makeClock().now,
        locks,
      });
      await repo.init();
      return repo;
    };
    const tabA = await mkRepo(['doc-1', 'doc-3', 'doc-5']);
    const tabB = await mkRepo(['doc-2', 'doc-4']);
    const doc = await tabA.create({ name: 'Essay', content: '' });
    const sessionA = await tabA.openDocument(doc.id);
    tabA.saveContent(doc.id, 'half-typed draft');
    const sessionB = await tabB.openDocument(doc.id);

    const stolenEvents: { type: string; copyId: string | null }[] = [];
    sessionA.onEvent((event) => stolenEvents.push(event));
    await sessionB.takeover();
    await vi.advanceTimersByTimeAsync(400); // let the copy creation land

    expect(sessionA.mode).toBe('readonly');
    expect(stolenEvents).toHaveLength(1);
    const copyId = stolenEvents[0]?.copyId;
    expect(copyId).toBeTruthy();
    expect(await tabA.get(copyId as string)).toMatchObject({
      name: 'Essay (copy)',
      content: 'half-typed draft',
    });
    expect(tabA.saveContent(doc.id, 'ignored')).toBe(false);

    sessionB.release();
  });
});

describe('createDocumentRepository (two tabs, one database)', () => {
  it('shows an edit made in tab A in tab B through a remote onChange event', async () => {
    useDebounceTimers();
    const { tabA, tabB } = await makeTwoTabs();
    const doc = await tabA.create({ name: 'Shared', content: '' });
    const events: RepositoryChangeEvent[] = [];
    tabB.onChange((event) => events.push(event));

    const session = await tabA.openDocument(doc.id);
    tabA.saveContent(doc.id, 'from tab A');
    await vi.advanceTimersByTimeAsync(400);
    await vi.waitFor(() => {
      expect(events).toContainEqual(expect.objectContaining({ type: 'updated', remote: true }));
    });

    expect(await tabB.get(doc.id)).toMatchObject({ content: 'from tab A' });
    const remoteEvent = events.find((e) => e.remote);
    expect(remoteEvent?.ids).toContain(doc.id);
    session.release();
  });

  it('reconciles missed remote changes on focus as a backstop', async () => {
    useDebounceTimers();
    const focusB = new EventTarget();
    const { tabA, tabB, hubB } = await makeTwoTabs({ closeHubB: true, focusB });
    const events: RepositoryChangeEvent[] = [];
    tabB.onChange((event) => events.push(event));

    // Tab A changes the document; tab B's hub is closed, so the broadcast is lost.
    const doc = await tabA.create({ name: 'Lost in transit', content: '' });
    const session = await tabA.openDocument(doc.id);
    tabA.saveContent(doc.id, 'delivered by reconcile');
    await vi.advanceTimersByTimeAsync(400);
    expect(events).toEqual([]); // nothing arrived while the hub was closed

    focusB.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => {
      expect(events).toContainEqual(expect.objectContaining({ type: 'reconciled', remote: true }));
    });

    expect(await tabB.get(doc.id)).toMatchObject({ content: 'delivered by reconcile' });
    session.release();
  });

  it('bumps revision monotonically as edits alternate across tabs', async () => {
    useDebounceTimers();
    const { tabA, tabB } = await makeTwoTabs();
    const doc = await tabA.create({ name: 'Ping pong', content: '' });
    expect(await tabA.get(doc.id)).toMatchObject({ revision: 1 });

    // A commits 'A1' → revision 2.
    const sessionA1 = await tabA.openDocument(doc.id);
    tabA.saveContent(doc.id, 'A1');
    await vi.waitFor(async () => {
      await expect(tabA.get(doc.id)).resolves.toMatchObject({ content: 'A1', revision: 2 });
    });
    sessionA1.release();

    // B commits 'B1' on top of A's revision → 3, whatever its cache freshness
    // was at save time (the driver bumps from the STORED record).
    const sessionB = await tabB.openDocument(doc.id);
    tabB.saveContent(doc.id, 'B1');
    await vi.waitFor(async () => {
      await expect(tabB.get(doc.id)).resolves.toMatchObject({ content: 'B1', revision: 3 });
    });
    sessionB.release();

    // A commits 'A2' on top of B's revision → 4.
    const sessionA2 = await tabA.openDocument(doc.id);
    tabA.saveContent(doc.id, 'A2');
    await vi.waitFor(async () => {
      await expect(tabA.get(doc.id)).resolves.toMatchObject({ content: 'A2', revision: 4 });
    });
    sessionA2.release();

    expect(await tabA.get(doc.id)).toMatchObject({ revision: 4, content: 'A2' });
  });
});
