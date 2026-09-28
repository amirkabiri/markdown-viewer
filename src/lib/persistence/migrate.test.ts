// Unit tests for src/lib/persistence/migrate.ts — the one-time migration of
// the vanilla app's localStorage into the repository. The store is the real
// createMvStore over an in-memory Storage fake; the repository is the real
// repository over the memory driver, so the migration exercises the exact
// production path. Legacy shapes per legacy/src/documents.ts: mv:recent is a
// JSON array of { name, url } — most-recent-first, no content. The vanilla
// app never persisted the current document, so recents are all there is.

import { describe, expect, it } from 'vitest';
import makeStorage from '../../test/fakes';
import { createMvStore } from '../store';
import createMemoryDriver from './memory-driver';
import { MIGRATION_FLAG_KEY, migrateLegacyLocalStorage } from './migrate';
import createDocumentRepository from './repository';

async function makeMigrationRepo() {
  let counter = 0;
  const repo = createDocumentRepository(createMemoryDriver(), {
    idFactory: () => {
      counter += 1;
      return `doc-${counter}`;
    },
    now: () => 1000,
  });
  await repo.init();
  return repo;
}

describe('migrateLegacyLocalStorage', () => {
  it('migrates the recents list in order, with url sources and empty-content placeholders', async () => {
    const storage = makeStorage();
    storage.setItem(
      'mv:recent',
      JSON.stringify([
        { name: 'Latest', url: 'https://example.com/latest.md' },
        { name: 'Older', url: 'https://example.com/older.md' },
      ]),
    );
    const repo = await makeMigrationRepo();

    const ran = await migrateLegacyLocalStorage(createMvStore(storage), repo);
    const docs = await repo.list();

    expect(ran).toBe(true);
    expect(docs.map((d) => d.name)).toEqual(['Latest', 'Older']);
    expect(docs[0]?.sortIndex).toBeLessThan(docs[1]?.sortIndex ?? 0);
    expect(docs[0]?.source).toEqual({ kind: 'url', url: 'https://example.com/latest.md' });
    expect(docs.every((d) => d.content === '')).toBe(true);
  });

  it('skips a recent whose source url the repository already holds', async () => {
    const storage = makeStorage();
    storage.setItem(
      'mv:recent',
      JSON.stringify([
        { name: 'README', url: 'https://example.com/README.md' },
        { name: 'Notes', url: 'https://example.com/notes.md' },
      ]),
    );
    const repo = await makeMigrationRepo();
    // A real record for the same document already exists (a lost flag, or an
    // earlier boot loaded it): the placeholder must not duplicate it.
    await repo.create({
      name: 'README',
      content: '# real README',
      source: { kind: 'url', url: 'https://example.com/README.md' },
    });

    await migrateLegacyLocalStorage(createMvStore(storage), repo);
    const docs = await repo.list();

    expect(docs.map((d) => d.name)).toEqual(['README', 'Notes']);
    expect(docs[0]?.content).toBe('# real README');
  });

  it('persists the flag so a second run is a no-op', async () => {
    const storage = makeStorage();
    storage.setItem(
      'mv:recent',
      JSON.stringify([{ name: 'Notes', url: 'https://example.com/n.md' }]),
    );
    const repo = await makeMigrationRepo();
    const mv = createMvStore(storage);

    await migrateLegacyLocalStorage(mv, repo);
    const ranAgain = await migrateLegacyLocalStorage(mv, repo);

    expect(ranAgain).toBe(false);
    expect(await repo.list()).toHaveLength(1);
    expect(JSON.parse(storage.getItem(`mv:${MIGRATION_FLAG_KEY}`) ?? '')).toBe(true);
  });

  it('sets the flag even when there is nothing to migrate', async () => {
    const storage = makeStorage();
    const repo = await makeMigrationRepo();
    const mv = createMvStore(storage);

    const ran = await migrateLegacyLocalStorage(mv, repo);

    expect(ran).toBe(true);
    expect(await repo.list()).toEqual([]);
    expect(storage.getItem(`mv:${MIGRATION_FLAG_KEY}`)).toBe('true');
  });

  it('skips malformed entries instead of failing the migration', async () => {
    const storage = makeStorage();
    storage.setItem(
      'mv:recent',
      JSON.stringify([
        { name: 'Good', url: 'https://example.com/good.md' },
        { name: '', url: 'https://example.com/nameless.md' },
        { name: 'No url' },
        'not even an object',
        null,
      ]),
    );
    const repo = await makeMigrationRepo();

    await migrateLegacyLocalStorage(createMvStore(storage), repo);

    expect((await repo.list()).map((d) => d.name)).toEqual(['Good']);
  });

  it('treats a corrupt recents payload as empty and still guards the flag', async () => {
    const storage = makeStorage();
    storage.setItem('mv:recent', '{not json');
    const repo = await makeMigrationRepo();
    const mv = createMvStore(storage);

    const ran = await migrateLegacyLocalStorage(mv, repo);

    expect(ran).toBe(true);
    expect(await repo.list()).toEqual([]);
    expect(storage.getItem(`mv:${MIGRATION_FLAG_KEY}`)).toBe('true');
  });
});
