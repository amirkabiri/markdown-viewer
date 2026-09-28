// Unit tests for src/lib/markdown.ts — the pure render pipeline. The module
// needs a DOM for DOMPurify/DOMParser (it still writes nothing to the live
// document), so this file is .test.tsx → the jsdom vitest project. No legacy
// tests existed for this pipeline (it was fused to the preview DOM); the
// sanitized-output contract, TOC/anchor building, mermaid extraction and
// link/image enhancement are pinned here.

import { describe, expect, it } from 'vitest';
import {
  RENDER_DEBOUNCE_MS,
  isDocLink,
  mermaidConfig,
  renderMarkdown,
} from './markdown';

const BASE = 'https://example.github.io/markdown-viewer/docs/notes.md';

describe('renderMarkdown — basic rendering & sanitization', () => {
  it('renders GFM markdown to sanitized HTML with heading ids', () => {
    const { html } = renderMarkdown('# Hello\n\nA *short* doc with `code`.\n');
    expect(html).toContain('<h1 id="hello">');
    expect(html).toContain('<em>short</em>');
    expect(html).toContain('<code>code</code>');
  });

  it('strips scripts and event handlers (DOMPurify)', () => {
    const { html } = renderMarkdown('# Hi\n\n<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).toContain('<h1 id="hi">');
  });

  it('normalizes CRLF line endings before parsing', () => {
    const { html } = renderMarkdown('# Title\r\n\r\npara one\r\npara two\r\n');
    expect(html).toContain('<h1 id="title">');
    expect(html).not.toContain('\r');
  });

  it('enables GFM tables', () => {
    const { html } = renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |\n');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>1</td>');
  });
});

describe('renderMarkdown — headings, anchors and TOC', () => {
  it('adds a heading-anchor link and collects h2–h4 TOC entries in order', () => {
    const md = '## One\n\n### Two\n\n#### Three\n\n## Four\n';
    const { html, toc } = renderMarkdown(md);
    expect(html).toContain('<a class="heading-anchor" href="#one">#</a>');
    expect(toc).toEqual([
      { id: 'one', text: 'One', level: 2 },
      { id: 'two', text: 'Two', level: 3 },
      { id: 'three', text: 'Three', level: 4 },
      { id: 'four', text: 'Four', level: 2 },
    ]);
  });

  it('deduplicates heading ids with numeric suffixes', () => {
    const { toc } = renderMarkdown('## Dup\n\n## Dup\n\n## Dup\n');
    expect(toc.map((e) => e.id)).toEqual(['dup', 'dup-1', 'dup-2']);
  });

  it('falls back to "section" when the heading has no slugifiable text', () => {
    const { toc } = renderMarkdown('## 🎉\n');
    expect(toc[0].id).toBe('section');
  });

  it('leaves h1 and h5/h6 out of the TOC', () => {
    const { toc } = renderMarkdown('# Top\n\n## Kept\n\n##### Deep\n');
    expect(toc).toEqual([{ id: 'kept', text: 'Kept', level: 2 }]);
  });
});

describe('renderMarkdown — links and images', () => {
  it('flags .md links with data-md-link and returns their absolute hrefs', () => {
    const md = '[notes](other.md) and [site](https://example.com/) and [raw](x.md#section)\n';
    const { html, docLinks } = renderMarkdown(md, { baseUrl: BASE });
    expect(docLinks).toHaveLength(2);
    expect(docLinks[0]).toBe('https://example.github.io/markdown-viewer/docs/other.md');
    expect(html).toContain('data-md-link="true"');
  });

  it('opens absolute http(s) links in a new tab without the doc-link flag', () => {
    const { html, docLinks } = renderMarkdown('[site](https://example.com/a)\n', { baseUrl: BASE });
    expect(docLinks).toEqual([]);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('resolves relative image srcs, adds lazy loading and no-referrer', () => {
    const { html } = renderMarkdown('![pic](img/pic.png)\n', { baseUrl: BASE });
    expect(html).toContain('src="https://example.github.io/markdown-viewer/docs/img/pic.png"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('referrerpolicy="no-referrer"');
  });

  it('leaves data: images untouched', () => {
    const { html } = renderMarkdown('![d](data:image/png;base64,AAAA)\n', { baseUrl: BASE });
    expect(html).toContain('src="data:image/png;base64,AAAA"');
  });

  it('isDocLink mirrors the frozen .md rule (case-insensitive, query/hash ok)', () => {
    expect(isDocLink('https://x/a.md')).toBe(true);
    expect(isDocLink('https://x/a.MD#top')).toBe(true);
    expect(isDocLink('https://x/a.mdx')).toBe(false);
    expect(isDocLink('https://x/a.html')).toBe(false);
  });
});

describe('renderMarkdown — tables and code', () => {
  it('wraps tables in a .table-wrap div', () => {
    const { html } = renderMarkdown('| a |\n| - |\n| 1 |\n');
    expect(html).toMatch(/<div class="table-wrap"><table>/);
  });

  it('highlights recognized languages with highlight.js', () => {
    const { html } = renderMarkdown('```js\nconst a = 1;\n```\n');
    expect(html).toContain('hljs');
    expect(html).toContain('<span class="hljs-keyword">const</span>');
  });

  it('extracts mermaid blocks into .mermaid-block shells without rendering them', () => {
    const src = 'flowchart LR\n  A["برچسب"] --> B';
    const { html, mermaid } = renderMarkdown(`\`\`\`mermaid\n${src}\n\`\`\`\n`);
    // marked keeps the code content's trailing newline — legacy shells had it
    // too, and mermaid.parse tolerates it.
    expect(mermaid).toEqual([`${src}\n`]);
    expect(html).toContain('<div class="mermaid-block">');
    expect(html).toContain('A["برچسب"]'); // source kept verbatim in the shell
    expect(html).not.toContain('<svg'); // rendering is the UI's job
  });
});

describe('markdown render configuration', () => {
  it('keeps the frozen 300 ms debounce constant and the mermaid config', () => {
    expect(RENDER_DEBOUNCE_MS).toBe(300);
    expect(mermaidConfig('light')).toEqual({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'default',
      fontFamily: '"Vazirmatn", ui-sans-serif, system-ui, sans-serif',
    });
    expect(mermaidConfig('dark').theme).toBe('dark');
  });
});
