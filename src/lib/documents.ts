// Module: lib/documents — the PURE halves of the document-loading flow.
// Owner of normalizeGitHubUrl (github blob/raw → raw.githubusercontent),
// prettyName, fetchText (20 s abort timeout, HTTP-status errors, injectable
// fetcher), the #d= share-hash check, and the recent-documents ops over the
// mv:* store (key 'recent', cap 8 — identical to legacy). The DOM halves —
// setDoc/loadUrl/loadFile/loadWelcome, the loading indicator, hash routing
// and renderRecent — stay in legacy/src/documents.ts for the UI agents to
// re-imagine as React effects. i18n keys (loadError/tooLarge/welcome/
// pastedDoc/unnamedDoc) live in src/i18n/dictionaries.ts. Legacy twin:
// legacy/src/documents.ts.

import type { MvStore } from './store';

export interface RecentItem {
  name: string;
  url: string;
}

/** Recent-documents cap (identical to legacy). */
export const MAX_RECENT = 8;

/** Abort a stalled download after this long (identical to legacy). */
export const FETCH_TIMEOUT_MS = 20000;

export interface FetchTextOptions {
  /** Abort a stalled download after this long. */
  timeoutMs?: number;
  /** Injectable fetcher — tests pass a fake; production uses global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Downloads a document: `fetch` with a hard abort timeout, then `HTTP <status>`
 * errors for non-OK responses and the body text for OK ones. Identical to the
 * legacy fetchText, plus the injectable fetcher/timeout for tests.
 */
export async function fetchText(url: string, opts: FetchTextOptions = {}): Promise<string> {
  const doFetch = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? FETCH_TIMEOUT_MS);
  try {
    const res = await doFetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Convert github.com blob/raw links to raw.githubusercontent.com. Relative
 * URLs resolve against `base` (default: the current page, like legacy).
 * Anything unparseable comes back unchanged — never throws.
 */
export function normalizeGitHubUrl(u: string, base?: string): string {
  try {
    const url = new URL(u, base ?? window.location.href);
    if (/(^|\.)github\.com$/i.test(url.hostname)) {
      const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/([^/]+)\/(.+)$/);
      if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
    }
    return url.href;
  } catch {
    return u;
  }
}

/**
 * The human-facing document name for a URL: the last decoded path segment,
 * minus the markdown/text extension, or 'document' when nothing survives.
 * Relative URLs resolve against `base` (default: the current page, like
 * legacy). Never throws.
 */
export function prettyName(u: string, base?: string): string {
  try {
    const last = decodeURIComponent(new URL(u, base ?? window.location.href).pathname.split('/').filter(Boolean).pop() || '');
    return last.replace(/\.(md|markdown|mdx|txt)$/i, '') || 'document';
  } catch {
    return 'document';
  }
}

/**
 * True when a location hash carries a self-contained share payload (`#d=…`).
 * Callers pass `window.location.hash` — the pure module never reads globals.
 */
export function hasShareHash(hash: string): boolean {
  return hash.startsWith('#d=');
}

/* ---------------- recent documents (mv:recent) ---------------- */

/** The stored recents, newest first ([] when none are stored). */
export function getRecent(store: MvStore): RecentItem[] {
  return store.get<RecentItem[]>('recent', []);
}

/**
 * Moves `item` to the front (deduped by URL) and persists the list under
 * `mv:recent`, returning the new list. The legacy DOM refresh (renderRecent)
 * is the React layer's reaction to the store change.
 */
export function addRecent(store: MvStore, item: RecentItem): RecentItem[] {
  const list = [item, ...getRecent(store).filter((x) => x.url !== item.url)].slice(0, MAX_RECENT);
  store.set('recent', list);
  return list;
}
