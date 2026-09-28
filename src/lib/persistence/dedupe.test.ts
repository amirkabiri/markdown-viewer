// Regression tests for src/lib/persistence/dedupe.ts — the boot-time
// duplicate self-heal (dropDuplicatePlaceholders). The bug it pins: the
// legacy mv:recent migration creates an empty placeholder per recent entry,
// and a real record for the same source url can come to sit beside one (a
// pre-guard migration, two tabs racing the check-then-set flag, the url-load
// adoption) — the sidebar then listed the same document twice. Run against
// the REAL indexeddb driver over fake-indexeddb; the two-tab specs keep the
// production shape (two repositories, one shared database), including the
// pre-guard world whose damage the heal must repair on the next boot.

import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { dropDuplicatePlaceholders } from './dedupe';
import { migrateLegacyLocalStorage } from './migrate';
import { createIndexedDbDriver } from './indexeddb-driver';
import createDocumentRepository from './repository';
import { createTabSyncHub } from './sync';
import { createMvStore } from '../store';
import makeStorage from '../../test/fakes';
import type { DocumentRecord, DocumentRepository } from './types';

async function makeTabRepo(
  factory: IDBFactory,
  id: string,
  opts: { hub?: boolean } = {},
): Promise<DocumentRepository> {
  const repo = createDocumentRepository(
    createIndexedDbDriver({ dbName: 'shared-db', factory }),
    {
      idFactory: () => `${id}-${crypto.randomUUID()}`,
      ...(opts.hub ? { hub: createTabSyncHub() } : {}),
    },
  );
  await repo.init();
  return repo;
}

function storeWithRecents(...entries: { name: string; url: string }[]) {
  const storage = makeStorage();
  storage.setItem('mv:recent', JSON.stringify(entries));
  return createMvStore(storage);
}

const BOOT_RECENTS = [
  { name: 'README', url: 'http://localhost:4173/README.md' },
  { name: 'sample-fa', url: 'http://localhost:4173/samples/sample-fa.md' },
];

/** An independent read of what is actually stored (not a tab's cache). */
async function storedRecords(factory: IDBFactory): Promise<DocumentRecord[]> {
  const observer = await makeTabRepo(factory, 'observer');
  const records = await observer.list();
  await observer.dispose();
  return records;
}

describe('dropDuplicatePlaceholders', () => {
  it('drops an empty placeholder whose source url a real record already holds', async () => {
    const factory = new IDBFactory();
    const repo = await makeTabRepo(factory, 'a');
    // The observed damage: the real README (boot-loaded, with content) plus
    // the migration's empty placeholder for the same url.
    await repo.create({
      name: 'README',
      content: '# Qalam',
      source: { kind: 'url', url: 'http://localhost:4173/README.md' },
    });
    await repo.create({
      name: 'README',
      content: '',
      source: { kind: 'url', url: 'http://localhost:4173/README.md' },
    });
    expect(await repo.list()).toHaveLength(2);

    await dropDuplicatePlaceholders(repo);

    const docs = await repo.list();
    expect(docs).toHaveLength(1);
    expect(docs[0]?.content).toBe('# Qalam');
  });

  it('never removes records that carry content, even when urls collide', async () => {
    const factory = new IDBFactory();
    const repo = await makeTabRepo(factory, 'a');
    await repo.create({
      name: 'Notes one',
      content: 'first',
      source: { kind: 'url', url: 'https://example.com/notes.md' },
    });
    await repo.create({
      name: 'Notes two',
      content: 'second',
      source: { kind: 'url', url: 'https://example.com/notes.md' },
    });

    await dropDuplicatePlaceholders(repo);

    expect((await repo.list()).map((d) => d.name)).toEqual(['Notes one', 'Notes two']);
  });

  it('leaves a lone placeholder untouched (no same-url sibling)', async () => {
    const factory = new IDBFactory();
    const repo = await makeTabRepo(factory, 'a');
    await repo.create({
      name: 'sample-fa',
      content: '',
      source: { kind: 'url', url: 'https://example.com/sample-fa.md' },
    });

    await dropDuplicatePlaceholders(repo);

    expect((await repo.list()).map((d) => d.name)).toEqual(['sample-fa']);
  });

  it('drops only the surplus when a url group holds several empty placeholders', async () => {
    const factory = new IDBFactory();
    const repo = await makeTabRepo(factory, 'a');
    await repo.create({
      name: 'README',
      content: '',
      source: { kind: 'url', url: 'https://example.com/README.md' },
    });
    await repo.create({
      name: 'README',
      content: '',
      source: { kind: 'url', url: 'https://example.com/README.md' },
    });

    await dropDuplicatePlaceholders(repo);

    expect(await repo.list()).toHaveLength(1);
  });

  it('heals the pre-guard two-tab race damage on the next boot', async () => {
    const factory = new IDBFactory();

    // The world before the migration lock: two tabs boot together, both see
    // the flag as absent and both migrate the same recents into the shared
    // database — no hub, so neither cache ever sees the other's half.
    const tabA = await makeTabRepo(factory, 'a');
    const tabB = await makeTabRepo(factory, 'b');
    await migrateLegacyLocalStorage(storeWithRecents(...BOOT_RECENTS), tabA);
    await migrateLegacyLocalStorage(storeWithRecents(...BOOT_RECENTS), tabB);
    expect(await storedRecords(factory)).toHaveLength(4);

    // The next boot's repository reads the whole database at init, runs the
    // heal, and converges the store to one record per url.
    const nextBoot = await makeTabRepo(factory, 'c');
    await dropDuplicatePlaceholders(nextBoot);
    expect((await storedRecords(factory)).map((r) => r.name))
      .toEqual(['README', 'sample-fa']);

    await tabA.dispose();
    await tabB.dispose();
    await nextBoot.dispose();
  });

  it('a tab booting after another has migrated does not duplicate the recents', async () => {
    const factory = new IDBFactory();

    // Production wiring: both tabs share the sync hub, so tab B's cache
    // converges with tab A's writes while B waits out the migration (the
    // yield models that hub delivery landing during the wait). Tab B's
    // migration then sees every url taken — no placeholders, nothing to heal.
    const tabA = await makeTabRepo(factory, 'a', { hub: true });
    const tabB = await makeTabRepo(factory, 'b', { hub: true });
    await migrateLegacyLocalStorage(storeWithRecents(...BOOT_RECENTS), tabA);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    await migrateLegacyLocalStorage(storeWithRecents(...BOOT_RECENTS), tabB);
    await dropDuplicatePlaceholders(tabB);

    expect((await storedRecords(factory)).map((r) => r.name))
      .toEqual(['README', 'sample-fa']);

    await tabA.dispose();
    await tabB.dispose();
  });
});
