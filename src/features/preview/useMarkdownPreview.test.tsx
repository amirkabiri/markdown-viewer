// Component tests for the debounced markdown preview state: 300 ms debounce
// while typing, immediate render on a document switch, the too-large guard
// and the toc/html contract. Fake timers drive the debounce deterministically
// (TESTING.md: no sleeps).
import { act, renderHook } from '@testing-library/react';
import {
  afterEach, describe, expect, it, vi,
} from 'vitest';

import { useMarkdownPreview } from './useMarkdownPreview';

afterEach(() => {
  vi.useRealTimers();
});

describe('useMarkdownPreview', () => {
  it('renders the initial text immediately', () => {
    const { result } = renderHook(() => useMarkdownPreview('# One'));

    expect(result.current.html).toContain('<h1');
    expect(result.current.toc).toEqual([]);
  });

  it('debounces re-renders while typing (300 ms)', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ text }) => useMarkdownPreview(text),
      { initialProps: { text: '# One' } },
    );

    rerender({ text: '# Two' });
    // Still inside the debounce window: the old render stands.
    expect(result.current.html).toContain('One');

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current.html).toContain('One');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.html).toContain('Two');
  });

  it('skips the debounce when the document identity changes', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ text, doc }) => useMarkdownPreview(text, { immediateKey: doc }),
      { initialProps: { text: '# Old doc', doc: 'a.md' } },
    );

    rerender({ text: '# New doc', doc: 'b.md' });
    expect(result.current.html).toContain('New doc');
  });

  it('collects h2-h4 toc entries in document order', () => {
    const md = '## Alpha\n\n### Beta\n\n#### Gamma\n\n##### Skipped';
    const { result } = renderHook(() => useMarkdownPreview(md));

    expect(result.current.toc.map((e) => e.text)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('flags documents over the 10 MB cap without rendering them', () => {
    const huge = `# x\n${'a'.repeat(10 * 1024 * 1024)}`;
    const { result } = renderHook(() => useMarkdownPreview(huge));

    expect(result.current.tooLarge).toBe(true);
    expect(result.current.html).toBe('');
  });
});
