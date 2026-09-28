// Module: lib/persistence/migrate — one-time migration from the vanilla
// app's localStorage into the document repository. Guarded by a persisted
// flag (mv:migrated-to-idb) so it runs at most once per browser profile and
// is a no-op on every later boot; the check-then-set runs inside an exclusive
// Web Locks lock when the browser provides one, because two tabs can boot
// together and both see the flag as absent (dropDuplicatePlaceholders in
// dedupe.ts additionally heals any duplicates such a race could create).
//
// WHAT THE LEGACY APP ACTUALLY STORES (verified against
// legacy/src/state.ts + legacy/src/documents.ts): the only document-like key
// is mv:recent — a JSON array of { name, url } (max 8, most-recent-first,
// deduped by url). The vanilla app NEVER persisted the current document:
// state.doc is a runtime memo only, and there is no mv:doc key. So this
// migration creates one DocumentRecord per recent entry — source kind 'url'
// with the stored url — and, honestly, NOTHING ELSE:
//
//   - Recents carry NO content (only name + url), so each migrated record
//     gets an EMPTY content placeholder. The document text is not re-fetched
//     during migration (the urls may be gone, and a migration must not make
//     network calls); a user who re-opens a migrated document can reload it
//     from its source url at their leisure — the url-load path dedupes on
//     source.url, so a re-open ADOPTS the placeholder instead of creating a
//     second record for the same document.
//   - An entry whose source url already has a record (a real document the
//     app or an earlier migration stored — same url) is skipped: the
//     placeholder would only ever duplicate it.
//   - Relative order is preserved: legacy index 0 (most recent) gets the
//     lowest sortIndex, because repo.create appends at max+1.
//
// Entries that do not match the expected shape (missing/blank name or url)
// are skipped. The flag is written even when nothing was migrated, so an
// empty or corrupt legacy store is migrated exactly "once" too.

import type { MvStore } from '../store';
import type { DocumentRepository } from './types';

/** Logical key (mv:-prefixed by the store) of the one-time migration flag. */
export const MIGRATION_FLAG_KEY = 'migrated-to-idb';

/** Exclusive Web Locks name serializing the migration across tabs. */
export const MIGRATION_LOCK_NAME = 'qalam-migrate-legacy';

/** Legacy cap on the recents list (legacy addRecent slices to 8). */
const LEGACY_RECENTS_CAP = 8;

/** One entry of the legacy mv:recent list — no content was ever stored. */
export interface LegacyRecentItem {
  name: string;
  url: string;
}

function isLegacyRecentItem(value: unknown): value is LegacyRecentItem {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<LegacyRecentItem>;
  return (
    typeof candidate.name === 'string' &&
    candidate.name.trim() !== '' &&
    typeof candidate.url === 'string' &&
    candidate.url.trim() !== ''
  );
}

/** The stored source URLs the repository already holds a record for. */
async function takenSourceUrls(repo: DocumentRepository): Promise<Set<string>> {
  const records = await repo.list();
  return new Set(
    records
      .filter((record) => record.source?.kind === 'url' && record.source.url)
      .map((record) => record.source?.url as string),
  );
}

/**
 * Migrate mv:recent into the repository. Call AFTER repo.init(). Returns
 * true when this call performed the migration (the flag was absent), false
 * when it had already run. Creates one record per valid, not-yet-present
 * recent entry, most recent first, each with an empty-content placeholder
 * and source { kind: 'url', url }. Serialized across tabs with an exclusive
 * Web Locks lock when the browser provides one.
 */
export async function migrateLegacyLocalStorage(
  store: MvStore,
  repo: DocumentRepository,
): Promise<boolean> {
  const run = async (): Promise<boolean> => {
    if (store.get<boolean>(MIGRATION_FLAG_KEY, false)) return false;

    const recents = store.get<unknown>('recent', []);
    const valid = Array.isArray(recents)
      ? recents.filter(isLegacyRecentItem).slice(0, LEGACY_RECENTS_CAP)
      : [];
    const taken = await takenSourceUrls(repo);

    // Sequential by design: repo.create appends at max sortIndex + 1, so each
    // record must land before the next is created to preserve recents order.
    await valid.reduce<Promise<unknown>>(
      (chain, item) => chain.then(() => {
        if (taken.has(item.url)) return undefined; // the record exists — see header
        taken.add(item.url);
        return repo.create({
          name: item.name,
          content: '', // legacy stored no content — placeholder, see header
          source: { kind: 'url', url: item.url },
        });
      }),
      Promise.resolve(),
    );

    store.set(MIGRATION_FLAG_KEY, true);
    return true;
  };

  const manager = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks;
  if (!manager) return run();
  // Hold the lock until the migration settles: a granted callback that
  // returns a promise keeps the lock for as long as it is pending.
  return new Promise<boolean>((resolve, reject) => {
    manager.request(MIGRATION_LOCK_NAME, () => run().then(resolve, reject));
  });
}
