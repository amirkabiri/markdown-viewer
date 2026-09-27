// Module: documents — URL/file loading, recents. Owner of loadUrl/setDoc/recent logic.
import { $, state, store, routeState, editor, previewScroll, panelEls, MAX_INPUT_BYTES, updateCounts, toast } from './state.js';
import { t, registerI18n } from './i18n.js';
import { renderPreview, scrollToHash } from './markdown.js';
import { closePanel, showLoading, hideLoading } from './ui.js';

registerI18n({
  loadError: { en: 'Could not load document', fa: 'بارگیری سند ممکن نشد' },
  tooLarge: { en: 'Document is too large (limit 10 MB)', fa: 'حجم سند بیش از حد مجاز است (حداکثر ۱۰ مگابایت)' },
  welcome: { en: 'Welcome', fa: 'خوش آمدید' },
  pastedDoc: { en: 'Pasted document', fa: 'سند جای‌گذاری‌شده' },
  unnamedDoc: { en: 'Untitled', fa: 'بی‌نام' },
});

export interface RecentItem {
  name: string;
  url: string;
}

export async function fetchText(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Convert github.com blob/raw links to raw.githubusercontent.com. */
export function normalizeGitHubUrl(u: string): string {
  try {
    const url = new URL(u, location.href);
    if (/(^|\.)github\.com$/i.test(url.hostname)) {
      const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/([^/]+)\/(.+)$/);
      if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
    }
    return url.href;
  } catch { return u; }
}

export function prettyName(u: string, base = location.href): string {
  try {
    const last = decodeURIComponent(new URL(u, base).pathname.split('/').filter(Boolean).pop() || '');
    return last.replace(/\.(md|markdown|mdx|txt)$/i, '') || 'document';
  } catch { return 'document'; }
}

export function setDoc({ name, text, url = null, baseUrl = null }: { name: string; text: string; url?: string | null; baseUrl?: string | null }): Promise<void> {
  state.doc = { name, text, url, baseUrl: baseUrl || url || location.href };
  $('#doc-name')!.textContent = name;
  editor.value = text;
  updateCounts();
  previewScroll.scrollTop = 0;
  if (url) addRecent({ name, url });
  return renderPreview();
}

export function paramsString(): string { return location.search.replace(/^\?/, ''); }

export interface LoadOptions {
  push?: boolean;
  fileParam?: string | null;
}

export async function loadUrl(rawUrl: string, { push = true, fileParam = null }: LoadOptions = {}): Promise<boolean> {
  const target = normalizeGitHubUrl(rawUrl.trim());
  showLoading();
  let ok = false;
  try {
    const text = await fetchText(target);
    if (new TextEncoder().encode(text).length > MAX_INPUT_BYTES) throw new Error(t('tooLarge'));
    await setDoc({ name: fileParam ? prettyName(fileParam) : prettyName(target), text, url: target, baseUrl: target });
    ok = true;
  } catch (err) {
    toast(`${t('loadError')}: ${(err instanceof Error && err.message) || String(err)}`, 'error');
  } finally {
    hideLoading();
  }
  if (ok) {
    routeState.lastParams = fileParam ? `file=${encodeURIComponent(fileParam)}` : `url=${encodeURIComponent(target)}`;
    if (push) {
      history.pushState(null, '', location.pathname + (routeState.lastParams ? '?' + routeState.lastParams : ''));
    }
    scrollToHash();
  }
  if (!ok && !state.doc) loadWelcome();
  return ok;
}

export const loadFile = (path: string, opts: LoadOptions = {}): Promise<boolean> =>
  loadUrl(new URL(path, location.href).href, { ...opts, fileParam: path });

export function loadWelcome(): void {
  const md = $('#welcome-md')!.textContent ?? '';
  setDoc({ name: t('welcome'), text: md, baseUrl: location.href });
}

/* ---------------- recent documents ---------------- */

export function addRecent(item: RecentItem): void {
  let list = store.get<RecentItem[]>('recent', []);
  list = [item, ...list.filter((x) => x.url !== item.url)].slice(0, 8);
  store.set('recent', list);
  renderRecent();
}

export function renderRecent(): void {
  const list = store.get<RecentItem[]>('recent', []);
  panelEls.recentSection.hidden = !list.length;
  const holder = panelEls.recentList;
  holder.innerHTML = '';
  list.forEach((r) => {
    const a = document.createElement('a');
    a.className = 'side-link';
    a.href = r.url;
    a.textContent = r.name;
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      closePanel();
      loadUrl(r.url);
    });
    holder.appendChild(a);
  });
}
