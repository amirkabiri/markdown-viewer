// Module: ui — TOC + scroll spy, slide-over panel, open dialog, topbar handlers, drag & drop. Owner of bindUI/bindDrop/buildToc/updateSpy/applyTheme.
import { $, $$, state, store, routeState, editor, preview, previewScroll, panel, scrim, openDialog, panelEls, MAX_INPUT_BYTES, toast } from './state.js';
import { t, setLang } from './i18n.js';
import { renderPreview } from './markdown.js';
import { setDoc, loadUrl, loadFile } from './documents.js';
import { setPaneMode, applyDir } from './workspace.js';

/* highlight.js stylesheets per theme, with matching SRI hashes */
const HLJS_STYLES = {
  light: { href: 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css', integrity: 'sha384-eFTL69TLRZTkNfYZOLM+G04821K1qZao/4QLJbet1pP4tcF+fdXq/9CdqAbWRl/L' },
  dark:  { href: 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css', integrity: 'sha384-wH75j6z1lH97ZOpMOInqhgKzFkAInZPPSPlZpYKYTOqsaizPvhQZmAtLcPKXpLyH' },
};

export function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  $('meta[name="theme-color"]').content = state.theme === 'dark' ? '#0d1117' : '#0969da';
  const link = $('#hljs-theme');
  const style = HLJS_STYLES[state.theme] || HLJS_STYLES.light;
  link.href = style.href;
  link.integrity = style.integrity;
}

/* ---------------- loading overlay ---------------- */

export function showLoading() { $('#loading').hidden = false; }
export function hideLoading() { $('#loading').hidden = true; }

/* ---------------- table of contents + scroll spy ---------------- */

export function buildToc(headings) {
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
    const clone = h.cloneNode(true);
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

export function updateSpy() {
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

export function openPanel() { panel.classList.add('open'); scrim.hidden = false; $('#panel-btn').setAttribute('aria-expanded', 'true'); }
export function closePanel() { panel.classList.remove('open'); scrim.hidden = true; $('#panel-btn').setAttribute('aria-expanded', 'false'); }

export function openLoadDialog() {
  activateTab('url');
  openDialog.showModal();
  setTimeout(() => $('#url-input').focus(), 50);
}

export function activateTab(name) {
  $$('.tab', openDialog).forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $('#panel-url').hidden = name !== 'url';
  $('#panel-upload').hidden = name !== 'upload';
  $('#panel-paste').hidden = name !== 'paste';
}

export function readAndLoad(file) {
  if (!file) return;
  if (file.size > MAX_INPUT_BYTES) { toast(t('tooLarge'), 'error'); return; }
  file.text().then((text) => {
    setDoc({ name: file.name.replace(/\.[^.]+$/, ''), text });
    history.pushState(null, '', location.pathname);
    routeState.lastParams = null;
    toast(file.name, 'ok');
  }).catch(() => toast(t('loadError'), 'error'));
}

export function bindUI() {
  $('#panel-btn').addEventListener('click', () => (panel.classList.contains('open') ? closePanel() : openPanel()));
  scrim.addEventListener('click', closePanel);

  $$('#pane-modes button').forEach((b) => b.addEventListener('click', () => setPaneMode(b.dataset.mode)));

  $('#open-btn').addEventListener('click', openLoadDialog);
  $('#dialog-close-btn').addEventListener('click', () => openDialog.close());

  $$('.tab', openDialog).forEach((b) => b.addEventListener('click', () => activateTab(b.dataset.tab)));

  $('#url-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#url-input').value.trim();
    if (!v) return;
    openDialog.close();
    loadUrl(v);
  });

  $('#file-input').addEventListener('change', (e) => {
    readAndLoad(e.target.files[0]);
    e.target.value = '';
    openDialog.close();
  });

  $('#paste-load-btn').addEventListener('click', () => {
    const text = $('#paste-input').value;
    if (!text.trim()) { toast(t('loadError'), 'error'); return; }
    if (new TextEncoder().encode(text).length > MAX_INPUT_BYTES) { toast(t('tooLarge'), 'error'); return; }
    setDoc({ name: t('pastedDoc'), text });
    history.pushState(null, '', location.pathname);
    routeState.lastParams = null;
    openDialog.close();
  });

  /* In-panel sample links load without a full page reload */
  $$('#panel a.side-link[href*="?file="]').forEach((a) => {
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      closePanel();
      loadFile(new URL(a.href, location.href).searchParams.get('file'));
    });
  });

  $('#new-doc-btn').addEventListener('click', () => {
    if (editor.value.trim() && !confirm(t('newDocConfirm'))) return;
    history.pushState(null, '', location.pathname);
    routeState.lastParams = null;
    setDoc({ name: t('unnamedDoc'), text: '' });
    closePanel();
    editor.focus();
  });

  $('#share-btn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      toast(t('copied'), 'ok');
    } catch { toast(t('copied'), 'error'); }
  });

  $('#dir-btn').addEventListener('click', () => {
    state.dir = state.dir === 'auto' ? 'ltr' : state.dir === 'ltr' ? 'rtl' : 'auto';
    store.set('dir', state.dir);
    applyDir();
    toast(t('toggleDir').split('(')[0].trim() + ': ' +
      (state.dir === 'auto' ? 'Auto / خودکار' : state.dir === 'ltr' ? 'LTR' : 'RTL'));
  });

  $('#lang-btn').addEventListener('click', () => {
    setLang(state.lang === 'fa' ? 'en' : 'fa');
  });

  $('#theme-btn').addEventListener('click', () => {
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

export function bindDrop() {
  const overlay = $('#drop-overlay');
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
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
    readAndLoad(e.dataTransfer.files[0]);
  });
}
