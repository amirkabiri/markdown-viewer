// Module: features/documents/useDocuments — the React half of the legacy
// document flow (legacy/src/documents.ts + the boot/route halves of
// legacy/src/main.ts): the current document state, the ?file=/?url=/#d=
// routing with query precedence over the hash (the #d= fragment is never
// rewritten so a shared link survives refresh), the recents list over
// mv:recent, and the loading indicator state. Fetching goes through the
// pure lib/documents fetchText with an injectable fetcher for tests.
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';

import { useT } from '../../app/i18n';
import {
  addRecent, fetchText, getRecent, hasShareHash, normalizeGitHubUrl, prettyName,
} from '../../lib/documents';
import type { RecentItem } from '../../lib/documents';
import { shareDecode } from '../../lib/share';
import { MAX_INPUT_BYTES, store, type Doc } from '../../lib/store';

import { WELCOME_MD } from './welcome';

export type ToastKind = 'info' | 'ok' | 'error';

export interface DocumentsDeps {
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
  /** url ?? name — the preview's document-change key. */
  docIdentity: string;
  /** True while a URL load is in flight (loading overlay). */
  loading: boolean;
  /** Recent documents, newest first. */
  recent: RecentItem[];
  /** Initial routing: ?url= → ?file= → #d= → README.md (legacy boot). */
  boot: () => Promise<void>;
  /** popstate routing — reloads only when params or a #d= payload changed. */
  route: () => Promise<void>;
  loadUrl: (rawUrl: string, opts?: LoadOptions) => Promise<boolean>;
  loadFile: (path: string, opts?: LoadOptions) => Promise<boolean>;
  loadShared: () => Promise<boolean>;
  loadWelcome: () => void;
  /** setDoc + clear query params (paste / upload / new document). */
  adoptDocument: (doc: {
    name: string; text: string; url?: string | null; baseUrl?: string | null;
  }) => void;
  /** New-document flow: confirms when the editor has text; false on cancel. */
  newDocument: (editorHasText: boolean) => boolean;
  /** File upload / drag-drop: size-capped, named after the file. */
  readAndLoad: (file: File | null) => Promise<void>;
  /** Paste tab: empty and too-large guards, then adoptDocument. */
  loadPasted: (text: string) => boolean;
}

/** The query string without its leading '?' (legacy paramsString). */
function paramsString(): string {
  return window.location.search.replace(/^\?/, '');
}

export function useDocuments(deps: DocumentsDeps): DocumentsController {
  const t = useT();
  const [doc, setDocState] = useState<Doc | null>(null);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<RecentItem[]>(() => getRecent(store));

  const lastParamsRef = useRef<string | null>(null);
  const lastRoutedHashRef = useRef<string | null>(null);
  const bootedRef = useRef(false);
  const docRef = useRef<Doc | null>(null);

  // Deps and translations are read at call time — the load* callbacks stay
  // stable across renders.
  const depsRef = useRef(deps);
  const tRef = useRef(t);
  useEffect(() => {
    depsRef.current = deps;
    tRef.current = t;
  }, [deps, t]);

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
    depsRef.current.setEditorDocument(full.text);
    if (full.url) setRecent(addRecent(store, { name: full.name, url: full.url }));
  }, []);

  const loadWelcome = useCallback(() => {
    setDoc({ name: tRef.current('welcome'), text: WELCOME_MD, baseUrl: window.location.href });
  }, [setDoc]);

  const loadUrl = useCallback(async (
    rawUrl: string,
    { push = true, fileParam = null }: LoadOptions = {},
  ): Promise<boolean> => {
    const target = normalizeGitHubUrl(rawUrl.trim());
    setLoading(true);
    let ok = false;
    try {
      const text = await fetchText(target, { fetchImpl: depsRef.current.fetchImpl });
      if (new TextEncoder().encode(text).length > MAX_INPUT_BYTES) {
        throw new Error(tRef.current('tooLarge'));
      }
      setDoc({
        name: fileParam ? prettyName(fileParam) : prettyName(target),
        text,
        url: target,
        baseUrl: target,
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
  }, [setDoc, loadWelcome]);

  const loadFile = useCallback(
    (path: string, opts: LoadOptions = {}): Promise<boolean> => loadUrl(
      new URL(path, window.location.href).href,
      { ...opts, fileParam: path },
    ),
    [loadUrl],
  );

  const loadShared = useCallback(async (): Promise<boolean> => {
    if (!hasShareHash(window.location.hash)) return false;
    const decoded = await shareDecode(window.location.hash);
    if (decoded) setDoc({ name: tRef.current('sharedDoc'), text: decoded.text });
    else loadWelcome();
    // Mark the (possibly empty) query as routed so hash-only popstates
    // don't reload. The URL is deliberately NOT rewritten — the fragment
    // must survive a refresh and stay re-shareable.
    lastParamsRef.current = paramsString();
    return true;
  }, [setDoc, loadWelcome]);

  const boot = useCallback(async (): Promise<void> => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const url = params.get('url');
    const file = params.get('file');
    if (url) await loadUrl(url, { push: false });
    else if (file) await loadFile(decodeURIComponent(file), { push: false });
    else if (hasShareHash(window.location.hash)) await loadShared();
    else await loadFile('README.md', { push: false });
    lastRoutedHashRef.current = window.location.hash;
  }, [loadUrl, loadFile, loadShared]);

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
    else await loadFile('README.md', { push: false });
  }, [loadUrl, loadFile, loadShared]);

  const adoptDocument = useCallback((next: {
    name: string; text: string; url?: string | null; baseUrl?: string | null;
  }) => {
    setDoc(next);
    window.history.pushState(null, '', window.location.pathname);
    lastParamsRef.current = null;
  }, [setDoc]);

  const newDocument = useCallback((editorHasText: boolean): boolean => {
    // Legacy parity: window.confirm guards only a non-empty document.
    if (editorHasText) {
      // eslint-disable-next-line no-alert
      if (!window.confirm(tRef.current('newDocConfirm'))) return false;
    }
    window.history.pushState(null, '', window.location.pathname);
    lastParamsRef.current = null;
    setDoc({ name: tRef.current('unnamedDoc'), text: '' });
    return true;
  }, [setDoc]);

  const readAndLoad = useCallback(async (file: File | null): Promise<void> => {
    if (!file) return;
    if (file.size > MAX_INPUT_BYTES) {
      depsRef.current.toast(tRef.current('tooLarge'), 'error');
      return;
    }
    try {
      const text = await file.text();
      adoptDocument({ name: file.name.replace(/\.[^.]+$/, ''), text });
      depsRef.current.toast(file.name, 'ok');
    } catch {
      depsRef.current.toast(tRef.current('loadError'), 'error');
    }
  }, [adoptDocument]);

  const loadPasted = useCallback((text: string): boolean => {
    if (!text.trim()) {
      depsRef.current.toast(tRef.current('loadError'), 'error');
      return false;
    }
    if (new TextEncoder().encode(text).length > MAX_INPUT_BYTES) {
      depsRef.current.toast(tRef.current('tooLarge'), 'error');
      return false;
    }
    adoptDocument({ name: tRef.current('pastedDoc'), text });
    return true;
  }, [adoptDocument]);

  const docIdentity = useMemo(() => (doc ? (doc.url ?? doc.name) : ''), [doc]);

  return {
    doc,
    docIdentity,
    loading,
    recent,
    boot,
    route,
    loadUrl,
    loadFile,
    loadShared,
    loadWelcome,
    adoptDocument,
    newDocument,
    readAndLoad,
    loadPasted,
  };
}
