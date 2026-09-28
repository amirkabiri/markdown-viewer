// Module: lib/markdown — the PURE markdown render pipeline: marked (GFM) →
// DOMPurify → highlight.js, plus heading ids/anchors, the h2–h4 TOC, table
// wrapping, link/image resolution and mermaid-block EXTRACTION. No writes to
// the live DOM: renderMarkdown parses the sanitized HTML inside a detached
// DOMParser document and returns html + toc + mermaid sources.
//
// The DOM halves of legacy/src/markdown.ts STAY in legacy/ for the UI agents
// to re-imagine as React effects:
//   - preview injection (renderPreview) and the 300 ms render debounce
//     (RENDER_DEBOUNCE_MS below preserves the constant)
//   - scroll spy + smooth scroll to hash
//   - the code-copy buttons (the HTML ships without them)
//   - MERMAID RENDERING. Hook point: result.mermaid carries the extracted
//     diagram sources in document order, each wrapped in a
//     div.mermaid-block shell in the HTML; call
//     mermaid.initialize(mermaidConfig(theme)) then mermaid.run() over the
//     shells (or render the sources directly), and mark failures with
//     .mermaid-failed + the mermaidError string from src/i18n/dictionaries.
// Legacy twin: legacy/src/markdown.ts.

import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { slugify } from './store';

/** Legacy preview debounce, kept for the React render effect. */
export const RENDER_DEBOUNCE_MS = 300;

/* ---------------- mermaid config (the UI owns rendering) ---------------- */

export const MERMAID_FONT_FAMILY = '"Vazirmatn", ui-sans-serif, system-ui, sans-serif';

export interface MermaidConfig {
  startOnLoad: false;
  securityLevel: 'strict';
  theme: 'default' | 'dark';
  fontFamily: string;
}

/** The mermaid.initialize() config legacy used, per app theme. */
export function mermaidConfig(theme: 'light' | 'dark'): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: theme === 'dark' ? 'dark' : 'default',
    fontFamily: MERMAID_FONT_FAMILY,
  };
}

/* ---------------- render result ---------------- */

export interface MarkdownTocEntry {
  id: string;
  text: string;
  level: 2 | 3 | 4;
}

export interface RenderedMarkdown {
  /** Sanitized, enhanced HTML (sanitized BEFORE enhancement, like legacy). */
  html: string;
  /** h2–h4 table-of-contents entries in document order. */
  toc: MarkdownTocEntry[];
  /** Extracted ```mermaid sources, in document order (rendering is the UI's job). */
  mermaid: string[];
  /** hrefs of *.md links — the same links carry data-md-link="true" in the HTML. */
  docLinks: string[];
  /** Set when marked failed to parse; html is then '' (legacy appended the
   *  message as an error-note). */
  error?: string;
}

export interface RenderOptions {
  /** Base URL for resolving relative link/img URLs (legacy: the doc's baseUrl). */
  baseUrl?: string;
}

/* ---------------- enhancement rules (frozen from legacy) ---------------- */

const MD_LINK_RE = /\.md($|[?#])/i;
const EXTERNAL_SCHEME_RE = /^(https?:)?\/\//i;
const ANY_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const LANG_RE = /language-([\w#+-]+)/;

/** True when an anchor href is an in-app markdown-document link. */
export function isDocLink(href: string): boolean {
  return MD_LINK_RE.test(href);
}

/**
 * Pure: renders markdown text to sanitized, enhanced HTML plus the TOC and
 * the extracted mermaid sources. CRLF input is normalized; the output is
 * byte-equivalent to what the legacy pipeline wrote into #content (minus the
 * copy buttons and mermaid SVGs). Never writes to the live DOM.
 */
export function renderMarkdown(text: string, opts: RenderOptions = {}): RenderedMarkdown {
  const src = text.replace(/\r\n?/g, '\n');
  let parsed: string;
  try {
    // Sync parse (the async option was never enabled in legacy).
    parsed = marked.parse(src, { gfm: true, breaks: false }) as string;
  } catch (err) {
    return {
      html: '',
      toc: [],
      mermaid: [],
      docLinks: [],
      error: (err instanceof Error && err.message) || String(err),
    };
  }

  const doc = new DOMParser().parseFromString(DOMPurify.sanitize(parsed), 'text/html');
  const base = opts.baseUrl;

  /* Links: resolve relative hrefs against the document URL, flag *.md links
     for in-app navigation, open absolute http(s) links in a new tab. */
  const docLinks: string[] = [];
  doc.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
    const raw = a.getAttribute('href') || '';
    if (!raw || raw.startsWith('#')) return;
    let href = raw;
    if (!EXTERNAL_SCHEME_RE.test(href) && !ANY_SCHEME_RE.test(href) && base) {
      try {
        href = new URL(href, base).href;
        a.setAttribute('href', href);
      } catch { /* keep as-is */ }
    }
    if (isDocLink(href)) {
      docLinks.push(href);
      a.setAttribute('data-md-link', 'true'); // click interception is the UI's job
    } else if (/^https?:/i.test(href)) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  });

  /* Images: resolve relative srcs, lazy-load, no referrer. */
  doc.querySelectorAll<HTMLImageElement>('img[src]').forEach((img) => {
    const raw = img.getAttribute('src') || '';
    if (!EXTERNAL_SCHEME_RE.test(raw) && !raw.startsWith('data:') && base) {
      try {
        img.setAttribute('src', new URL(raw, base).href);
      } catch { /* keep as-is */ }
    }
    img.setAttribute('loading', 'lazy');
    img.setAttribute('referrerpolicy', 'no-referrer');
  });

  /* Headings: unique ids + hover anchors + the h2–h4 TOC. */
  const used = new Map<string, number>();
  const toc: MarkdownTocEntry[] = [];
  doc.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => {
    const level = Number(h.tagName[1]);
    const headingText = h.textContent ?? '';
    let id = slugify(headingText) || 'section';
    const n = used.get(id) || 0;
    used.set(id, n + 1);
    if (n) id += `-${n}`;
    h.setAttribute('id', id);
    const anchor = doc.createElement('a');
    anchor.className = 'heading-anchor';
    anchor.setAttribute('href', `#${id}`);
    anchor.textContent = '#';
    h.appendChild(anchor);
    if (level >= 2 && level <= 4) {
      toc.push({ id, text: headingText, level: level as 2 | 3 | 4 });
    }
  });

  /* Tables: wrap for rounded corners + horizontal scroll. */
  doc.querySelectorAll('table').forEach((tbl) => {
    const wrap = doc.createElement('div');
    wrap.className = 'table-wrap';
    tbl.before(wrap);
    wrap.appendChild(tbl);
  });

  /* Code blocks: highlight + collect mermaid blocks. */
  const mermaid: string[] = [];
  doc.querySelectorAll('pre > code').forEach((code) => {
    const lang = (code.className.match(LANG_RE) || [])[1];
    if (lang && lang.toLowerCase() === 'mermaid') {
      const shell = doc.createElement('div');
      shell.className = 'mermaid-block';
      shell.textContent = code.textContent;
      code.parentElement?.replaceWith(shell);
      mermaid.push(shell.textContent ?? '');
      return;
    }
    if (lang && hljs.getLanguage(lang)) {
      try {
        hljs.highlightElement(code as HTMLElement);
      } catch { /* leave plain */ }
    }
  });

  return {
    html: doc.body.innerHTML,
    toc,
    mermaid,
    docLinks,
  };
}
