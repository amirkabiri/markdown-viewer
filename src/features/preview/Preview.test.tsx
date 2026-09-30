// Component tests for <Preview /> — injection, error states, copy buttons,
// md-link interception, the direction pass, the mermaid failure UI, and the
// document-switch scroll gating (typing keeps the scroll position).
// mermaid is vi.mock'ed (TESTING.md last resort, justified: a ~2 MB
// browser-only rendering SDK — jsdom has no SVG geometry), scripted as a
// fake whose parse/run behavior each test controls.
import {
  act, fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { createRef } from 'react';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

import mermaid from 'mermaid';
import { I18nProvider } from '../../app/i18n';
import { previewExcerptQueue, type PreviewExcerptPayload } from '../ai';
import { mermaidConfig, renderMarkdown } from '../../lib/markdown';

import Preview from './Preview';
import type { MarkdownPreviewState } from './useMarkdownPreview';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    parse: vi.fn(async () => true),
    // Fake the rendered SVG by replacing each shell's content (the same
    // effect mermaid.run has on a shell).
    run: vi.fn(async ({ nodes }: { nodes: Element[] }) => {
      nodes.forEach((n) => Object.assign(n, { textContent: '<svg>diagram</svg>' }));
    }),
  },
}));

const mermaidMock = vi.mocked(mermaid);

function makeState(overrides: Partial<MarkdownPreviewState> = {}): MarkdownPreviewState {
  return {
    html: '', toc: [], error: null, tooLarge: false, source: '', ...overrides,
  };
}

interface HarnessOptions {
  state: MarkdownPreviewState;
  dirMode: 'auto' | 'ltr' | 'rtl';
  dir: 'ltr' | 'rtl';
  theme: 'light' | 'dark';
  /** Document identity — drives the scroll reset + hash-jump gating. */
  docIdentity: string;
  onSpyChange: (id: string | null) => void;
  onOpenDocLink: (href: string) => void;
}

function Harness({
  state, dirMode, dir, theme, docIdentity, onSpyChange, onOpenDocLink,
}: HarnessOptions) {
  const scrollRef = createRef<HTMLDivElement>();
  return (
    <I18nProvider lang="en">
      <Preview
        state={state}
        dir={dir}
        dirMode={dirMode}
        theme={theme}
        docIdentity={docIdentity}
        scrollRef={scrollRef}
        onSpyChange={onSpyChange}
        onOpenDocLink={onOpenDocLink}
      />
    </I18nProvider>
  );
}

/** Renders with the ltr/light defaults each test overrides individually. */
function renderHarness(overrides: Partial<HarnessOptions> & { state: MarkdownPreviewState }) {
  return render(
    <Harness
      dirMode="ltr"
      dir="ltr"
      theme="light"
      docIdentity="doc"
      onSpyChange={vi.fn()}
      onOpenDocLink={vi.fn()}
      {...overrides}
    />,
  );
}

function article(): HTMLElement {
  return document.querySelector('article') as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('<Preview /> injection', () => {
  it('injects the sanitized html and rebuilds on theme change', () => {
    const state = makeState({ html: '<h2 id="a">Hi</h2>' });
    const { rerender } = renderHarness({ state });
    expect(article().innerHTML).toContain('Hi');

    rerender(
      <Harness
        dirMode="ltr"
        dir="ltr"
        theme="dark"
        docIdentity="doc"
        onSpyChange={vi.fn()}
        onOpenDocLink={vi.fn()}
        state={state}
      />,
    );
    // A fresh article element is mounted (fresh mermaid shells per theme).
    expect(article().innerHTML).toContain('Hi');
  });

  it('renders the too-large state as an error note', () => {
    renderHarness({ state: makeState({ tooLarge: true }) });

    const note = article().querySelector('.error-note');
    expect(note).toHaveTextContent('Document is too large (limit 10 MB)');
  });

  it('renders parse errors as an error note after the empty body', () => {
    renderHarness({ state: makeState({ error: 'boom' }) });

    expect(article().querySelector('.error-note')).toHaveTextContent('boom');
  });
});

describe('<Preview /> copy buttons', () => {
  it('attaches a copy button to code blocks and copies on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderHarness({
      state: makeState({ html: '<pre><code class="language-js">const a = 1;</code></pre>' }),
    });

    const btn = article().querySelector('button.copy-btn') as HTMLButtonElement;
    expect(btn).toHaveTextContent('Copy');

    fireEvent.click(btn);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('const a = 1;');
      expect(btn).toHaveTextContent('Copied!');
    });
  });
});

describe('<Preview /> document links', () => {
  it('intercepts *.md link clicks and reports the href', () => {
    const onOpenDocLink = vi.fn();
    renderHarness({
      state: makeState({ html: '<a href="http://x/guide.md" data-md-link="true">guide</a>' }),
      onOpenDocLink,
    });

    fireEvent.click(screen.getByRole('link', { name: 'guide' }));

    expect(onOpenDocLink).toHaveBeenCalledWith('http://x/guide.md');
  });
});

describe('<Preview /> content direction', () => {
  it('marks every block dir=auto in auto mode', () => {
    renderHarness({
      state: makeState({ html: '<p>one</p><li>two</li><blockquote>three</blockquote>' }),
      dirMode: 'auto',
      dir: 'ltr',
    });

    expect(article().querySelector('p')).toHaveAttribute('dir', 'auto');
    expect(article().querySelector('li')).toHaveAttribute('dir', 'auto');
    expect(article().querySelector('blockquote')).toHaveAttribute('dir', 'auto');
  });

  it('leaves blocks to inherit in forced mode', () => {
    renderHarness({
      state: makeState({ html: '<p>one</p>' }),
      dirMode: 'rtl',
      dir: 'rtl',
    });

    expect(article().querySelector('p')).not.toHaveAttribute('dir');
    expect(article()).toHaveAttribute('dir', 'rtl');
  });
});

describe('<Preview /> scroll spy', () => {
  it('reports the active heading on scroll', async () => {
    const onSpyChange = vi.fn();
    renderHarness({
      state: makeState({ html: '<h2 id="one">One</h2><h2 id="two">Two</h2>' }),
      onSpyChange,
    });

    const container = article().parentElement as HTMLElement;
    act(() => {
      container.dispatchEvent(new Event('scroll'));
    });

    // jsdom rects are all zero → the last heading is past the threshold.
    await waitFor(() => {
      expect(onSpyChange).toHaveBeenCalledWith('two');
    });
  });
});

describe('<Preview /> document-switch scrolling', () => {
  it('keeps the container scroll across typing-driven html updates (same identity)', () => {
    const { rerender } = renderHarness({
      docIdentity: 'doc-a',
      state: makeState({ html: '<p>one</p>' }),
    });
    const container = article().parentElement as HTMLElement;
    act(() => {
      container.scrollTop = 500;
    });

    // Same document, new html: exactly what a 300 ms debounced preview
    // update while typing produces. The view must not move.
    rerender(
      <Harness
        dirMode="ltr"
        dir="ltr"
        theme="light"
        docIdentity="doc-a"
        onSpyChange={vi.fn()}
        onOpenDocLink={vi.fn()}
        state={makeState({ html: '<p>one</p><p>two</p>' })}
      />,
    );

    expect(container.scrollTop).toBe(500);
  });

  it('resets the container scroll when the document identity changes', () => {
    const { rerender } = renderHarness({
      docIdentity: 'doc-a',
      state: makeState({ html: '<p>one</p>' }),
    });
    const container = article().parentElement as HTMLElement;
    act(() => {
      container.scrollTop = 500;
    });

    rerender(
      <Harness
        dirMode="ltr"
        dir="ltr"
        theme="light"
        docIdentity="doc-b"
        onSpyChange={vi.fn()}
        onOpenDocLink={vi.fn()}
        state={makeState({ html: '<h2 id="next">Other doc</h2>' })}
      />,
    );

    expect(container.scrollTop).toBe(0);
  });

  it('jumps to the location hash once per document — typing updates never re-trigger it', () => {
    // jsdom has no layout engine: no requestAnimationFrame and no
    // scrollIntoView. Both are stubbed at the DOM boundary so the jump
    // itself is observable (restored in the finally below).
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      window.history.replaceState(null, '', '/#goal');
      // Async-arrival shape (a deep link like ?file=README.md#goal): the
      // identity is already set while the article is still empty.
      const { rerender } = renderHarness({
        docIdentity: 'doc-a',
        state: makeState({ html: '' }),
      });
      expect(scrollIntoView).not.toHaveBeenCalled();

      // The content lands (same identity) — now the target exists: jump.
      rerender(
        <Harness
          dirMode="ltr"
          dir="ltr"
          theme="light"
          docIdentity="doc-a"
          onSpyChange={vi.fn()}
          onOpenDocLink={vi.fn()}
          state={makeState({ html: '<h2 id="goal">Goal</h2>' })}
        />,
      );
      expect(scrollIntoView).toHaveBeenCalledTimes(1);

      // A typing-driven html update must not scroll again.
      rerender(
        <Harness
          dirMode="ltr"
          dir="ltr"
          theme="light"
          docIdentity="doc-a"
          onSpyChange={vi.fn()}
          onOpenDocLink={vi.fn()}
          state={makeState({ html: '<h2 id="goal">Goal</h2><p>more</p>' })}
        />,
      );
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});

describe('<Preview /> mermaid', () => {
  it('renders mermaid shells through the documented hook point', async () => {
    renderHarness({
      state: makeState({ html: '<div class="mermaid-block">flowchart TD\n A-->B</div>' }),
    });

    await waitFor(() => {
      expect(article().querySelector('.mermaid-block')).toHaveTextContent('diagram');
    });
    expect(mermaidMock.initialize).toHaveBeenCalledWith(mermaidConfig('light'));
  });

  it('marks failing diagrams mermaid-failed with the localized error note', async () => {
    mermaidMock.parse.mockRejectedValueOnce(new Error('bad syntax'));
    renderHarness({
      state: makeState({ html: '<div class="mermaid-block">nonsense</div>' }),
    });

    await waitFor(() => {
      const shell = article().querySelector('.mermaid-block');
      expect(shell?.classList.contains('mermaid-failed')).toBe(true);
      expect(shell?.nextElementSibling).toHaveTextContent('Mermaid diagram error: bad syntax');
    });
  });
});

/* ---------------- ask-AI affordance (preview selection → AI) ---------------- */

const ASK_SOURCE = [
  '# Guide',
  '',
  'First paragraph.',
  '',
  '## Details',
  '',
  'Body text here.',
  '',
].join('\n');

/** Selects `text` inside the article the way a user drag would. */
function selectText(text: string): void {
  const walker = document.createTreeWalker(article(), NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node && !(node.textContent ?? '').includes(text)) node = walker.nextNode();
  if (!node) throw new Error(`text not rendered: ${text}`);
  const start = (node.textContent ?? '').indexOf(text);
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, start + text.length);
  const selection = window.getSelection();
  if (!selection) throw new Error('no selection API');
  selection.removeAllRanges();
  selection.addRange(range);
  act(() => {
    document.dispatchEvent(new Event('selectionchange'));
  });
}

/** Selects the range between two article blocks (multi-block selections). */
function selectBetween(startEl: Element, endEl: Element, endOffset: number): void {
  const range = document.createRange();
  range.setStartBefore(startEl);
  range.setEnd(endEl, endOffset);
  const selection = window.getSelection();
  if (!selection) throw new Error('no selection API');
  selection.removeAllRanges();
  selection.addRange(range);
  act(() => {
    document.dispatchEvent(new Event('selectionchange'));
  });
}

function clearSelection(): void {
  window.getSelection()?.removeAllRanges();
  act(() => {
    document.dispatchEvent(new Event('selectionchange'));
  });
}

describe('<Preview /> ask-AI affordance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/');
    window.getSelection()?.removeAllRanges();
    previewExcerptQueue.consume();
  });

  afterEach(() => {
    previewExcerptQueue.consume();
    window.getSelection()?.removeAllRanges();
  });

  it('offers an accessible affordance on selection and publishes the excerpt with source anchoring', () => {
    const published: PreviewExcerptPayload[] = [];
    const unsubscribe = previewExcerptQueue.subscribe((payload) => published.push(payload));
    renderHarness({
      state: makeState({ html: renderMarkdown(ASK_SOURCE).html, source: ASK_SOURCE }),
    });

    selectText('First paragraph.');
    const button = screen.getByRole('button', { name: 'Ask AI about this' });
    expect(button).toBeVisible();

    fireEvent.click(button);

    expect(published).toHaveLength(1);
    expect(published[0]).toEqual({
      excerpt: 'First paragraph.',
      sourceRange: {
        startOffset: ASK_SOURCE.indexOf('First paragraph.'),
        endOffset: ASK_SOURCE.indexOf('First paragraph.') + 'First paragraph.'.length,
        startLine: 3,
        endLine: 3,
      },
      headingPath: ['Guide'],
    });
    // The affordance step is over after activation.
    expect(screen.queryByRole('button', { name: 'Ask AI about this' })).not.toBeInTheDocument();
    unsubscribe();
  });

  it('joins a multi-block selection and unions the source lines', () => {
    const published: PreviewExcerptPayload[] = [];
    const unsubscribe = previewExcerptQueue.subscribe((payload) => published.push(payload));
    renderHarness({
      state: makeState({ html: renderMarkdown(ASK_SOURCE).html, source: ASK_SOURCE }),
    });

    const first = article().querySelector('p');
    const h2 = article().querySelector('h2');
    if (!first || !h2) throw new Error('fixture missing');
    selectBetween(first, h2, h2.childNodes.length);

    fireEvent.click(screen.getByRole('button', { name: 'Ask AI about this' }));

    expect(published[0]?.excerpt).toBe('First paragraph.\nDetails');
    expect(published[0]?.sourceRange).toMatchObject({ startLine: 3, endLine: 5 });
    unsubscribe();
  });

  it('suppresses the affordance for collapsed or whitespace-only selections', () => {
    renderHarness({
      state: makeState({ html: renderMarkdown(ASK_SOURCE).html, source: ASK_SOURCE }),
    });

    clearSelection();
    expect(screen.queryByRole('button', { name: 'Ask AI about this' })).not.toBeInTheDocument();

    // The "selection" between two adjacent blocks carries no text at all.
    const first = article().querySelector('p');
    const h2 = article().querySelector('h2');
    if (!first || !h2) throw new Error('fixture missing');
    const range = document.createRange();
    range.setStart(first, first.childNodes.length);
    range.setEnd(h2, 0);
    const selection = window.getSelection();
    if (!selection) throw new Error('no selection API');
    selection.removeAllRanges();
    selection.addRange(range);
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
    });

    expect(screen.queryByRole('button', { name: 'Ask AI about this' })).not.toBeInTheDocument();
  });

  it('hides the affordance when the selection collapses again', () => {
    renderHarness({
      state: makeState({ html: renderMarkdown(ASK_SOURCE).html, source: ASK_SOURCE }),
    });

    selectText('First paragraph.');
    expect(screen.getByRole('button', { name: 'Ask AI about this' })).toBeInTheDocument();

    clearSelection();
    expect(screen.queryByRole('button', { name: 'Ask AI about this' })).not.toBeInTheDocument();
  });

  it('dismisses on Escape and returns focus to the preview scroll region', () => {
    renderHarness({
      state: makeState({ html: renderMarkdown(ASK_SOURCE).html, source: ASK_SOURCE }),
    });

    selectText('First paragraph.');
    const button = screen.getByRole('button', { name: 'Ask AI about this' });
    button.focus();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('button', { name: 'Ask AI about this' })).not.toBeInTheDocument();
    const container = article().parentElement as HTMLElement;
    expect(document.activeElement).toBe(container);
  });

  it('renders the localized label in Persian', () => {
    render(
      <I18nProvider lang="fa">
        <Preview
          state={makeState({ html: renderMarkdown(ASK_SOURCE).html, source: ASK_SOURCE })}
          dir="rtl"
          dirMode="rtl"
          theme="light"
          docIdentity="doc"
          scrollRef={createRef()}
          onSpyChange={vi.fn()}
          onOpenDocLink={vi.fn()}
        />
      </I18nProvider>,
    );

    selectText('First paragraph.');
    expect(screen.getByRole('button', { name: 'پرسش از هوش مصنوعی دربارهٔ این' })).toBeInTheDocument();
  });
});
