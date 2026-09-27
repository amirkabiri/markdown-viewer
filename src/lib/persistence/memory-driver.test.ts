// Unit tests for src/lib/persistence/memory-driver.ts — the in-memory
// PersistenceDriver that doubles as test fake and runtime fallback. The
// behavior that matters is the CONTRACT it shares with the IndexedDB driver:
// sortIndex/updatedAt ordering, boundary copies, and driver-managed revision
// bumps taken from the stored record (never from a stale caller copy).

import { describe, expect, it } from 'vitest';
import { createMemoryDriver } from './memory-driver';
import type { DocumentRecord } from './types';

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

describe('createMemoryDriver', () => {
  it('roundtrips a seeded document through get', async () => {
    const seeded = makeRecord({ name: 'Notes' });
    const driver = createMemoryDriver([seeded]);
    await driver.init();

    await expect(driver.get(seeded.id)).resolves.toEqual(seeded);
  });

  it('lists documents ordered by sortIndex, then updatedAt', async () => {
    const driver = createMemoryDriver([
      makeRecord({ id: 'b', sortIndex: 2, updatedAt: 100 }),
      makeRecord({ id: 'a', sortIndex: 1, updatedAt: 500 }),
      makeRecord({ id: 'd', sortIndex: 2, updatedAt: 50 }),
      makeRecord({ id: 'c', sortIndex: 10, updatedAt: 10 }),
    ]);
    await driver.init();

    const ids = (await driver.list()).map((d) => d.id);

    expect(ids).toEqual(['a', 'd', 'b', 'c']);
  });

  it('hands out copies so callers cannot mutate stored records', async () => {
    const seeded = makeRecord({ name: 'Original' });
    const driver = createMemoryDriver([seeded]);
    await driver.init();

    const fetched = await driver.get(seeded.id);
    if (fetched) fetched.name = 'Mutated';

    await expect(driver.get(seeded.id)).resolves.toEqual(seeded);
  });

  it('seeds from a copy, so later seed-array mutations never leak in', async () => {
    const seeded = makeRecord({ name: 'Original' });
    const seed = [seeded];
    const driver = createMemoryDriver(seed);
    await driver.init();

    const expected = { ...seeded };
    seeded.name = 'Mutated';
    seed.pop();

    await expect(driver.get(seeded.id)).resolves.toEqual(expected);
  });

  it('bumps revision from the stored record, never from a stale caller copy', async () => {
    const driver = createMemoryDriver();
    await driver.init();
    const doc = makeRecord({ revision: 0 });

    await driver.put(doc);
    await driver.put(doc); // same stale object again

    await expect(driver.get(doc.id)).resolves.toMatchObject({ revision: 2 });
  });

  it('upserts: a second put with new content replaces the stored record', async () => {
    const driver = createMemoryDriver();
    await driver.init();
    const doc = makeRecord({ content: 'v1' });

    await driver.put(doc);
    await driver.put({ ...doc, content: 'v2' });

    await expect(driver.get(doc.id)).resolves.toMatchObject({ content: 'v2', revision: 2 });
  });

  it('deletes a document by id', async () => {
    const doc = makeRecord();
    const driver = createMemoryDriver([doc]);
    await driver.init();

    await driver.delete(doc.id);

    await expect(driver.get(doc.id)).resolves.toBeNull();
  });

  it('reorders by assigning each given id the sortIndex of its position', async () => {
    const first = makeRecord({ id: 'first' });
    const second = makeRecord({ id: 'second' });
    const third = makeRecord({ id: 'third' });
    const driver = createMemoryDriver([first, second, third]);
    await driver.init();

    await driver.reorder([third.id, first.id, second.id]);

    const ids = (await driver.list()).map((d) => d.id);
    expect(ids).toEqual(['third', 'first', 'second']);
  });

  it('keeps documents that a reorder did not mention in place', async () => {
    const mentioned = makeRecord({ id: 'mentioned' });
    const unmentioned = makeRecord({ id: 'unmentioned', sortIndex: 7 });
    const driver = createMemoryDriver([mentioned, unmentioned]);
    await driver.init();

    await driver.reorder([mentioned.id]);

    await expect(driver.get(unmentioned.id)).resolves.toMatchObject({ sortIndex: 7 });
  });

  it('resolves close without discarding data (fallback driver, nothing to release)', async () => {
    const doc = makeRecord();
    const driver = createMemoryDriver([doc]);
    await driver.init();

    await expect(driver.close()).resolves.toBeUndefined();
    await expect(driver.get(doc.id)).resolves.toEqual(doc);
  });
});
