// Module: state — store (mv:* keys), validated app state, shared helpers, cached DOM refs. Owner of state/store/toast/slugify/detectDir/initDomRefs/updateCounts.

export const $ = <E extends Element = HTMLElement>(sel: string, el: ParentNode = document): E | null =>
  el.querySelector<E>(sel);
export const $$ = <E extends Element = HTMLElement>(sel: string, el: ParentNode = document): E[] =>
  [...el.querySelectorAll<E>(sel)];

/* Hard cap on any document entering the app (10 MB) */
export const MAX_INPUT_BYTES = 10 * 1024 * 1024;

export const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem('mv:' + k);
      return v === null ? d : JSON.parse(v) as T;
    } catch { return d; }
  },
  set(k: string, v: unknown): void {
    try {
      if (v === null) localStorage.removeItem('mv:' + k);
      else localStorage.setItem('mv:' + k, JSON.stringify(v));
    } catch { /* ignore */ }
  },
};

/* Mutable cross-module routing memo (was module-private `lastParams` in app.js).
   Imported bindings are read-only views, so it lives in a shared object here. */
export const routeState: { lastParams: string | null } = { lastParams: null };

const RTL_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0590, 0x05FF], [0x0600, 0x06FF], [0x0700, 0x074F],
  [0x0750, 0x077F], [0xFB50, 0xFDFF], [0xFE70, 0xFEFF],
];

/** Direction of the first strong character in the text. */
export function detectDir(text: string): 'rtl' | 'ltr' {
  for (const ch of (text || '')) {
    if (!/\p{L}/u.test(ch)) continue;
    const c = ch.codePointAt(0)!;
    if (RTL_RANGES.some(([a, b]) => c >= a && c <= b)) return 'rtl';
    return 'ltr';
  }
  return 'ltr';
}

export const slugify = (s: string): string =>
  s.trim().toLowerCase().replace(/[^\p{L}\p{N}\-_ ]/gu, '').replace(/\s+/g, '-');

/** Stored preferences come from JSON.parse of localStorage — only accept known values. */
export const enumOr = <T extends string>(v: unknown, allowed: readonly T[], d: T): T =>
  ((allowed as readonly unknown[]).includes(v) ? (v as T) : d);

export type Lang = 'fa' | 'en';
export type Theme = 'light' | 'dark';
export type ContentDir = 'auto' | 'ltr' | 'rtl';
export type PaneMode = 'editor' | 'split' | 'preview';

export interface Doc {
  name: string;
  text: string;
  url: string | null;
  baseUrl: string;
}

export const state = {
  lang: enumOr<Lang>(store.get<Lang | null>('lang', null), ['fa', 'en'],
    (navigator.language || '').toLowerCase().startsWith('fa') ? 'fa' : 'en'),
  theme: enumOr<Theme>(store.get<Theme | null>('theme', null), ['light', 'dark'],
    matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  dir: enumOr<ContentDir>(store.get<ContentDir | null>('dir', null), ['auto', 'ltr', 'rtl'], 'auto'), // content direction: auto | ltr | rtl
  mode: enumOr<PaneMode>(store.get<PaneMode | null>('mode', null), ['editor', 'split', 'preview'], 'split'), // editor | split | preview
  doc: null as Doc | null,                  // {name, text, url, baseUrl}
  renderId: 0,
};

export const BLOCK_SEL = 'p,h1,h2,h3,h4,h5,h6,li,td,th,figcaption,dd,dt,summary,blockquote';

/* Cached DOM element refs — resolved once by initDomRefs() from main.ts, before
   untrusted markdown is injected (a document containing e.g. <div id="toc">
   would otherwise shadow them). Never re-query these with $ after boot.
   The definite-assignment assertions encode that contract. */
export let editor!: HTMLTextAreaElement;
export let preview!: HTMLElement;
export let previewScroll!: HTMLElement;
export let workspace!: HTMLElement;
export let divider!: HTMLElement;
export let panel!: HTMLElement;
export let scrim!: HTMLElement;
export let openDialog!: HTMLDialogElement;
export const panelEls: {
  tocSection: HTMLElement;
  toc: HTMLElement;
  recentSection: HTMLElement;
  recentList: HTMLElement;
} = {
  tocSection: null!,
  toc: null!,
  recentSection: null!,
  recentList: null!,
};

/** Resolve every cached element ref. Called exactly once, from main.ts. */
export function initDomRefs(): void {
  editor = $<HTMLTextAreaElement>('#editor')!;
  preview = $('#content')!;
  previewScroll = $('#preview-scroll')!;
  workspace = $('#workspace')!;
  divider = $('#divider')!;
  panel = $('#panel')!;
  scrim = $('#scrim')!;
  openDialog = $<HTMLDialogElement>('#open-dialog')!;
  panelEls.tocSection = $('#toc-section')!;
  panelEls.toc = $('#toc')!;
  panelEls.recentSection = $('#recent-section')!;
  panelEls.recentList = $('#recent-list')!;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string, kind = ''): void {
  const el = $('#toast')!;
  el.textContent = msg;
  el.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 2600);
}

export function updateCounts(): void {
  const v = editor.value;
  $('#word-count')!.textContent = ((v.trim().match(/\S+/g)) || []).length.toLocaleString(state.lang === 'fa' ? 'fa-IR' : 'en-US');
  $('#char-count')!.textContent = v.length.toLocaleString(state.lang === 'fa' ? 'fa-IR' : 'en-US');
}
