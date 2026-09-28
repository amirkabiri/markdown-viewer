// Module: lib/persistence/dedupe — boot-time self-heal for duplicate
// url-sourced records. The legacy mv:recent migration creates an
// empty-content placeholder per recent entry (see migrate.ts); if a real
// record for the same source url ever comes to sit beside one — the
// migration ran before the Web Locks guard existed, two tabs raced the
// check-then-set flag on a browser without Web Locks, or the url-load dedupe
// adopted a sibling copy — the sidebar would list the same document twice.
//
// dropDuplicatePlaceholders groups url-sourced records by their source url
// and, inside any group larger than one, drops the EMPTY placeholders as
// long as another member survives. Content-bearing records are never
// removed: only the migration creates empty url-sourced records, so an empty
// record with a same-url sibling is always the redundant copy. When every
// member is an empty placeholder (a pure two-tab race), the first record in
// list order is kept and the surplus dropped — list() is sorted
// (sortIndex, then updatedAt) from the SHARED driver, so concurrent tabs
// converge on the same keeper deterministically.
//
// Runs on every boot (after the one-shot migration): one list() scan, and
// the removals only ever fire while damage exists. Two tabs booting in the
// same instant may each scan a half-converged view (the sync hub is still
// delivering the other tab's records) — the Web Locks migration guard keeps
// that race from creating NEW duplicates, and any residual damage is healed
// by the next boot's scan, whose init() reads the whole shared database.

import type { DocumentRecord, DocumentRepository } from './types';

/** The url-sourced records grouped by their source url (list order kept). */
export function groupByUrlSource(records: DocumentRecord[]): Map<string, DocumentRecord[]> {
  return records.reduce<Map<string, DocumentRecord[]>>((groups, record) => {
    const { source } = record;
    if (source?.kind === 'url' && source.url) {
      const group = groups.get(source.url);
      if (group) group.push(record);
      else groups.set(source.url, [record]);
    }
    return groups;
  }, new Map());
}

/**
 * Drop empty-content placeholder records whose source url another record
 * already holds. No-op on a clean repository; the removals broadcast as
 * ordinary 'removed' changes, so any tab that had a dropped placeholder
 * open falls back the same way as a user removal.
 */
export async function dropDuplicatePlaceholders(repo: DocumentRepository): Promise<void> {
  const doomed = new Set<string>();
  groupByUrlSource(await repo.list()).forEach((group) => {
    if (group.length < 2) return;
    const keeper = group.find((record) => record.content !== '') ?? group[0];
    group.forEach((record) => {
      if (record.id !== keeper.id && record.content === '') doomed.add(record.id);
    });
  });

  // Sequential like every other boot-time mutation (see migrate.ts): one
  // committed removal lands before the next is attempted.
  await [...doomed].reduce<Promise<unknown>>(
    (chain, id) => chain.then(() => repo.remove(id)),
    Promise.resolve(),
  );
}
