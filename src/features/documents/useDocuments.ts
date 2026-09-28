// Module: features/documents/useDocuments — the repository-backed document
// controller (the React half of legacy/src/documents.ts + the boot/route
// halves of legacy/src/main.ts, re-imagined over src/lib/persistence):
//
//   EVERY document the app shows is a DocumentRecord in the repository —
//   ?url=/?file= loads dedupe on the source URL (a re-load UPDATES the
//   existing record), #d= shares, uploads, pastes and new documents create
//   records with the right source metadata. The active document id persists
//   under mv:active-doc and is restored on boot (after the one-shot legacy
//   migration the provider already ran); a plain boot with no active pointer
//   loads README.md like the legacy boot doc, reusing its record.
//
//   Sessions: selecting a document opens a repository session — 'edit' while
//   this tab holds the lock, 'readonly' with a takeover affordance otherwise.
//   A 'stolen' event flips the session readonly and toasts "Saved a copy"
//   when the dirty buffer was preserved as a copy record. Editor changes
//   autosave through saveActiveContent → repo.saveContent (the repository
//   debounces; readonly sessions and unknown ids no-op inside it).
//
//   The sidebar list is live: repo.onChange (local AND remote:true events)
//   re-reads list(); when the ACTIVE document disappears (removed in either
//   tab) the session falls back to the most recently updated record, or the
//   embedded welcome doc when none remain.
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';

import { useT } from '../../app/i18n';
import type {
  DocumentRecord, DocumentRepository, DocumentSession, DocumentSource,
} from '../../lib/persistence';
import {
  fetchText, hasShareHash, normalizeGitHubUrl, prettyName,
} from '../../lib/documents';
import { shareDecode } from '../../lib/share';
import { MAX_INPUT_BYTES, store, type Doc } from '../../lib/store';

import WELCOME_MD from './welcome';

export type ToastKind = 'info' | 'ok' | 'error';

/** The mv:-store key of the persisted active-document pointer. */
export const ACTIVE_DOC_KEY = 'active-doc';

/** The mv:-store key of the synchronous last-change snapshot (see below). */
export const DRAFT_KEY = 'doc-draft';

/**
 * The unload-draft snapshot: browsers discard in-flight IndexedDB writes at
 * pagehide, so changes inside the last autosave window are mirrored to the
 * synchronous mv: store on unload and re-adopted at boot (when newer than the
 * stored revision of the same document). `at` is the change's wall clock.
 */
interface Draft {
  id: string;
  text: string;
  at: number;
}

export interface DocumentsDeps {
  /** The tab's repository (null while the provider is still booting). */
  repo: DocumentRepository | null;
  /** Puts a loaded document's text into the editor (legacy editor.value =). */
  setEditorDocument: (text: string) => void;
  /** Transient message reporting (legacy toast). */
  toast: (message: string, kind?: ToastKind) => void;
  /** Injectable fetcher — tests pass a fake; production uses global fetch. */
  fetchImpl?: typeof fetch;
}

export interface LoadOptions {
  push?: boolean;
  fileParam?: string | null;
}

export interface DocumentsController {
  /** The current document (null until boot loads one). */
  doc: Doc | null;
  /** The active record id, or '' — the preview's document-change key. */
  docIdentity: string;
  /** True while a URL load is in flight (loading overlay). */
  loading: boolean;
  /** All persisted records, live, in repository (sortIndex) order. */
  docs: DocumentRecord[];
  /** The active record's id (null on the ephemeral welcome doc). */
  activeId: string | null;
  /** The active session's mode — readonly drives the banner + readOnly editor. */
  activeMode: 'edit' | 'readonly' | null;
  /** Initial routing: ?url= → ?file= → #d= → active-doc → README (legacy boot). */
  boot: () => Promise<void>;
  /** popstate routing — reloads only when params or a #d= payload changed. */
  route: () => Promise<void>;
  loadUrl: (rawUrl: string, opts?: LoadOptions) => Promise<boolean>;
  loadFile: (path: string, opts?: LoadOptions) => Promise<boolean>;
  loadShared: () => Promise<boolean>;
  loadWelcome: () => void;
  /** Creates an empty record and opens it (the old doc is saved — no confirm). */
  newDocument: () => Promise<boolean>;
  selectDocument: (id: string) => Promise<void>;
  removeDocument: (id: string) => Promise<void>;
  renameDocument: (id: string, name: string) => Promise<void>;
  reorderDocuments: (orderedIds: string[]) => Promise<void>;
  /** Steals the active document's lock from the other tab. */
  takeoverActive: () => Promise<void>;
  /** File upload / drag-drop: size-capped, named after the file. */
  readAndLoad: (file: File | null) => Promise<void>;
  /** Paste tab: empty and too-large guards, then a new record. */
  loadPasted: (text: string) => boolean;
  /** The autosave entry: persists the editor text for the active document. */
  saveActiveContent: (text: string) => void;
}

/** The query string without its leading '?' (legacy paramsString). */
function paramsString(): string {
  return window.location.search.replace(/^\?/, '');
}

/** The most recently updated record of a list, or null when empty. */
function mostRecent(records: DocumentRecord[]): DocumentRecord | null {
  return records.reduce<DocumentRecord | null>(
    (best, record) => (best === null || record.updatedAt >= best.updatedAt ? record : best),
    null,
  );
}

export function useDocuments(deps: DocumentsDeps): DocumentsController {
  const t = useT();
  const { repo } = deps;
  const [doc, setDocState] = useState<Doc | null>(null);
  const [loading, setLoading] = useState(false);
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [activeMode, setSessionMode] = useState<'edit' | 'readonly' | null>(null);

  const lastParamsRef = useRef<string | null>(null);
  const lastRoutedHashRef = useRef<string | null>(null);
  const bootedRef = useRef(false);
  const docRef = useRef<Doc | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const activeModeRef = useRef<'edit' | 'readonly' | null>(null);
  const sessionRef = useRef<DocumentSession | null>(null);
  const offStolenRef = useRef<(() => void) | null>(null);
  const lastChangeRef = useRef<Draft | null>(null);

  // Deps and translations are read at call time — the load* callbacks stay
  // stable across renders.
  const depsRef = useRef(deps);
  const tRef = useRef(t);
  useEffect(() => {
    depsRef.current = deps;
    tRef.current = t;
  }, [deps, t]);
  useEffect(() => {
    activeModeRef.current = activeMode;
  }, [activeMode]);

  const setActiveId = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveIdState(id);
    store.set(ACTIVE_DOC_KEY, id);
  }, []);

  const setDoc = useCallback((next: {
    name: string; text: string; url?: string | null; baseUrl?: string | null;
  }) => {
    const full: Doc = {
      name: next.name,
      text: next.text,
      url: next.url ?? null,
      baseUrl: next.baseUrl || next.url || window.location.href,
    };
    docRef.current = full;
    setDocState(full);
  }, []);

  /** Release the current session (and its stolen listener), if any. */
  const dropSession = useCallback(() => {
    offStolenRef.current?.();
    offStolenRef.current = null;
    sessionRef.current?.release();
    sessionRef.current = null;
  }, []);

  const setDocFromRecord = useCallback((record: DocumentRecord, text: string) => {
    setDoc({
      name: record.name,
      text,
      url: record.source?.url ?? null,
      baseUrl: record.source?.url ?? null,
    });
  }, [setDoc]);

  const loadWelcome = useCallback(() => {
    dropSession();
    setActiveId(null);
    setSessionMode(null);
    setDoc({ name: tRef.current('welcome'), text: WELCOME_MD, baseUrl: window.location.href });
    depsRef.current.setEditorDocument(WELCOME_MD);
  }, [dropSession, setActiveId, setDoc]);

  /**
   * Adopt an open session: wire the stolen event, point the editor at the
   * record, publish it as active. `text` (when given) is the freshly loaded
   * content — saved only in 'edit' mode (a readonly tab keeps stored text).
   */
  const adoptSession = useCallback((
    session: DocumentSession,
    record: DocumentRecord,
    text?: string,
  ) => {
    offStolenRef.current?.();
    offStolenRef.current = session.onEvent((event) => {
      if (event.type !== 'stolen') return;
      setSessionMode('readonly');
      if (event.copyId) depsRef.current.toast(tRef.current('docCopied'));
      // The preserved copy lands in the list through the onChange fan-out.
    });

    let editorText = record.content;
    if (text !== undefined && text !== record.content && session.mode === 'edit') {
      depsRef.current.repo?.saveContent(record.id, text);
      editorText = text;
    }
    // Unload-draft recovery: the browser discards in-flight IndexedDB writes
    // during pagehide, so the synchronous mv:doc-draft snapshot is the source
    // of truth for changes made inside the last debounce window. Adopted only
    // when it is NEWER than the stored revision of the SAME document.
    const draft = store.get<Draft | null>(DRAFT_KEY, null);
    store.set(DRAFT_KEY, null);
    if (
      draft !== null
      && draft.id === record.id
      && draft.at >= record.updatedAt
      && draft.text !== editorText
      && session.mode === 'edit'
    ) {
      depsRef.current.repo?.saveContent(record.id, draft.text);
      editorText = draft.text;
    }
    setActiveId(record.id);
    setSessionMode(session.mode);
    setDocFromRecord(record, editorText);
    depsRef.current.setEditorDocument(editorText);
  }, [setActiveId, setDocFromRecord]);

  /**
   * Open (or switch to) a document session, releasing the previous one FIRST
   * — Web Locks would deny a same-tab re-acquire, downgrading us to readonly
   * against ourselves. When `content` is given, the record is updated with it
   * (the URL re-load dedupe path).
   */
  const openDocument = useCallback(async (id: string, content?: string): Promise<void> => {
    if (!repo) return;
    dropSession();
    const session = await repo.openDocument(id);
    const record = await repo.get(id);
    if (!record) {
      // Removed remotely in the gap between list and open.
      session.release();
      return;
    }
    sessionRef.current = session;
    adoptSession(session, record, content);
  }, [adoptSession, dropSession, repo]);

  /** Fetch-or-create, then open: the shared tail of every load* flow. */
  const openContent = useCallback(async (input: {
    id: string | null;
    name: string;
    text: string;
    source: DocumentSource | undefined;
  }): Promise<void> => {
    if (!repo) return;
    if (input.id) {
      const existing = await repo.get(input.id);
      if (existing) {
        await openDocument(input.id, input.text);
        return;
      }
    }
    const created = await repo.create({
      name: input.name,
      content: input.text,
      ...(input.source ? { source: input.source } : {}),
    });
    await openDocument(created.id);
  }, [openDocument, repo]);

  /* ---------------- live list + active-document watch ---------------- */

  useEffect(() => {
    if (!repo) return undefined;
    let cancelled = false;
    const swallow = (): void => {};

    const refresh = async (remote: boolean, ids: string[]): Promise<void> => {
      const list = await repo.list();
      if (cancelled) return;
      setDocs(list);

      const active = activeIdRef.current;
      if (active && !list.some((record) => record.id === active)) {
        // The active document was removed (here or in another tab): fall back
        // to the most recent remaining record, or the welcome doc.
        const next = mostRecent(list);
        if (next) await openDocument(next.id);
        else loadWelcome();
        return;
      }
      // A remote update to the ACTIVE document: adopt its new name always,
      // and its content too when we are only reading (the other tab saved
      // under its own lock — impossible while we hold the lock ourselves).
      if (remote && active && ids.includes(active)) {
        const fresh = await repo.get(active);
        if (cancelled || !fresh) return;
        setDocState((prev) => (
          prev && prev.name !== fresh.name ? { ...prev, name: fresh.name } : prev
        ));
        if (activeModeRef.current === 'readonly') {
          setDocFromRecord(fresh, fresh.content);
          depsRef.current.setEditorDocument(fresh.content);
        }
      }
    };

    const off = repo.onChange((event) => {
      refresh(event.remote, event.ids).catch(swallow);
    });
    refresh(false, []).catch(swallow);
    return () => {
      cancelled = true;
      off();
    };
  }, [repo, loadWelcome, openDocument, setDocFromRecord]);

  /* ---------------- routing (legacy boot/route, record-backed) ---------------- */

  const loadUrl = useCallback(async (
    rawUrl: string,
    { push = true, fileParam = null }: LoadOptions = {},
  ): Promise<boolean> => {
    if (!repo) return false;
    const target = normalizeGitHubUrl(rawUrl.trim());
    setLoading(true);
    let ok = false;
    try {
      const text = await fetchText(target, { fetchImpl: depsRef.current.fetchImpl });
      if (new TextEncoder().encode(text).length > MAX_INPUT_BYTES) {
        throw new Error(tRef.current('tooLarge'));
      }
      // Dedupe re-loads of the same URL: update the existing record.
      const existing = (await repo.list()).find(
        (record) => record.source?.kind === 'url' && record.source.url === target,
      );
      await openContent({
        id: existing?.id ?? null,
        name: fileParam ? prettyName(fileParam) : prettyName(target),
        text,
        source: { kind: 'url', url: target },
      });
      ok = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      depsRef.current.toast(`${tRef.current('loadError')}: ${message}`, 'error');
    } finally {
      setLoading(false);
    }
    if (ok) {
      lastParamsRef.current = fileParam
        ? `file=${encodeURIComponent(fileParam)}`
        : `url=${encodeURIComponent(target)}`;
      if (push) {
        window.history.pushState(
          null,
          '',
          window.location.pathname + (lastParamsRef.current ? `?${lastParamsRef.current}` : ''),
        );
      }
    }
    if (!ok && !docRef.current) loadWelcome();
    return ok;
  }, [loadWelcome, openContent, repo]);

  const loadFile = useCallback(
    (path: string, opts: LoadOptions = {}): Promise<boolean> => loadUrl(
      new URL(path, window.location.href).href,
      { ...opts, fileParam: path },
    ),
    [loadUrl],
  );

  const loadShared = useCallback(async (): Promise<boolean> => {
    if (!repo || !hasShareHash(window.location.hash)) return false;
    const decoded = await shareDecode(window.location.hash);
    if (decoded) {
      await openContent({
        id: null,
        name: tRef.current('sharedDoc'),
        text: decoded.text,
        source: { kind: 'share' },
      });
    } else {
      loadWelcome();
    }
    // Mark the (possibly empty) query as routed so hash-only popstates
    // don't reload. The URL is deliberately NOT rewritten — the fragment
    // must survive a refresh and stay re-shareable.
    lastParamsRef.current = paramsString();
    return true;
  }, [loadWelcome, openContent, repo]);

  /** Restore the persisted active pointer, else boot README (legacy boot doc). */
  const restoreActive = useCallback(async (): Promise<void> => {
    if (!repo) return;
    const stored = store.get<string | null>(ACTIVE_DOC_KEY, null);
    if (stored && (await repo.get(stored))) {
      await openDocument(stored);
      return;
    }
    if (stored) store.set(ACTIVE_DOC_KEY, null); // stale pointer (removed elsewhere)
    await loadFile('README.md', { push: false });
  }, [loadFile, openDocument, repo]);

  const boot = useCallback(async (): Promise<void> => {
    if (bootedRef.current || !depsRef.current.repo) return;
    bootedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const url = params.get('url');
    const file = params.get('file');
    if (url) await loadUrl(url, { push: false });
    else if (file) await loadFile(decodeURIComponent(file), { push: false });
    else if (hasShareHash(window.location.hash)) await loadShared();
    else await restoreActive();
    lastRoutedHashRef.current = window.location.hash;
  }, [loadUrl, loadFile, loadShared, restoreActive]);

  const route = useCallback(async (): Promise<void> => {
    const p = paramsString();
    const { hash } = window.location;
    const paramsChanged = p !== lastParamsRef.current;
    const shareChanged = hash.startsWith('#d=') && hash !== lastRoutedHashRef.current;
    if (!paramsChanged && !shareChanged) return;
    lastRoutedHashRef.current = hash;
    const params = new URLSearchParams(p);
    const url = params.get('url');
    const file = params.get('file');
    if (url) await loadUrl(url, { push: false });
    else if (file) await loadFile(file, { push: false });
    else if (hasShareHash(hash)) await loadShared();
    else await restoreActive();
  }, [loadUrl, loadFile, loadShared, restoreActive]);

  /* ---------------- document management ---------------- */

  const selectDocument = useCallback(async (id: string): Promise<void> => {
    await openDocument(id);
  }, [openDocument]);

  const newDocument = useCallback(async (): Promise<boolean> => {
    if (!repo) return false;
    // No data-loss confirm: the previous document is already persisted.
    const created = await repo.create({ name: tRef.current('unnamedDoc'), content: '' });
    await openDocument(created.id);
    window.history.pushState(null, '', window.location.pathname);
    lastParamsRef.current = null;
    return true;
  }, [openDocument, repo]);

  const removeDocument = useCallback(async (id: string): Promise<void> => {
    if (!repo) return;
    await repo.remove(id);
    if (activeIdRef.current === id) {
      // The session died with the record; the live-list handler above picks
      // the fallback document the moment the removal commits.
      dropSession();
      setActiveId(null);
      setSessionMode(null);
    }
  }, [dropSession, setActiveId, repo]);

  const renameDocument = useCallback(async (id: string, name: string): Promise<void> => {
    if (!repo) return;
    await repo.rename(id, name);
    if (activeIdRef.current === id) {
      setDocState((prev) => (prev ? { ...prev, name } : prev));
    }
  }, [repo]);

  const reorderDocuments = useCallback(async (orderedIds: string[]): Promise<void> => {
    if (!repo) return;
    await repo.reorder(orderedIds);
    setDocs(await repo.list());
  }, [repo]);

  const takeoverActive = useCallback(async (): Promise<void> => {
    const session = sessionRef.current;
    if (!session) return;
    await session.takeover();
    setSessionMode(session.mode);
  }, []);

  const readAndLoad = useCallback(async (file: File | null): Promise<void> => {
    if (!file) return;
    if (file.size > MAX_INPUT_BYTES) {
      depsRef.current.toast(tRef.current('tooLarge'), 'error');
      return;
    }
    try {
      const text = await file.text();
      await openContent({
        id: null,
        name: file.name.replace(/\.[^.]+$/, ''),
        text,
        source: { kind: 'file' },
      });
      window.history.pushState(null, '', window.location.pathname);
      lastParamsRef.current = null;
      depsRef.current.toast(file.name, 'ok');
    } catch {
      depsRef.current.toast(tRef.current('loadError'), 'error');
    }
  }, [openContent]);

  const loadPasted = useCallback((text: string): boolean => {
    if (!text.trim()) {
      depsRef.current.toast(tRef.current('loadError'), 'error');
      return false;
    }
    if (new TextEncoder().encode(text).length > MAX_INPUT_BYTES) {
      depsRef.current.toast(tRef.current('tooLarge'), 'error');
      return false;
    }
    // The repository work is async; the sync boolean only answers the guards
    // (the Open dialog closes on true).
    openContent({
      id: null,
      name: tRef.current('pastedDoc'),
      text,
      source: { kind: 'local' },
    })
      .then(() => {
        window.history.pushState(null, '', window.location.pathname);
        lastParamsRef.current = null;
      })
      .catch(() => depsRef.current.toast(tRef.current('loadError'), 'error'));
    return true;
  }, [openContent]);

  /** The autosave entry — the repository debounces + guards readonly/unknown. */
  const saveActiveContent = useCallback((text: string): void => {
    const id = activeIdRef.current;
    if (repo && id) {
      repo.saveContent(id, text);
      lastChangeRef.current = { id, text, at: Date.now() };
    }
  }, [repo]);

  /* Unload-draft: mirror the last change synchronously when the tab is going
     away (IndexedDB writes do not survive pagehide — see Draft). */
  useEffect(() => {
    const writeDraft = (): void => {
      const change = lastChangeRef.current;
      const id = activeIdRef.current;
      if (change && id && change.id === id) store.set(DRAFT_KEY, change);
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') writeDraft();
    };
    window.addEventListener('pagehide', writeDraft);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', writeDraft);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  /* Session release on teardown (the repository dispose covers the rest). */
  useEffect(() => () => {
    dropSession();
  }, [dropSession]);

  const docIdentity = useMemo(() => (activeId ?? ''), [activeId]);

  return {
    doc,
    docIdentity,
    loading,
    docs,
    activeId,
    activeMode,
    boot,
    route,
    loadUrl,
    loadFile,
    loadShared,
    loadWelcome,
    newDocument,
    selectDocument,
    removeDocument,
    renameDocument,
    reorderDocuments,
    takeoverActive,
    readAndLoad,
    loadPasted,
    saveActiveContent,
  };
}
