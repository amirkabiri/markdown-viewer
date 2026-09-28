# Future driver: File System Access (design only — no implementation)

The persistence layer was architected for driver replacement (stakeholder
requirement: IndexedDB now, browser File System Access later). This document
specifies how `createFileSystemAccessDriver()` will slot in WITHOUT touching
anything above `PersistenceDriver` — the repository, autosave pipeline,
multi-tab sync, sessions, and the entire UI stay untouched. The swap is a
driver change plus a settings toggle.

## Interface mapping

`createFileSystemAccessDriver()` returns the SAME `PersistenceDriver`
contract (`src/lib/persistence/types.ts`):

| PersistenceDriver | File System Access realization |
| ----------------- | ------------------------------ |
| `name`            | `'file-system-access'` (extend `DriverName`) |
| `init()`          | Resolve the root directory handle: restore a persisted `FileSystemDirectoryHandle` from IndexedDB (handles are structured-cloneable) or `showDirectoryPicker({ mode: 'readwrite' })` on first run. Verify `queryPermission({ mode: 'readwrite' })`. |
| `list()`          | Read the index file (below), merge with the directory listing; sort by `sortIndex`, then `updatedAt` (same contract as the other drivers). |
| `get(id)`         | Index lookup + read `<id>.md` from the directory. |
| `put(doc)`        | Write `<id>.md` via `createWritable()` — the old content stays intact until `close()`, which makes the swap atomic. Update the index in the same flow. Bump `revision` from the STORED value exactly like the IndexedDB driver (single place for cross-tab conflict detection). |
| `delete(id)`      | `removeEntry('<id>.md')` + index update. |
| `reorder(ids)`    | Rewrite `sortIndex` values in the index only — never rename files. |
| `close()`         | Drop the cached handle (no explicit close API). Flush the index if dirty. |

## On-disk layout

```
<user-chosen directory>/
  .qalam-index.json        ← id → { name, createdAt, updatedAt, sortIndex, revision, source }
  <document-id>.md          ← content only; the file name is the stable id
```

File names are the stable document id (never the user-visible name, never the
sortIndex): renames and reorders then cost an index rewrite, not a directory
full of renames. `name` lives in the index because `.md` front-matter would
make every rename a content rewrite and invite merge noise.

## Permissions

- `init()` runs `queryPermission({ mode: 'readwrite' })`:
  - `'granted'` → proceed.
  - `'prompt'` → reject init with `PersistenceError('permission', …)`; the UI
    must then call `requestPermission()` from a USER GESTURE (a button — the
    browser requires it) and re-init.
  - `'denied'` → same typed rejection; the settings toggle offers the
    memory-driver fallback.
- Handles expire across browser restarts: persist the handle in IndexedDB and
  treat every boot's `queryPermission` check as the re-grant flow. Chrome may
  also drop permission after 3 Usage-Intervals; writes must catch
  `NotAllowedError` and surface the same typed `'permission'` error.

## Conflict semantics

- Multi-tab on one profile keeps BroadcastChannel + Web Locks (they work
  regardless of storage backend); `revision` continues to bump from stored
  state, now stored in `.qalam-index.json`.
- EXTERNAL edits (the user edits the .md in another editor) are detected by
  comparing the file's `lastModified` + size against the index entry during
  `list()`/`get()`. Policy: last-writer-wins with a surfaced "changed on
  disk" event; the repository's dirty-buffer preservation (steal → copy)
  gives the same "text is never lost" guarantee for the external case.
- Two browser profiles / machines on one synced folder (Dropbox & co.) are
  explicitly OUT of scope: the index has no merge semantics; last file
  wins. Document this in the settings toggle copy.

## Rollout

1. Ship the driver behind the existing `PersistenceDriver` contract.
2. Add a settings entry: "Store documents in a local folder" → runs the
   permission flow, migrates by `driver.put()`-ing every record from the old
   driver into the new one (revision carried over), then flips
   `createDefaultDriver` selection.
3. Keep IndexedDB as the default; File System Access is opt-in (Safari and
   Firefox lack the API — feature-detect `showDirectoryPicker` and hide the
   toggle where missing; the graceful-degradation path of
   `createDefaultDriver` stays exactly as is).
