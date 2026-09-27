// Module: lib/persistence/migrate — one-time migration from the vanilla
// app's localStorage into the document repository. Guarded by a persisted
// flag (mv:migrated-to-idb) so it runs at most once per browser profile and
// is a no-op on every later boot.
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
//     from its source url at their leisure.
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

/**
 * Migrate mv:recent into the repository. Call AFTER repo.init(). Returns
 * true when this call performed the migration (the flag was absent), false
 * when it had already run. Creates one record per valid recent entry, most
 * recent first, each with an empty-content placeholder and source
 * { kind: 'url', url }.
 */
export async function migrateLegacyLocalStorage(
  store: MvStore,
  repo: DocumentRepository,
): Promise<boolean> {
  if (store.get<boolean>(MIGRATION_FLAG_KEY, false)) return false;

  const recents = store.get<unknown>('recent', []);
  const valid = Array.isArray(recents)
    ? recents.filter(isLegacyRecentItem).slice(0, LEGACY_RECENTS_CAP)
    : [];

  // Sequential by design: repo.create appends at max sortIndex + 1, so each
  // record must land before the next is created to preserve recents order.
  await valid.reduce<Promise<unknown>>(
    (chain, item) => chain.then(() => repo.create({
      name: item.name,
      content: '', // legacy stored no content — placeholder, see header
      source: { kind: 'url', url: item.url },
    })),
    Promise.resolve(),
  );

  store.set(MIGRATION_FLAG_KEY, true);
  return true;
}
