// Component tests for <Preview /> — injection, error states, copy buttons,
// md-link interception, the direction pass and the mermaid failure UI.
// mermaid is vi.mock'ed (TESTING.md last resort, justified: a ~2 MB
// browser-only rendering SDK — jsdom has no SVG geometry), scripted as a
// fake whose parse/run behavior each test controls.
import {
  act, fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { createRef } from 'react';
import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';

import mermaid from 'mermaid';
import { I18nProvider } from '../../app/i18n';
import { mermaidConfig } from '../../lib/markdown';

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
    html: '', toc: [], error: null, tooLarge: false, ...overrides,
  };
}

interface HarnessOptions {
  state: MarkdownPreviewState;
  dirMode: 'auto' | 'ltr' | 'rtl';
  dir: 'ltr' | 'rtl';
  theme: 'light' | 'dark';
  onSpyChange: (id: string | null) => void;
  onOpenDocLink: (href: string) => void;
}

function Harness({
  state, dirMode, dir, theme, onSpyChange, onOpenDocLink,
}: HarnessOptions) {
  const scrollRef = createRef<HTMLDivElement>();
  return (
    <I18nProvider lang="en">
      <Preview
        state={state}
        dir={dir}
        dirMode={dirMode}
        theme={theme}
        docIdentity="doc"
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
