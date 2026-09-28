// Component tests for the repository-backed documents controller: boot
// routing precedence (?url= → ?file= → #d= → active-doc → README), URL
// re-load dedupe (one record per source URL, content updated), active-doc
// restore after boot, CRUD + reorder persistence, multi-tab sessions over one
// fake-indexeddb (readonly + takeover + stolen toast + live remote list
// updates), autosave wiring, paste/upload guards. fetch is a fake returning
// real Responses (house style); the multi-tab tests link two repositories
// over a shared in-memory bus — the same echo-suppression contract as the
// real BroadcastChannel hub, without leaving jsdom.
import { act, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { IDBFactory } from 'fake-indexeddb';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
  createDocumentRepository,
  createInProcessLockAdapter,
  createIndexedDbDriver,
} from '../../lib/persistence';
import type {
  DocumentLockAdapter, DocumentRepository, TabSyncEvent, TabSyncHub,
} from '../../lib/persistence';
import { I18nProvider } from '../../app/i18n';
import WELCOME_MD from './welcome';
import { ACTIVE_DOC_KEY, useDocuments } from './useDocuments';
import type {
  DocumentsController, DocumentsDeps,
} from './useDocuments';

/* ---------------- fakes ---------------- */

/** A per-test IndexedDB origin: one factory shared by every repository. */
function newIdbOrigin(): IDBFactory {
  return new IDBFactory();
}

async function makeRepo(
  idb: IDBFactory,
  opts: { hub?: TabSyncHub; locks?: DocumentLockAdapter } = {},
): Promise<DocumentRepository> {
  const driver = createIndexedDbDriver({ factory: idb });
  const repo = createDocumentRepository(driver, {
    ...(opts.hub ? { hub: opts.hub } : {}),
    // One lock manager per ORIGIN: multi-tab tests share one adapter between
    // repositories, exactly like navigator.locks in a real browser.
    ...(opts.locks ? { locks: opts.locks } : {}),
  });
  await repo.init();
  return repo;
}

/** Echo-suppressing hub over a shared bus — the BroadcastChannel contract. */
function createTestHub(bus: { listeners: Set<(event: TabSyncEvent) => void> }): TabSyncHub {
  const clientId = `tab-${Math.random().toString(36).slice(2)}`;
  return {
    clientId,
    broadcast(event) {
      bus.listeners.forEach((listener) => listener({ ...event, from: clientId }));
    },
    subscribe(listener) {
      bus.listeners.add(listener);
      return () => {
        bus.listeners.delete(listener);
      };
    },
    close() {
      /* shared test bus outlives individual hubs */
    },
  };
}

function makeBus(): { listeners: Set<(event: TabSyncEvent) => void> } {
  return { listeners: new Set() };
}

function makeDeps(
  repo: DocumentRepository | null,
  overrides: Partial<DocumentsDeps> = {},
): DocumentsDeps {
  const fetchImpl = vi.fn(async () => new Response('# Fetched doc\n\nbody', { status: 200 }));
  return {
    repo,
    setEditorDocument: vi.fn(),
    toast: vi.fn(),
    fetchImpl,
    ...overrides,
  };
}

interface HarnessProps {
  deps: DocumentsDeps;
  capture: (c: DocumentsController) => void;
}

function Harness({ deps, capture }: HarnessProps) {
  const ctl = useDocuments(deps);
  useEffect(() => {
    capture(ctl);
  }, [capture, ctl]);
  return null;
}

function setup(deps: DocumentsDeps) {
  let ctl: DocumentsController | undefined;
  render(
    <I18nProvider lang="en">
      <Harness
        deps={deps}
        capture={(c) => {
          ctl = c;
        }}
      />
    </I18nProvider>,
  );
  const controller = (): DocumentsController => {
    if (!ctl) throw new Error('controller not captured');
    return ctl;
  };
  return { controller };
}

async function setUrl(url: string): Promise<void> {
  window.history.replaceState(null, '', url);
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(window.history, 'pushState');
  return setUrl('/');
});

afterEach(() => {
  vi.restoreAllMocks();
  return setUrl('/');
});

describe('boot routing', () => {
  it('boots README.md into a persisted record when no params are present', async () => {
    const idb = newIdbOrigin();
    const repo = await makeRepo(idb);
    const deps = makeDeps(repo);
    const { controller } = setup(deps);

    await act(() => controller().boot());

    expect(deps.fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('README.md'),
      expect.anything(),
    );
    expect(deps.setEditorDocument).toHaveBeenCalledWith('# Fetched doc\n\nbody');
    expect(controller().doc?.name).toBe('README');

    const records = await repo.list();
    expect(records).toHaveLength(1);
    expect(records[0]?.name).toBe('README');
    expect(records[0]?.content).toBe('# Fetched doc\n\nbody');
    expect(records[0]?.source).toEqual({ kind: 'url', url: expect.stringContaining('README.md') });
    expect(controller().activeId).toBe(records[0]?.id);
    // The active pointer persists.
    expect(JSON.parse(localStorage.getItem(`mv:${ACTIVE_DOC_KEY}`) as string)).toBe(records[0]?.id);
  });

  it('prefers ?file= and resolves it site-relative', async () => {
    await setUrl('/?file=samples%2Fsample-fa.md');
    const repo = await makeRepo(newIdbOrigin());
    const deps = makeDeps(repo);
    const { controller } = setup(deps);

    await act(() => controller().boot());

    expect(deps.fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3000/samples/sample-fa.md',
      expect.anything(),
    );
    expect(controller().doc?.name).toBe('sample-fa');
  });

  it('dedupes a re-loaded URL by updating the existing record', async () => {
    const idb = newIdbOrigin();
    const repo = await makeRepo(idb);
    const first = makeDeps(repo);
    const { controller: firstCtl } = setup(first);

    await act(() => firstCtl().loadUrl('https://example.com/notes.md'));
    expect((await repo.list())).toHaveLength(1);

    // A second load of the same URL (a later session) updates, not duplicates.
    const fetchImpl = vi.fn(async () => new Response('# Notes v2', { status: 200 }));
    const second = makeDeps(repo, { fetchImpl });
    const { controller: secondCtl } = setup(second);

    await act(() => secondCtl().loadUrl('https://example.com/notes.md'));

    const records = await repo.list();
    expect(records).toHaveLength(1);
    expect(records[0]?.content).toBe('# Notes v2');
  });

  it('restores the persisted active document on a plain boot', async () => {
    const idb = newIdbOrigin();
    const repo = await makeRepo(idb);

    // "Previous session": create a document and make it active. The direct
    // load pushes ?url= into the address bar — a fresh visit (what the next
    // boot simulates) comes back to the site root first.
    const previous = makeDeps(repo);
    const { controller: previousCtl } = setup(previous);
    await act(() => previousCtl().loadUrl('https://example.com/journal.md'));
    await setUrl('/');

    // A fresh boot (fresh controller state, same storage) restores it —
    // README.md is never fetched.
    const fetchImpl = vi.fn();
    const next = makeDeps(repo, { fetchImpl });
    const { controller: nextCtl } = setup(next);

    await act(() => nextCtl().boot());

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(next.setEditorDocument).toHaveBeenCalledWith('# Fetched doc\n\nbody');
    expect(nextCtl().doc?.name).toBe('journal');
  });

  it('decodes a #d= share payload into a record and never rewrites the URL', async () => {
    const { shareEncode } = await import('../../lib/share');
    const encoded = await shareEncode('hello share');
    if (!encoded.ok) throw new Error('encode failed');
    await setUrl(encoded.url.replace('http://localhost:3000', ''));
    const repo = await makeRepo(newIdbOrigin());
    const { controller } = setup(makeDeps(repo));

    await act(() => controller().boot());

    expect(controller().doc?.text).toBe('hello share');
    expect(controller().doc?.name).toBe('Shared document');
    const records = await repo.list();
    expect(records[0]?.source?.kind).toBe('share');
    expect(window.history.pushState).not.toHaveBeenCalled();
    // The fragment survived — a refresh would re-decode the same document.
    expect(window.location.hash).toBe(encoded.url.slice(encoded.url.indexOf('#')));
  });

  it('falls back to the embedded welcome doc on a corrupt share payload', async () => {
    await setUrl('/#d=D.garbage');
    const repo = await makeRepo(newIdbOrigin());
    const deps = makeDeps(repo);
    const { controller } = setup(deps);

    await act(() => controller().boot());

    expect(controller().doc?.name).toBe('Welcome');
    expect(deps.setEditorDocument).toHaveBeenCalledWith(WELCOME_MD);
    expect(controller().activeId).toBeNull();
  });

  it('toasts load errors and falls back to the welcome doc', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 404 }));
    const repo = await makeRepo(newIdbOrigin());
    const deps = makeDeps(repo, { fetchImpl });
    const { controller } = setup(deps);

    const ok = await act(() => controller().loadUrl('https://example.com/missing.md'));

    expect(ok).toBe(false);
    expect(deps.toast).toHaveBeenCalledWith('Could not load document: HTTP 404', 'error');
    expect(controller().doc?.name).toBe('Welcome');
  });
});

describe('document management', () => {
  it('creates a new empty record without a confirm and opens it', async () => {
    const repo = await makeRepo(newIdbOrigin());
    const deps = makeDeps(repo);
    const { controller } = setup(deps);
    await act(() => controller().loadFile('README.md'));
    const confirm = vi.spyOn(window, 'confirm');

    let ok = false;
    await act(async () => {
      ok = await controller().newDocument();
    });

    expect(ok).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(controller().doc?.name).toBe('Untitled');
    expect(controller().doc?.text).toBe('');
    const records = await repo.list();
    expect(records.some((r) => r.name === 'Untitled' && r.content === '')).toBe(true);
  });

  it('selects a record into the editor', async () => {
    const repo = await makeRepo(newIdbOrigin());
    const deps = makeDeps(repo);
    const { controller } = setup(deps);
    await act(() => controller().loadFile('README.md'));
    const created = await repo.create({ name: 'Second', content: '# Second doc' });

    await act(() => controller().selectDocument(created.id));

    expect(deps.setEditorDocument).toHaveBeenLastCalledWith('# Second doc');
    expect(controller().doc?.name).toBe('Second');
    expect(controller().activeId).toBe(created.id);
  });

  it('renames a record in the repository', async () => {
    const repo = await makeRepo(newIdbOrigin());
    const { controller } = setup(makeDeps(repo));
    await act(() => controller().loadFile('README.md'));
    const id = controller().activeId as string;

    await act(() => controller().renameDocument(id, 'My notes'));

    const records = await repo.list();
    expect(records.find((r) => r.id === id)?.name).toBe('My notes');
  });

  it('removes a non-active record', async () => {
    const repo = await makeRepo(newIdbOrigin());
    const { controller } = setup(makeDeps(repo));
    await act(() => controller().loadFile('README.md'));
    const created = await repo.create({ name: 'Doomed', content: '' });

    await act(() => controller().removeDocument(created.id));

    const records = await repo.list();
    expect(records.some((r) => r.id === created.id)).toBe(false);
    expect(controller().activeId).not.toBe(created.id);
  });

  it('falls back to the most recent record when the active one is removed', async () => {
    const repo = await makeRepo(newIdbOrigin());
    const deps = makeDeps(repo);
    const { controller } = setup(deps);
    await act(() => controller().loadFile('README.md'));
    const created = await repo.create({ name: 'Active one', content: '# current' });
    await act(() => controller().selectDocument(created.id));

    await act(() => controller().removeDocument(created.id));

    await waitFor(() => {
      expect(controller().doc?.name).toBe('README');
    });
    expect(deps.setEditorDocument).toHaveBeenLastCalledWith('# Fetched doc\n\nbody');
  });

  it('persists a reorder', async () => {
    const repo = await makeRepo(newIdbOrigin());
    const { controller } = setup(makeDeps(repo));
    await act(() => controller().loadFile('README.md'));
    const b = await repo.create({ name: 'B', content: '' });
    const c = await repo.create({ name: 'C', content: '' });
    const a = controller().activeId as string;

    await act(() => controller().reorderDocuments([b.id, c.id, a]));

    expect(controller().docs.map((r) => r.name)).toEqual(['B', 'C', 'README']);
    // A fresh read from storage shows the persisted order.
    const records = await repo.list();
    expect(records.map((r) => r.name)).toEqual(['B', 'C', 'README']);
  });
});

describe('autosave', () => {
  it('saves the active document content through the repository', async () => {
    const idb = newIdbOrigin();
    const repo = await makeRepo(idb);
    const { controller } = setup(makeDeps(repo));
    await act(() => controller().loadFile('README.md'));
    const id = controller().activeId as string;

    controller().saveActiveContent('# typed by the user');
    await repo.flush(); // the pagehide path

    const stored = await repo.get(id);
    expect(stored?.content).toBe('# typed by the user');
  });

  it('does not save when no document is active (ephemeral welcome)', async () => {
    const repo = await makeRepo(newIdbOrigin());
    const { controller } = setup(makeDeps(repo));

    expect(() => controller().saveActiveContent('# orphan')).not.toThrow();
    return expect(repo.list()).resolves.toHaveLength(0);
  });
});

describe('multi-tab sessions', () => {
  it('sees another tab\'s documents live and opens the same doc readonly', async () => {
    const idb = newIdbOrigin();
    const bus = makeBus();
    const locks = createInProcessLockAdapter();
    const repoA = await makeRepo(idb, { hub: createTestHub(bus), locks });
    const repoB = await makeRepo(idb, { hub: createTestHub(bus), locks });

    const { controller: a } = setup(makeDeps(repoA));
    await act(() => a().loadFile('README.md'));

    const depsB = makeDeps(repoB);
    const { controller: b } = setup(depsB);

    // Tab B's list updates live when tab A creates a document.
    await waitFor(() => {
      expect(b().docs.some((r) => r.name === 'README')).toBe(true);
    });

    // Opening the same document in B yields a readonly session.
    const id = a().activeId as string;
    await act(() => b().selectDocument(id));
    expect(b().activeMode).toBe('readonly');

    // A readonly tab cannot save.
    b().saveActiveContent('# sabotaged');
    await repoB.flush();
    const stored = await repoB.get(id);
    expect(stored?.content).toBe('# Fetched doc\n\nbody');
  });

  it('takeover steals the lock; the loser flips readonly and saves a copy', async () => {
    const idb = newIdbOrigin();
    const bus = makeBus();
    const locks = createInProcessLockAdapter();
    const repoA = await makeRepo(idb, { hub: createTestHub(bus), locks });
    const repoB = await makeRepo(idb, { hub: createTestHub(bus), locks });

    const depsA = makeDeps(repoA);
    const { controller: a } = setup(depsA);
    await act(() => a().loadFile('README.md'));
    const id = a().activeId as string;

    const { controller: b } = setup(makeDeps(repoB));
    await act(() => b().selectDocument(id));
    expect(b().activeMode).toBe('readonly');

    // A types (dirty buffer), B takes over.
    a().saveActiveContent('# half-written thought');
    await act(() => b().takeoverActive());
    expect(b().activeMode).toBe('edit');

    await waitFor(() => {
      expect(a().activeMode).toBe('readonly');
    });
    // The dirty buffer was preserved as a copy — text is never lost.
    await waitFor(() => {
      expect(depsA.toast).toHaveBeenCalledWith('Saved a copy');
    });
    await waitFor(() => {
      expect(a().docs.some((r) => r.name === 'README (copy)')).toBe(true);
    });
    const copy = (await repoA.list()).find((r) => r.name === 'README (copy)');
    expect(copy?.content).toBe('# half-written thought');
  });

  it('reflects a remote rename of the active document', async () => {
    const idb = newIdbOrigin();
    const bus = makeBus();
    const locks = createInProcessLockAdapter();
    const repoA = await makeRepo(idb, { hub: createTestHub(bus), locks });
    const repoB = await makeRepo(idb, { hub: createTestHub(bus), locks });

    const { controller: a } = setup(makeDeps(repoA));
    await act(() => a().loadFile('README.md'));
    const id = a().activeId as string;

    const { controller: b } = setup(makeDeps(repoB));
    await act(() => b().selectDocument(id));

    await act(() => repoB.rename(id, 'Renamed elsewhere'));

    await waitFor(() => {
      expect(a().doc?.name).toBe('Renamed elsewhere');
    });
  });
});

describe('paste / upload', () => {
  it('rejects empty paste with the load-error toast', async () => {
    const repo = await makeRepo(newIdbOrigin());
    const deps = makeDeps(repo);
    const { controller } = setup(deps);

    expect(controller().loadPasted('   ')).toBe(false);
    expect(deps.toast).toHaveBeenCalledWith('Could not load document', 'error');
  });

  it('adopts a pasted document as a record and clears the query params', async () => {
    await setUrl('/?file=old.md');
    const repo = await makeRepo(newIdbOrigin());
    const { controller } = setup(makeDeps(repo));

    expect(controller().loadPasted('# Pasted body')).toBe(true);
    await waitFor(() => {
      expect(controller().doc?.name).toBe('Pasted document');
    });
    expect(window.location.search).toBe('');
    const records = await repo.list();
    expect(records[0]?.source?.kind).toBe('local');
  });

  it('rejects oversized uploads with the too-large toast', async () => {
    const repo = await makeRepo(newIdbOrigin());
    const deps = makeDeps(repo);
    const { controller } = setup(deps);
    const file = new File(['x'], 'big.md');
    Object.defineProperty(file, 'size', { value: 10 * 1024 * 1024 + 1 });

    return act(async () => {
      await controller().readAndLoad(file);
      expect(deps.toast).toHaveBeenCalledWith('Document is too large (limit 10 MB)', 'error');
      expect(controller().doc).toBeNull();
    });
  });

  it('adopts an uploaded file as a record, dropping the extension', async () => {
    const repo = await makeRepo(newIdbOrigin());
    const deps = makeDeps(repo);
    const { controller } = setup(deps);
    const file = new File(['# Uploaded'], 'notes.md');

    await act(() => controller().readAndLoad(file));

    expect(controller().doc?.name).toBe('notes');
    expect(controller().doc?.text).toBe('# Uploaded');
    expect(deps.toast).toHaveBeenCalledWith('notes.md', 'ok');
    expect(window.location.search).toBe('');
    const records = await repo.list();
    expect(records[0]?.source?.kind).toBe('file');
  });
});
