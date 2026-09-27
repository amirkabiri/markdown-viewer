// Module: state — store (mv:* keys), validated app state, shared helpers, cached DOM refs. Owner of state/store/toast/slugify/detectDir/initDomRefs/updateCounts.

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

/* Hard cap on any document entering the app (10 MB) */
export const MAX_INPUT_BYTES = 10 * 1024 * 1024;

export const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('mv:' + k);
      return v === null ? d : JSON.parse(v);
    } catch { return d; }
  },
  set(k, v) {
    try {
      if (v === null) localStorage.removeItem('mv:' + k);
      else localStorage.setItem('mv:' + k, JSON.stringify(v));
    } catch { /* ignore */ }
  },
};

/* Mutable cross-module routing memo (was module-private `lastParams` in app.js).
   Imported bindings are read-only views, so it lives in a shared object here. */
export const routeState = { lastParams: null };

const RTL_RANGES = [
  [0x0590, 0x05FF], [0x0600, 0x06FF], [0x0700, 0x074F],
  [0x0750, 0x077F], [0xFB50, 0xFDFF], [0xFE70, 0xFEFF],
];

/** Direction of the first strong character in the text. */
export function detectDir(text) {
  for (const ch of (text || '')) {
    if (!/\p{L}/u.test(ch)) continue;
    const c = ch.codePointAt(0);
    if (RTL_RANGES.some(([a, b]) => c >= a && c <= b)) return 'rtl';
    return 'ltr';
  }
  return 'ltr';
}

export const slugify = (s) =>
  s.trim().toLowerCase().replace(/[^\p{L}\p{N}\-_ ]/gu, '').replace(/\s+/g, '-');

/** Stored preferences come from JSON.parse of localStorage — only accept known values. */
export const enumOr = (v, allowed, d) => (allowed.includes(v) ? v : d);

export const state = {
  lang: enumOr(store.get('lang', null), ['fa', 'en'],
    (navigator.language || '').toLowerCase().startsWith('fa') ? 'fa' : 'en'),
  theme: enumOr(store.get('theme', null), ['light', 'dark'],
    matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  dir: enumOr(store.get('dir', null), ['auto', 'ltr', 'rtl'], 'auto'),            // content direction: auto | ltr | rtl
  mode: enumOr(store.get('mode', null), ['editor', 'split', 'preview'], 'split'), // editor | split | preview
  doc: null,                                // {name, text, url, baseUrl}
  renderId: 0,
};

export const BLOCK_SEL = 'p,h1,h2,h3,h4,h5,h6,li,td,th,figcaption,dd,dt,summary,blockquote';

/* Cached DOM element refs — resolved once by initDomRefs() from main.js, before
   untrusted markdown is injected (a document containing e.g. <div id="toc">
   would otherwise shadow them). Never re-query these with $ after boot. */
export let editor;
export let preview;
export let previewScroll;
export let workspace;
export let divider;
export let panel;
export let scrim;
export let openDialog;
export const panelEls = {
  tocSection: null,
  toc: null,
  recentSection: null,
  recentList: null,
};

/** Resolve every cached element ref. Called exactly once, from main.js. */
export function initDomRefs() {
  editor = $('#editor');
  preview = $('#content');
  previewScroll = $('#preview-scroll');
  workspace = $('#workspace');
  divider = $('#divider');
  panel = $('#panel');
  scrim = $('#scrim');
  openDialog = $('#open-dialog');
  panelEls.tocSection = $('#toc-section');
  panelEls.toc = $('#toc');
  panelEls.recentSection = $('#recent-section');
  panelEls.recentList = $('#recent-list');
}

let toastTimer = 0;
export function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 2600);
}

export function updateCounts() {
  const v = editor.value;
  $('#word-count').textContent = ((v.trim().match(/\S+/g)) || []).length.toLocaleString(state.lang === 'fa' ? 'fa-IR' : 'en-US');
  $('#char-count').textContent = v.length.toLocaleString(state.lang === 'fa' ? 'fa-IR' : 'en-US');
}
