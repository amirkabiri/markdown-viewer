// Module: ui — TOC + scroll spy, slide-over panel, open + share dialogs, topbar handlers, drag & drop. Owner of bindUI/bindDrop/buildToc/updateSpy/applyTheme and the share dialog.
import { $, $$, state, store, routeState, editor, preview, previewScroll, panel, scrim, openDialog, panelEls, MAX_INPUT_BYTES, toast } from './state.js';
import type { PaneMode } from './state.js';
import { t, setLang } from './i18n.js';
import { renderPreview } from './markdown.js';
import { setDoc, loadUrl, loadFile } from './documents.js';
import { setPaneMode, applyDir } from './workspace.js';
import { shareEncode } from './share.js';
import hljsLightCss from '../style/hljs/github.css?raw';
import hljsDarkCss from '../style/hljs/github-dark.css?raw';

/* Vendored highlight.js themes (trust-on-commit, no SRI). Vite hashes <link>
   CSS assets referenced from index.html, so the original swap-the-href
   approach cannot address the dark theme in a production build — both themes
   are instead bundled as strings and swapped via a <style> tag (see
   applyTheme). The #hljs-theme <link> in index.html stays as the pre-JS light
   default. */
const HLJS_STYLES = {
  light: hljsLightCss,
  dark: hljsDarkCss,
};

export function applyTheme(): void {
  document.documentElement.dataset.theme = state.theme;
  $<HTMLMetaElement>('meta[name="theme-color"]')!.content = state.theme === 'dark' ? '#0d1117' : '#0969da';
  let styleEl = document.getElementById('hljs-theme-inline') as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'hljs-theme-inline';
    document.head.appendChild(styleEl); // appended after the bundled <link> so it wins the cascade
  }
  styleEl.textContent = HLJS_STYLES[state.theme] || HLJS_STYLES.light;
}

/* ---------------- loading overlay ---------------- */

export function showLoading(): void { $('#loading')!.hidden = false; }
export function hideLoading(): void { $('#loading')!.hidden = true; }

/* ---------------- table of contents + scroll spy ---------------- */

export function buildToc(headings: HTMLElement[]): void {
  const toc = panelEls.toc;
  const section = panelEls.tocSection;
  if (!headings.length) {
    section.hidden = true;
    toc.innerHTML = '';
    return;
  }
  section.hidden = false;
  const min = Math.min(...[...headings].map((h) => +h.tagName[1]));
  toc.innerHTML = '';
  headings.forEach((h) => {
    const a = document.createElement('a');
    a.className = `toc-link toc-l${Math.min(3, +h.tagName[1] - min + 1)}`;
    a.href = '#' + h.id;
    const clone = h.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.heading-anchor').forEach((x) => x.remove());
    a.textContent = clone.textContent;
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      closePanel();
      h.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    toc.appendChild(a);
  });
}

export function updateSpy(): void {
  const links = $$('.toc-link', panelEls.toc);
  if (!links.length) return;
  const heads = $$('h2,h3,h4', preview);
  const top = previewScroll.getBoundingClientRect().top;
  let current = 0;
  heads.forEach((h, i) => {
    if (h.getBoundingClientRect().top - top <= 90) current = i;
  });
  links.forEach((l, i) => l.classList.toggle('active', i === current));
}

/* ---------------- panel / dialog / buttons ---------------- */

export function openPanel(): void { panel.classList.add('open'); scrim.hidden = false; $('#panel-btn')!.setAttribute('aria-expanded', 'true'); }
export function closePanel(): void { panel.classList.remove('open'); scrim.hidden = true; $('#panel-btn')!.setAttribute('aria-expanded', 'false'); }

export function openLoadDialog(): void {
  activateTab('url');
  openDialog.showModal();
  setTimeout(() => $<HTMLInputElement>('#url-input')!.focus(), 50);
}

export function activateTab(name: string): void {
  $$('.tab', openDialog).forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $('#panel-url')!.hidden = name !== 'url';
  $('#panel-upload')!.hidden = name !== 'upload';
  $('#panel-paste')!.hidden = name !== 'paste';
}

/* ---------------- share dialog ---------------- */

function openShareDialog(): void {
  const sourceBtn = $<HTMLButtonElement>('#share-copy-source')!;
  const hasSource = !!state.doc?.url;
  sourceBtn.disabled = !hasSource;
  sourceBtn.setAttribute('aria-disabled', String(!hasSource));
  $<HTMLElement>('#share-chars')!.textContent =
    editor.value.length.toLocaleString(state.lang === 'fa' ? 'fa-IR' : 'en-US') + ' ' + t('chars');
  $<HTMLDialogElement>('#share-dialog')!.showModal();
}

export function readAndLoad(file: File | null): void {
  if (!file) return;
  if (file.size > MAX_INPUT_BYTES) { toast(t('tooLarge'), 'error'); return; }
  file.text().then((text) => {
    setDoc({ name: file.name.replace(/\.[^.]+$/, ''), text });
    history.pushState(null, '', location.pathname);
    routeState.lastParams = null;
    toast(file.name, 'ok');
  }).catch(() => toast(t('loadError'), 'error'));
}

export function bindUI(): void {
  $('#panel-btn')!.addEventListener('click', () => (panel.classList.contains('open') ? closePanel() : openPanel()));
  scrim.addEventListener('click', closePanel);

  $$('#pane-modes button').forEach((b) => b.addEventListener('click', () => setPaneMode(b.dataset.mode as PaneMode)));

  $('#open-btn')!.addEventListener('click', openLoadDialog);
  $('#dialog-close-btn')!.addEventListener('click', () => openDialog.close());

  $$('.tab', openDialog).forEach((b) => b.addEventListener('click', () => activateTab(b.dataset.tab!)));

  $<HTMLFormElement>('#url-form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $<HTMLInputElement>('#url-input')!.value.trim();
    if (!v) return;
    openDialog.close();
    loadUrl(v);
  });

  $<HTMLInputElement>('#file-input')!.addEventListener('change', (e) => {
    readAndLoad((e.target as HTMLInputElement).files?.[0] ?? null);
    (e.target as HTMLInputElement).value = '';
    openDialog.close();
  });

  $('#paste-load-btn')!.addEventListener('click', () => {
    const text = $<HTMLTextAreaElement>('#paste-input')!.value;
    if (!text.trim()) { toast(t('loadError'), 'error'); return; }
    if (new TextEncoder().encode(text).length > MAX_INPUT_BYTES) { toast(t('tooLarge'), 'error'); return; }
    setDoc({ name: t('pastedDoc'), text });
    history.pushState(null, '', location.pathname);
    routeState.lastParams = null;
    openDialog.close();
  });

  /* In-panel sample links load without a full page reload */
  $$<HTMLAnchorElement>('#panel a.side-link[href*="?file="]').forEach((a) => {
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      closePanel();
      loadFile(new URL(a.href, location.href).searchParams.get('file')!);
    });
  });

  $('#new-doc-btn')!.addEventListener('click', () => {
    if (editor.value.trim() && !confirm(t('newDocConfirm'))) return;
    history.pushState(null, '', location.pathname);
    routeState.lastParams = null;
    setDoc({ name: t('unnamedDoc'), text: '' });
    closePanel();
    editor.focus();
  });

  $('#share-btn')!.addEventListener('click', openShareDialog);

  $('#share-close-btn')!.addEventListener('click', () => $<HTMLDialogElement>('#share-dialog')!.close());

  $('#share-copy-content')!.addEventListener('click', async () => {
    const dialog = $<HTMLDialogElement>('#share-dialog')!;
    const result = await shareEncode(editor.value);
    if (!result.ok) {
      toast(t('linkTooLarge'), 'error');
      dialog.close();
      return;
    }
    try {
      await navigator.clipboard.writeText(result.url);
      toast(t('copied'), 'ok');
    } catch { toast(t('copied'), 'error'); }
    if (result.warn) toast(t('linkWarn'));
    dialog.close();
  });

  $('#share-copy-source')!.addEventListener('click', async () => {
    const url = state.doc?.url;
    if (!url) return; // button is disabled in this state anyway
    try {
      await navigator.clipboard.writeText(url);
      toast(t('copied'), 'ok');
    } catch { toast(t('copied'), 'error'); }
    $<HTMLDialogElement>('#share-dialog')!.close();
  });

  $('#dir-btn')!.addEventListener('click', () => {
    state.dir = state.dir === 'auto' ? 'ltr' : state.dir === 'ltr' ? 'rtl' : 'auto';
    store.set('dir', state.dir);
    applyDir();
    toast(t('toggleDir').split('(')[0].trim() + ': ' +
      (state.dir === 'auto' ? 'Auto / خودکار' : state.dir === 'ltr' ? 'LTR' : 'RTL'));
  });

  $('#lang-btn')!.addEventListener('click', () => {
    setLang(state.lang === 'fa' ? 'en' : 'fa');
  });

  $('#theme-btn')!.addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    store.set('theme', state.theme);
    applyTheme();
    renderPreview(); // re-theme mermaid diagrams
  });

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      openLoadDialog();
    } else if (e.key === 'Escape') {
      closePanel();
    }
  });
}

/* ---------------- drag & drop ---------------- */

export function bindDrop(): void {
  const overlay = $('#drop-overlay')!;
  const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) { e.preventDefault(); overlay.classList.add('show'); }
  });
  window.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) overlay.classList.remove('show');
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    overlay.classList.remove('show');
    readAndLoad(e.dataTransfer!.files[0]);
  });
}
