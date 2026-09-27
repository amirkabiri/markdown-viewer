// Unit tests for src/lib/persistence/indexeddb-driver.ts — run against
// fake-indexeddb (real IndexedDB semantics, node-safe) through the injectable
// IDBFactory, plus a hand-rolled scripted factory for the open-failure paths
// that are awkward to stage against a real database (house style: fakes at
// module boundaries, see TESTING.md). The behaviors that matter: persistence
// across reopen (new driver instance, same database), ordering, atomic
// revision bumps, and typed init errors (blocked / upgrade-failed /
// open-failed).

import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createIndexedDbDriver } from './indexeddb-driver';
import type { DocumentRecord } from './types';
import type { IndexedDbDriverOptions } from './indexeddb-driver';

let nextId = 0;

function makeRecord(over: Partial<DocumentRecord> = {}): DocumentRecord {
  nextId += 1;
  return {
    id: `doc-${nextId}`,
    name: `Doc ${nextId}`,
    content: '',
    createdAt: 1000,
    updatedAt: 1000,
    sortIndex: nextId,
    revision: 0,
    ...over,
  };
}

/** A driver bound to a fresh, isolated fake database. */
function makeDriver(over: IndexedDbDriverOptions = {}) {
  const factory = new IDBFactory();
  const driver = createIndexedDbDriver({ dbName: 'test-db', factory, ...over });
  return { factory, driver };
}

/** Opens the raw database (staying connected) and resolves once ready. */
function openRaw(factory: IDBFactory, name: string, version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* A scripted IDBOpenDBRequest: the driver assigns its handlers as writable
   fields during init(); a test then fires exactly one of them. Only the
   members the driver touches exist — the cast at the factory boundary keeps
   this honest about being a boundary fake. */
interface ScriptedOpenRequest {
  onupgradeneeded: (() => void) | null;
  onblocked: (() => void) | null;
  onerror: (() => void) | null;
  onsuccess: (() => void) | null;
  error: DOMException | null;
  readyState: IDBRequestReadyState;
  result: IDBDatabase | null;
}

function scriptedFactory(): { factory: IDBFactory; request: ScriptedOpenRequest } {
  const request: ScriptedOpenRequest = {
    onupgradeneeded: null,
    onblocked: null,
    onerror: null,
    onsuccess: null,
    error: null,
    readyState: 'pending',
    result: null,
  };
  const factory = {
    open: () => request as unknown as IDBOpenDBRequest,
  } as unknown as IDBFactory;
  return { factory, request };
}

describe('createIndexedDbDriver', () => {
  it('persists documents across reopen with the same database', async () => {
    const { factory, driver } = makeDriver();
    await driver.init();
    const doc = makeRecord({ name: 'Survivor', content: '# kept' });
    await driver.put(doc);
    await driver.close();

    const reopened = createIndexedDbDriver({ dbName: 'test-db', factory });
    await reopened.init();

    await expect(reopened.get(doc.id)).resolves.toMatchObject({
      name: 'Survivor',
      content: '# kept',
    });
  });

  it('lists documents ordered by sortIndex, then updatedAt', async () => {
    const { driver } = makeDriver();
    await driver.init();
    await driver.put(makeRecord({ id: 'b', sortIndex: 2, updatedAt: 100 }));
    await driver.put(makeRecord({ id: 'a', sortIndex: 1, updatedAt: 500 }));
    await driver.put(makeRecord({ id: 'd', sortIndex: 2, updatedAt: 50 }));

    const ids = (await driver.list()).map((d) => d.id);

    expect(ids).toEqual(['a', 'd', 'b']);
  });

  it('bumps revision from the stored record on every put, so stale copies cannot reset it', async () => {
    const { driver } = makeDriver();
    await driver.init();
    const doc = makeRecord({ revision: 0 });

    await driver.put(doc);
    await driver.put(doc); // same stale object again

    await expect(driver.get(doc.id)).resolves.toMatchObject({ revision: 2 });
  });

  it('deletes a document', async () => {
    const { driver } = makeDriver();
    await driver.init();
    const doc = makeRecord();
    await driver.put(doc);

    await driver.delete(doc.id);

    await expect(driver.get(doc.id)).resolves.toBeNull();
  });

  it('persists a reorder across reopen', async () => {
    const { factory, driver } = makeDriver();
    await driver.init();
    const first = makeRecord({ id: 'first' });
    const second = makeRecord({ id: 'second' });
    await driver.put(first);
    await driver.put(second);

    await driver.reorder([second.id, first.id]);
    await driver.close();

    const reopened = createIndexedDbDriver({ dbName: 'test-db', factory });
    await reopened.init();

    const ids = (await reopened.list()).map((d) => d.id);
    expect(ids).toEqual(['second', 'first']);
  });

  it('yields the connection when another opener requests a version upgrade', async () => {
    const { factory, driver } = makeDriver();
    await driver.init();

    const newer = await openRaw(factory, 'test-db', 2); // triggers versionchange on driver

    await expect(driver.get('anything')).rejects.toMatchObject({ code: 'unknown' });
    expect(newer.version).toBe(2);
    newer.close();
  });

  it('reports a database that exists at a newer version as a typed open failure', async () => {
    const factory = new IDBFactory();
    const newer = await openRaw(factory, 'test-db', 2);

    const driver = createIndexedDbDriver({ dbName: 'test-db', factory });

    await expect(driver.init()).rejects.toMatchObject({ code: 'open-failed' });
    newer.close();
  });

  it('rejects init with a typed blocked error when another tab blocks the upgrade', async () => {
    const { factory, request } = scriptedFactory();
    const driver = createIndexedDbDriver({ factory });
    const pending = driver.init(); // init assigns its handlers synchronously

    request.onblocked?.();

    await expect(pending).rejects.toMatchObject({
      name: 'PersistenceError',
      code: 'blocked',
    });
  });

  it('rejects init with a typed upgrade error when the schema upgrade fails', async () => {
    const { factory, request } = scriptedFactory();
    const driver = createIndexedDbDriver({ factory });
    const pending = driver.init();

    // The upgrade handler inspects result — report a db that already has the store.
    request.result = {
      objectStoreNames: { contains: () => true },
      close: () => {},
    } as unknown as IDBDatabase;
    request.onupgradeneeded?.();
    request.error = new DOMException('constraint', 'ConstraintError');
    request.readyState = 'done';
    request.onerror?.();

    await expect(pending).rejects.toMatchObject({ code: 'upgrade-failed' });
  });

  it('rejects init with a typed open error when the open simply fails', async () => {
    const { factory, request } = scriptedFactory();
    const driver = createIndexedDbDriver({ factory });
    const pending = driver.init();

    request.error = new DOMException('quota', 'QuotaExceededError');
    request.readyState = 'done';
    request.onerror?.();

    await expect(pending).rejects.toMatchObject({ code: 'open-failed' });
  });

  it('rejects operations with a typed error before init', async () => {
    const { driver } = makeDriver();

    await expect(driver.list()).rejects.toMatchObject({ code: 'unknown' });
  });
});
