/* ============================================================
   Markdown Viewer — split-pane editor/preview
   marked + DOMPurify + highlight.js + mermaid (all via CDN)
   ============================================================ */
'use strict';

/* ---------------- i18n ---------------- */

const I18N = {
  en: {
    appTitle: 'Markdown Viewer',
    togglePanel: 'Toggle panel',
    open: 'Open',
    paneEditor: 'Editor only',
    paneSplit: 'Split view',
    panePreview: 'Preview only',
    copyLink: 'Copy link to this document',
    toggleDir: 'Text direction (Auto / LTR / RTL)',
    toggleLang: 'تغییر زبان به فارسی',
    toggleTheme: 'Toggle light / dark theme',
    editor: 'Editor',
    preview: 'Preview',
    editorAria: 'Markdown source',
    words: 'words',
    chars: 'chars',
    contents: 'On this page',
    documents: 'Documents',
    docReadme: 'About this viewer',
    docSampleEn: 'Feature tour (EN)',
    docSampleFa: 'Feature tour (فارسی)',
    newDoc: 'New document',
    recent: 'Recent',
    footer: 'Free & open source',
    openTitle: 'Open a document',
    close: 'Close',
    tabUrl: 'From URL',
    tabUpload: 'Upload file',
    tabPaste: 'Paste text',
    urlPlaceholder: 'https://… or a github.com blob link',
    load: 'Load',
    urlHint: 'Tip: a GitHub blob link is converted to a raw URL automatically.',
    chooseFile: 'Choose a .md file or drop it here',
    pastePlaceholder: '# Paste Markdown here…',
    render: 'Insert & render',
    dropHere: 'Drop your .md file to load it',
    copied: 'Link copied to clipboard',
    copyCode: 'Copy',
    copiedCode: 'Copied!',
    loadError: 'Could not load document',
    mermaidError: 'Mermaid diagram error',
    pastedDoc: 'Pasted document',
    unnamedDoc: 'Untitled',
    welcome: 'Welcome',
    newDocConfirm: 'Clear the editor and start a new document?',
    libError: 'A library failed to load — check your connection.',
  },
  fa: {
    appTitle: 'نمایشگر مارک‌داون',
    togglePanel: 'نمایش/بستن پنل',
    open: 'باز کردن',
    paneEditor: 'فقط ویرایشگر',
    paneSplit: 'نمای دو بخشی',
    panePreview: 'فقط پیش‌نمایش',
    copyLink: 'کپی نشانی این سند',
    toggleDir: 'جهت متن (خودکار / چپ‌به‌راست / راست‌به‌چپ)',
    toggleLang: 'Switch to English',
    toggleTheme: 'تغییر پوسته روشن / تاریک',
    editor: 'ویرایشگر',
    preview: 'پیش‌نمایش',
    editorAria: 'متن مارک‌داون',
    words: 'واژه',
    chars: 'نویسه',
    contents: 'در این صفحه',
    documents: 'اسناد',
    docReadme: 'درباره این نمایشگر',
    docSampleEn: 'آشنایی با امکانات (EN)',
    docSampleFa: 'آشنایی با امکانات (فارسی)',
    newDoc: 'سند جدید',
    recent: 'اخیراً دیده‌شده',
    footer: 'متن‌باز و رایگان',
    openTitle: 'باز کردن سند',
    close: 'بستن',
    tabUrl: 'از نشانی',
    tabUpload: 'بارگذاری فایل',
    tabPaste: 'چسباندن متن',
    urlPlaceholder: 'نشانی اینترنتی یا لینک گیت‌هاب…',
    load: 'بارگیری',
    urlHint: 'نکته: لینک‌های blob گیت‌هاب خودکار به نشانی خام تبدیل می‌شوند.',
    chooseFile: 'یک فایل .md انتخاب کنید یا اینجا رها کنید',
    pastePlaceholder: '# متن مارک‌داون را اینجا بچسبانید…',
    render: 'درج و نمایش',
    dropHere: 'فایل مارک‌داون را برای بارگذاری رها کنید',
    copied: 'نشانی در کلیپ‌بورد کپی شد',
    copyCode: 'کپی',
    copiedCode: 'کپی شد!',
    loadError: 'بارگیری سند ممکن نشد',
    mermaidError: 'خطا در نمودار مرمید',
    pastedDoc: 'سند جای‌گذاری‌شده',
    unnamedDoc: 'بی‌نام',
    welcome: 'خوش آمدید',
    newDocConfirm: 'ویرایشگر خالی و سند جدیدی آغاز شود؟',
    libError: 'بارگیری یکی از کتابخانه‌ها ناموفق بود — اتصال اینترنت را بررسی کنید.',
  },
};

/* ---------------- helpers ---------------- */

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const store = {
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

const t = (key) => (I18N[state.lang] && I18N[state.lang][key]) || I18N.en[key] || key;

const RTL_RANGES = [
  [0x0590, 0x05FF], [0x0600, 0x06FF], [0x0700, 0x074F],
  [0x0750, 0x077F], [0xFB50, 0xFDFF], [0xFE70, 0xFEFF],
];

/** Direction of the first strong character in the text. */
function detectDir(text) {
  for (const ch of (text || '')) {
    if (!/\p{L}/u.test(ch)) continue;
    const c = ch.codePointAt(0);
    if (RTL_RANGES.some(([a, b]) => c >= a && c <= b)) return 'rtl';
    return 'ltr';
  }
  return 'ltr';
}

const slugify = (s) =>
  s.trim().toLowerCase().replace(/[^\p{L}\p{N}\-_ ]/gu, '').replace(/\s+/g, '-');

/* ---------------- state & elements ---------------- */

const state = {
  lang: store.get('lang', (navigator.language || '').toLowerCase().startsWith('fa') ? 'fa' : 'en'),
  theme: store.get('theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  dir: store.get('dir', 'auto'),            // content direction: auto | ltr | rtl
  mode: store.get('mode', 'split'),         // editor | split | preview
  doc: null,                                // {name, text, url, baseUrl}
  renderId: 0,
};

const editor = $('#editor');
const preview = $('#content');
const previewScroll = $('#preview-scroll');
const workspace = $('#workspace');
const divider = $('#divider');
const panel = $('#panel');
const scrim = $('#scrim');
const openDialog = $('#open-dialog');

const BLOCK_SEL = 'p,h1,h2,h3,h4,h5,h6,li,td,th,figcaption,dd,dt,summary,blockquote';

let lastParams = null;   // query string currently loaded, to skip redundant popstate reloads
let renderTimer = 0;
let lockUntil = 0;       // scroll-sync lock
let spyTick = false;

/* ---------------- UI: language / theme / direction ---------------- */

function applyLang() {
  const root = document.documentElement;
  root.lang = state.lang;
  root.dir = state.lang === 'fa' ? 'rtl' : 'ltr';
  $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  $$('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  $$('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
    el.setAttribute('aria-label', t(el.dataset.i18nTitle));
  });
  $$('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
  $('#lang-btn').textContent = state.lang === 'fa' ? 'EN' : 'فا';
  document.title = t('appTitle');
  if (state.doc) $('#doc-name').textContent = state.doc.name;
  updateCounts();
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  $('meta[name="theme-color"]').content = state.theme === 'dark' ? '#0d1117' : '#0969da';
  const link = $('#hljs-theme');
  const v = '11.9.0';
  link.href = `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/${v}/styles/${state.theme === 'dark' ? 'github-dark' : 'github'}.min.css`;
}

function applyDir() {
  const mode = state.dir;
  editor.dir = mode === 'auto' ? detectDir(editor.value) : mode;
  if (mode === 'auto') {
    preview.dir = detectDir(preview.textContent);
    $$(BLOCK_SEL, preview).forEach((el) => { el.dir = 'auto'; });
  } else {
    preview.dir = mode;
    $$(BLOCK_SEL, preview).forEach((el) => el.removeAttribute('dir'));
  }
}

/* ---------------- rendering pipeline ---------------- */

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderPreview, 300);
}

async function renderPreview() {
  clearTimeout(renderTimer);
  const id = ++state.renderId;
  const src = editor.value.replace(/\r\n?/g, '\n');

  if (!window.marked || !window.DOMPurify) {
    preview.textContent = src;
    return;
  }

  let html = '';
  try {
    html = marked.parse(src);
  } catch (err) {
    html = '<p></p>';
    const note = document.createElement('div');
    note.className = 'error-note';
    note.textContent = String(err.message || err);
    preview.appendChild(note);
  }
  preview.innerHTML = DOMPurify.sanitize(html);

  await enhance();
  if (id !== state.renderId) return;
  applyDir();
  updateSpy();
}

async function enhance() {
  const base = (state.doc && state.doc.baseUrl) || location.href;

  /* Links: resolve relative hrefs against the document URL,
     turn *.md links into in-app navigation, open the rest in a new tab. */
  $$('a[href]', preview).forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (!href || href.startsWith('#')) return;
    if (!/^(https?:)?\/\//i.test(href) && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      try { a.href = new URL(href, base).href; } catch { /* keep as-is */ }
    }
    if (/\.md($|[?#])/i.test(a.href)) {
      a.addEventListener('click', (ev) => { ev.preventDefault(); loadUrl(a.href); });
    } else if (/^https?:/i.test(a.href)) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
  });

  /* Images: resolve relative srcs, lazy-load */
  $$('img[src]', preview).forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (!/^(https?:)?\/\//i.test(src) && !src.startsWith('data:')) {
      try { img.src = new URL(src, base).href; } catch { /* keep as-is */ }
    }
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
  });

  /* Headings: unique ids + hover anchors + table of contents */
  const used = new Map();
  $$('h1,h2,h3,h4,h5,h6', preview).forEach((h) => {
    let id = slugify(h.textContent) || 'section';
    const n = used.get(id) || 0;
    used.set(id, n + 1);
    if (n) id += '-' + n;
    h.id = id;
    const anchor = document.createElement('a');
    anchor.className = 'heading-anchor';
    anchor.href = '#' + id;
    anchor.textContent = '#';
    h.appendChild(anchor);
  });
  buildToc($$('h2,h3,h4', preview));

  /* Tables: wrap for rounded corners + horizontal scroll */
  $$('table', preview).forEach((tbl) => {
    if (tbl.parentElement.classList.contains('table-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    tbl.before(wrap);
    wrap.appendChild(tbl);
  });

  /* Code blocks: highlight + copy button; collect mermaid blocks */
  const shells = [];
  $$('pre > code', preview).forEach((code) => {
    const lang = (code.className.match(/language-([\w#+-]+)/) || [])[1];
    if (lang && lang.toLowerCase() === 'mermaid') {
      const shell = document.createElement('div');
      shell.className = 'mermaid-block';
      shell.textContent = code.textContent;
      code.parentElement.replaceWith(shell);
      shells.push(shell);
      return;
    }
    if (lang && window.hljs && hljs.getLanguage(lang)) {
      try { hljs.highlightElement(code); } catch { /* leave plain */ }
    }
    attachCopyButton(code.parentElement);
  });

  /* Mermaid */
  if (shells.length && window.mermaid) {
    try {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: state.theme === 'dark' ? 'dark' : 'default',
        fontFamily: '"Vazirmatn", ui-sans-serif, system-ui, sans-serif',
      });
    } catch { /* already initialized */ }
    for (const shell of shells) {
      try {
        await mermaid.parse(shell.textContent);
        await mermaid.run({ nodes: [shell] });
      } catch (err) {
        shell.classList.add('mermaid-failed');
        const note = document.createElement('div');
        note.className = 'error-note';
        note.textContent = `${t('mermaidError')}: ${err.message || err}`;
        shell.after(note);
      }
    }
  }
}

function attachCopyButton(pre) {
  if (!pre || pre.querySelector('.copy-btn')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'copy-btn';
  btn.textContent = t('copyCode');
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(pre.querySelector('code')?.textContent ?? pre.textContent);
      btn.textContent = t('copiedCode');
      btn.classList.add('ok');
      setTimeout(() => { btn.textContent = t('copyCode'); btn.classList.remove('ok'); }, 1400);
    } catch { toast(t('loadError'), 'error'); }
  });
  pre.appendChild(btn);
}

/* ---------------- table of contents + scroll spy ---------------- */

function buildToc(headings) {
  const toc = $('#toc');
  const section = $('#toc-section');
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

function updateSpy() {
  const links = $$('.toc-link', $('#toc'));
  if (!links.length) return;
  const heads = $$('h2,h3,h4', preview);
  const top = previewScroll.getBoundingClientRect().top;
  let current = 0;
  heads.forEach((h, i) => {
    if (h.getBoundingClientRect().top - top <= 90) current = i;
  });
  links.forEach((l, i) => l.classList.toggle('active', i === current));
}

/* ---------------- document loading ---------------- */

function showLoading() { $('#loading').hidden = false; }
function hideLoading() { $('#loading').hidden = true; }

let toastTimer = 0;
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 2600);
}

async function fetchText(url) {
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
function normalizeGitHubUrl(u) {
  try {
    const url = new URL(u, location.href);
    if (/(^|\.)github\.com$/i.test(url.hostname)) {
      const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/([^/]+)\/(.+)$/);
      if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
    }
    return url.href;
  } catch { return u; }
}

function prettyName(u, base = location.href) {
  try {
    const last = decodeURIComponent(new URL(u, base).pathname.split('/').filter(Boolean).pop() || '');
    return last.replace(/\.(md|markdown|mdx|txt)$/i, '') || 'document';
  } catch { return 'document'; }
}

function setDoc({ name, text, url = null, baseUrl = null }) {
  state.doc = { name, text, url, baseUrl: baseUrl || url || location.href };
  $('#doc-name').textContent = name;
  editor.value = text;
  updateCounts();
  previewScroll.scrollTop = 0;
  if (url) addRecent({ name, url });
  return renderPreview();
}

function paramsString() { return location.search.replace(/^\?/, ''); }

async function loadUrl(rawUrl, { push = true, fileParam = null } = {}) {
  const target = normalizeGitHubUrl(rawUrl.trim());
  showLoading();
  let ok = false;
  try {
    const text = await fetchText(target);
    await setDoc({ name: fileParam ? prettyName(fileParam) : prettyName(target), text, url: target, baseUrl: target });
    ok = true;
  } catch (err) {
    toast(`${t('loadError')}: ${err.message || err}`, 'error');
  } finally {
    hideLoading();
  }
  if (ok) {
    lastParams = fileParam ? `file=${encodeURIComponent(fileParam)}` : `url=${encodeURIComponent(target)}`;
    if (push) {
      history.pushState(null, '', location.pathname + (lastParams ? '?' + lastParams : ''));
    }
    scrollToHash();
  }
  if (!ok && !state.doc) loadWelcome();
  return ok;
}

const loadFile = (path, opts = {}) => loadUrl(new URL(path, location.href).href, { ...opts, fileParam: path });

function loadWelcome() {
  const md = $('#welcome-md').textContent;
  setDoc({ name: t('welcome'), text: md, baseUrl: location.href });
}

function scrollToHash() {
  if (!location.hash) return;
  const el = preview.querySelector(decodeURIComponent(location.hash));
  if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
}

/* ---------------- recent documents ---------------- */

function addRecent(item) {
  let list = store.get('recent', []);
  list = [item, ...list.filter((x) => x.url !== item.url)].slice(0, 8);
  store.set('recent', list);
  renderRecent();
}

function renderRecent() {
  const list = store.get('recent', []);
  $('#recent-section').hidden = !list.length;
  const holder = $('#recent-list');
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

/* ---------------- pane modes + divider ---------------- */

function setPaneMode(mode, { save = true } = {}) {
  state.mode = mode;
  workspace.classList.remove('mode-editor', 'mode-split', 'mode-preview');
  workspace.classList.add('mode-' + mode);
  $$('#pane-modes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  if (save) store.set('mode', mode);
}

function applySplit() {
  const saved = store.get('split', null);
  if (saved) workspace.style.setProperty('--split', saved);
}

function isSplit() { return state.mode === 'split'; }

function initDivider() {
  divider.addEventListener('pointerdown', (e) => {
    if (!isSplit()) return;
    divider.setPointerCapture(e.pointerId);
    divider.classList.add('dragging');
    const rect = workspace.getBoundingClientRect();
    const move = (ev) => {
      let frac = (ev.clientX - rect.left) / rect.width;
      if (document.documentElement.dir === 'rtl') frac = 1 - frac;
      frac = Math.min(0.8, Math.max(0.2, frac));
      workspace.style.setProperty('--split', (frac * 100).toFixed(2) + '%');
    };
    const up = () => {
      divider.classList.remove('dragging');
      store.set('split', workspace.style.getPropertyValue('--split'));
      divider.removeEventListener('pointermove', move);
      divider.removeEventListener('pointerup', up);
    };
    divider.addEventListener('pointermove', move);
    divider.addEventListener('pointerup', up);
  });
  divider.addEventListener('dblclick', () => {
    workspace.style.removeProperty('--split');
    store.set('split', null);
  });
}

/* ---------------- editor <-> preview scroll sync ---------------- */

function bindScrollSync() {
  editor.addEventListener('scroll', () => {
    if (!isSplit() || Date.now() < lockUntil) return;
    lockUntil = Date.now() + 60;
    const p = editor.scrollTop / Math.max(1, editor.scrollHeight - editor.clientHeight);
    previewScroll.scrollTop = p * Math.max(0, previewScroll.scrollHeight - previewScroll.clientHeight);
  });
  previewScroll.addEventListener('scroll', () => {
    if (spyTick) return;
    spyTick = true;
    requestAnimationFrame(() => { spyTick = false; updateSpy(); });
    if (!isSplit() || Date.now() < lockUntil) return;
    lockUntil = Date.now() + 60;
    const p = previewScroll.scrollTop / Math.max(1, previewScroll.scrollHeight - previewScroll.clientHeight);
    editor.scrollTop = p * Math.max(0, editor.scrollHeight - editor.clientHeight);
  });
}

/* ---------------- editor events ---------------- */

function updateCounts() {
  const v = editor.value;
  $('#word-count').textContent = ((v.trim().match(/\S+/g)) || []).length.toLocaleString(state.lang === 'fa' ? 'fa-IR' : 'en-US');
  $('#char-count').textContent = v.length.toLocaleString(state.lang === 'fa' ? 'fa-IR' : 'en-US');
}

function bindEditor() {
  editor.addEventListener('input', () => {
    updateCounts();
    if (state.dir === 'auto') editor.dir = detectDir(editor.value);
    scheduleRender();
  });
  /* Tab inserts spaces instead of moving focus */
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: en } = editor;
      editor.value = editor.value.slice(0, s) + '  ' + editor.value.slice(en);
      editor.selectionStart = editor.selectionEnd = s + 2;
      editor.dispatchEvent(new Event('input'));
    }
  });
}

/* ---------------- panel / dialog / buttons ---------------- */

function openPanel() { panel.classList.add('open'); scrim.hidden = false; $('#panel-btn').setAttribute('aria-expanded', 'true'); }
function closePanel() { panel.classList.remove('open'); scrim.hidden = true; $('#panel-btn').setAttribute('aria-expanded', 'false'); }

function openLoadDialog() {
  activateTab('url');
  openDialog.showModal();
  setTimeout(() => $('#url-input').focus(), 50);
}

function activateTab(name) {
  $$('.tab', openDialog).forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $('#panel-url').hidden = name !== 'url';
  $('#panel-upload').hidden = name !== 'upload';
  $('#panel-paste').hidden = name !== 'paste';
}

function readAndLoad(file) {
  if (!file) return;
  file.text().then((text) => {
    setDoc({ name: file.name.replace(/\.[^.]+$/, ''), text });
    history.pushState(null, '', location.pathname);
    lastParams = null;
    toast(file.name, 'ok');
  }).catch(() => toast(t('loadError'), 'error'));
}

function bindUI() {
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
    setDoc({ name: t('pastedDoc'), text });
    history.pushState(null, '', location.pathname);
    lastParams = null;
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
    lastParams = null;
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
    state.lang = state.lang === 'fa' ? 'en' : 'fa';
    store.set('lang', state.lang);
    applyLang();
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

function bindDrop() {
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

/* ---------------- routing / boot ---------------- */

function route() {
  const p = paramsString();
  if (p === lastParams) return;
  const params = new URLSearchParams(p);
  const url = params.get('url');
  const file = params.get('file');
  if (url) loadUrl(url, { push: false });
  else if (file) loadFile(file, { push: false });
  else loadFile('README.md', { push: false });
}

async function boot() {
  applyLang();
  applyTheme();
  applySplit();
  setPaneMode(state.mode, { save: false });
  renderRecent();
  updateCounts();

  if (window.marked && marked.setOptions) marked.setOptions({ gfm: true, breaks: false });
  if (!window.marked || !window.DOMPurify || !window.mermaid) toast(t('libError'), 'error');

  bindUI();
  bindEditor();
  bindScrollSync();
  initDivider();
  bindDrop();

  const params = new URLSearchParams(location.search);
  const url = params.get('url');
  const file = params.get('file');
  if (url) await loadUrl(url, { push: false });
  else if (file) await loadFile(decodeURIComponent(file), { push: false });
  else await loadFile('README.md', { push: false });

  window.addEventListener('popstate', route);
}

boot();
