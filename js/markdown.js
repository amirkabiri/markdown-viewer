// Module: markdown — render pipeline: marked + DOMPurify + highlight.js + mermaid. Owner of renderPreview/enhance/scheduleRender/scrollToHash/initMarked.
import { $$, state, editor, preview, MAX_INPUT_BYTES, slugify, toast } from './state.js';
import { t, registerI18n } from './i18n.js';
import { loadUrl } from './documents.js';
import { buildToc, updateSpy } from './ui.js';
import { applyDir } from './workspace.js';

registerI18n({
  copyCode: { en: 'Copy', fa: 'کپی' },
  copiedCode: { en: 'Copied!', fa: 'کپی شد!' },
  mermaidError: { en: 'Mermaid diagram error', fa: 'خطا در نمودار مرمید' },
});

let renderTimer = 0;

export function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderPreview, 300);
}

export async function renderPreview() {
  clearTimeout(renderTimer);
  const id = ++state.renderId;
  const src = editor.value.replace(/\r\n?/g, '\n');

  if (new TextEncoder().encode(src).length > MAX_INPUT_BYTES) {
    preview.innerHTML = '';
    const note = document.createElement('div');
    note.className = 'error-note';
    note.textContent = t('tooLarge');
    preview.appendChild(note);
    return;
  }

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

export function scrollToHash() {
  if (!location.hash) return;
  let el = null;
  try {
    el = preview.querySelector(decodeURIComponent(location.hash));
  } catch {
    el = document.getElementById(location.hash.slice(1));
  }
  if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
}

/** CDN library setup + availability check — runs once from boot(), same position as in app.js. */
export function initMarked() {
  if (window.marked && marked.setOptions) marked.setOptions({ gfm: true, breaks: false });
  if (!window.marked || !window.DOMPurify || !window.mermaid) toast(t('libError'), 'error');
}
