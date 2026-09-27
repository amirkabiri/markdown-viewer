// Unit tests for src/lib/persistence/default-driver.ts — the boot-path driver
// selection. Persistence must degrade gracefully, never fail boot: when
// IndexedDB is missing or unusable the app gets the memory driver and exactly
// one console.warn. The real fake-indexeddb factory proves the success path;
// the scripted/no-factory cases prove the fallback paths.

import { IDBFactory } from 'fake-indexeddb';
import {
  afterEach, describe, expect, it, vi,
} from 'vitest';
import { createDefaultDriver } from './default-driver';

/** Silence and capture fallback warnings for the duration of one test. */
function captureWarnings(): ReturnType<typeof vi.fn> {
  return vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {});
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createDefaultDriver', () => {
  it('returns an initialized indexeddb driver when IndexedDB works', async () => {
    const warn = captureWarnings();

    const driver = await createDefaultDriver({ factory: new IDBFactory() });

    expect(driver.name).toBe('indexeddb');
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to the memory driver and warns once when IndexedDB is missing', async () => {
    const warn = captureWarnings();

    const driver = await createDefaultDriver(); // node has no global indexedDB

    expect(driver.name).toBe('memory');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('IndexedDB');
  });

  it('falls back to the memory driver and warns once when init fails', async () => {
    const warn = captureWarnings();
    const brokenFactory = {
      open: () => {
        throw new DOMException('storage disabled', 'InvalidStateError');
      },
    } as unknown as IDBFactory;

    const driver = await createDefaultDriver({ factory: brokenFactory });

    expect(driver.name).toBe('memory');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('storage disabled');
  });

  it('passes naming options through, so callers sharing a database see one store', async () => {
    captureWarnings();
    const factory = new IDBFactory();
    const first = await createDefaultDriver({ factory, dbName: 'shared-db' });
    const second = await createDefaultDriver({ factory, dbName: 'shared-db' });
    await first.put({
      id: 'doc-1',
      name: 'Shared',
      content: '',
      createdAt: 1,
      updatedAt: 1,
      sortIndex: 0,
      revision: 0,
    });

    await expect(second.get('doc-1')).resolves.toMatchObject({ name: 'Shared' });
  });

  it('still serves the created fallback memory driver as a working store', async () => {
    captureWarnings();

    const driver = await createDefaultDriver(); // no IndexedDB in node
    await driver.put({
      id: 'doc-1',
      name: 'Session only',
      content: '',
      createdAt: 1,
      updatedAt: 1,
      sortIndex: 0,
      revision: 0,
    });

    await expect(driver.list()).resolves.toHaveLength(1);
  });
});
