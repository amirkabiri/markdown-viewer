// Component tests for the Editor's line-number gutter: number count per
// logical line, the aria-hidden display-only contract, scroll-sync wiring,
// rAF-batched measurement and the digit-driven width. Geometry is scripted
// through a fake measurer injected at the Editor boundary (house style:
// fakes over mocks — jsdom has no layout engine, TESTING.md).
import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';

import { I18nProvider } from '../../app/i18n';

import Editor from './Editor';
import type { LineMeasurer } from './lineMeasurer';
import { useEditorController } from './useEditorController';
import type { EditorController } from './useEditorController';

/**
 * A real (tiny) measurer with scripted geometry and recorded inputs: every
 * logical line is `rowHeight` tall, except lines longer than `wrapAfter`
 * chars, which wrap to two visual rows.
 */
class FakeLineMeasurer implements LineMeasurer {
  readonly calls: string[][] = [];

  constructor(
    private readonly rowHeight = 28,
    private readonly wrapAfter = Number.POSITIVE_INFINITY,
  ) {}

  measureHeights(lines: readonly string[]): number[] {
    this.calls.push([...lines]);
    return lines.map((line) => (line.length > this.wrapAfter ? this.rowHeight * 2 : this.rowHeight));
  }
}

let ctl: EditorController | undefined;

function Inner({
  capture, createMeasurer,
}: {
  capture: (c: EditorController) => void;
  createMeasurer?: (textarea: HTMLTextAreaElement) => LineMeasurer;
}) {
  const ctrl = useEditorController();
  useEffect(() => {
    capture(ctrl);
  }, [capture, ctrl]);
  return (
    <Editor
      controller={ctrl}
      dir="ltr"
      ariaLabel="Markdown source"
      placeholder="# Start writing…"
      readOnly={false}
      createMeasurer={createMeasurer}
    />
  );
}

function Harness({ createMeasurer }: { createMeasurer?: (textarea: HTMLTextAreaElement) => LineMeasurer }) {
  return (
    <I18nProvider lang="en">
      <Inner capture={(c) => {
        ctl = c;
      }}
      createMeasurer={createMeasurer}
      />
    </I18nProvider>
  );
}

function controller(): EditorController {
  if (!ctl) throw new Error('controller not captured');
  return ctl;
}

function textarea(): HTMLTextAreaElement {
  return screen.getByLabelText('Markdown source');
}

/** The gutter root is the aria-hidden ancestor of the rendered numbers. */
function gutterRoot(): HTMLElement {
  const marker = screen.getByText('1', { exact: true });
  const root = marker.closest('[aria-hidden="true"]');
  if (!(root instanceof HTMLElement)) throw new Error('gutter root not found');
  return root;
}

async function renderWithFake(fake: FakeLineMeasurer = new FakeLineMeasurer()) {
  render(<Harness createMeasurer={() => fake} />);
  await waitFor(() => expect(fake.calls.length).toBeGreaterThan(0));
  return fake;
}

describe('<Editor /> line-number gutter', () => {
  it('renders one number per logical line', async () => {
    await renderWithFake();
    act(() => controller().loadDocument('alpha\nbeta\ngamma'));

    await waitFor(() => expect(screen.getByText('3', { exact: true })).toBeInTheDocument());
    expect(screen.getByText('1', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('2', { exact: true })).toBeInTheDocument();
    expect(screen.queryByText('4', { exact: true })).not.toBeInTheDocument();
  });

  it('shows number 1 for an empty document', async () => {
    await renderWithFake();
    act(() => controller().loadDocument(''));

    await waitFor(() => expect(screen.getByText('1', { exact: true })).toBeInTheDocument());
    expect(screen.queryByText('2', { exact: true })).not.toBeInTheDocument();
  });

  it('hides the numbers from the accessibility tree', async () => {
    await renderWithFake();
    act(() => controller().loadDocument('alpha\nbeta'));

    await waitFor(() => expect(screen.getByText('2', { exact: true })).toBeInTheDocument());
    const root = gutterRoot();
    expect(root).toHaveAttribute('aria-hidden', 'true');
    // The textarea must stay the editable, tabbable surface.
    expect(textarea()).not.toHaveAttribute('tabindex');
  });

  it('positions each number at its line top, wrapped lines included', async () => {
    // Line 1 wraps to two rows (28 * 2 = 56), so line 2 starts at 56.
    const fake = new FakeLineMeasurer(28, 10);
    render(<Harness createMeasurer={() => fake} />);
    act(() => controller().loadDocument('a very long line that wraps\nshort'));

    await waitFor(() => expect(screen.getByText('2', { exact: true })).toBeInTheDocument());
    expect(screen.getByText('1', { exact: true }).style.top).toBe('0px');
    expect(screen.getByText('2', { exact: true }).style.top).toBe('56px');
  });

  it('mirrors textarea scrolling into the gutter transform', async () => {
    await renderWithFake();
    act(() => controller().loadDocument('alpha\nbeta\ngamma'));
    await waitFor(() => expect(screen.getByText('3', { exact: true })).toBeInTheDocument());

    act(() => {
      textarea().scrollTop = 120;
      textarea().dispatchEvent(new Event('scroll'));
    });

    // The numbers move inside a translated column — one transform per
    // scroll, never a per-number repaint.
    await waitFor(() => {
      const column = screen.getByText('1', { exact: true }).parentElement;
      expect(column?.style.transform).toBe('translateY(-120px)');
    });
  });

  it('recomputes metrics when the text changes after typing', async () => {
    const fake = await renderWithFake();
    act(() => controller().loadDocument('first'));

    await waitFor(() => expect(fake.calls.at(-1)).toEqual(['first']));
    act(() => controller().loadDocument('first\nsecond'));

    await waitFor(() => expect(fake.calls.at(-1)).toEqual(['first', 'second']));
    expect(screen.getByText('2', { exact: true })).toBeInTheDocument();
  });

  it('coalesces same-frame text changes into a single measurement', async () => {
    const fake = await renderWithFake();
    const measured = fake.calls.length;

    act(() => {
      controller().loadDocument('one');
      controller().loadDocument('one\ntwo');
    });

    await waitFor(() => expect(fake.calls.length).toBe(measured + 1));
    expect(fake.calls.at(-1)).toEqual(['one', 'two']);
  });

  it('grows the gutter width when the document crosses 9 lines', async () => {
    await renderWithFake();
    act(() => controller().loadDocument('1\n2\n3\n4\n5\n6\n7\n8\n9'));
    await waitFor(() => expect(screen.getByText('9', { exact: true })).toBeInTheDocument());

    const wrap = textarea().parentElement;
    if (!wrap) throw new Error('editor wrapper not found');
    expect(wrap.style.getPropertyValue('--gutter-w')).toContain('1ch');

    act(() => controller().loadDocument('1\n2\n3\n4\n5\n6\n7\n8\n9\n10'));
    await waitFor(() => expect(wrap.style.getPropertyValue('--gutter-w')).toContain('2ch'));
  });
});
