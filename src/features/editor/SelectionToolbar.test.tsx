// Component tests for the editor selection toolbar: selection → menu (with
// scripted caret geometry faked at the DOM boundary — house style, jsdom has
// no layout engine), an action applying through the controller (textarea
// value + exactly one change notification), Escape dismissal, read-only
// suppression and the scroll/press dismissal gates.
//
// Timers: the interaction tests run on real timers and poll the 200 ms
// debounce with findByRole (the DocumentList-suite pattern for RAC menus,
// which hang under userEvent+fake timers); the debounce-window and
// absence-after-the-window assertions use fake timers with fireEvent
// (deterministic, no userEvent needed there).
import {
  act, fireEvent, render, screen,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

import { I18nProvider } from '../../app/i18n';

import Editor from './Editor';
import type { CaretMeasurer } from './caretGeometry';
import { useEditorController } from './useEditorController';
import type { EditorController } from './useEditorController';

/** Scripted caret geometry at the DOM boundary: offset-dependent x, fixed y. */
class FakeCaretMeasurer implements CaretMeasurer {
  readonly calls: number[] = [];

  measurePoint(_textarea: HTMLTextAreaElement, index: number): { x: number; y: number } {
    this.calls.push(index);
    return { x: 42 + index, y: 30 };
  }
}

let ctl: EditorController | undefined;
let fakeMeasurer: FakeCaretMeasurer;

function Inner({
  capture, readOnly, onDocChange,
}: {
  capture: (c: EditorController) => void;
  readOnly: boolean;
  // eslint-disable-next-line react/require-default-props -- test harness
  onDocChange?: (text: string) => void;
}) {
  const ctrl = useEditorController({ onDocChange });
  useEffect(() => {
    capture(ctrl);
  }, [capture, ctrl]);
  return (
    <Editor
      controller={ctrl}
      dir="ltr"
      ariaLabel="Markdown source"
      placeholder="# Start writing…"
      readOnly={readOnly}
      createMeasurer={() => ({ measureHeights: () => [28] })}
      createCaretMeasurer={() => fakeMeasurer}
    />
  );
}

function Harness({
  readOnly = false, onDocChange, lang = 'en',
}: {
  // eslint-disable-next-line react/require-default-props -- test harness
  readOnly?: boolean;
  // eslint-disable-next-line react/require-default-props -- test harness
  onDocChange?: (text: string) => void;
  // eslint-disable-next-line react/require-default-props -- test harness
  lang?: 'en' | 'fa';
}) {
  return (
    <I18nProvider lang={lang}>
      <Inner
        capture={(c) => {
          ctl = c;
        }}
        readOnly={readOnly}
        onDocChange={onDocChange}
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

function menu(): HTMLElement {
  return screen.getByRole('menu', { name: 'Formatting' });
}

/** Focus, make a non-empty selection and emit the document-level
 *  selectionchange the hook listens to (jsdom fires none on its own). */
function select(start: number, end: number): void {
  const ta = textarea();
  ta.focus();
  act(() => {
    ta.setSelectionRange(start, end);
    document.dispatchEvent(new Event('selectionchange'));
  });
}

/** Select and wait through the real 200 ms debounce (findBy polls). */
async function openMenu(start = 6, end = 11): Promise<void> {
  select(start, end);
  await screen.findByRole('menu', { name: 'Formatting' });
}

/** A real (small) execCommand at the boundary: performs the insertion, like
 *  browsers do, and records the call (the undo-stack-preserving path). */
function stubExecCommand(): ReturnType<typeof vi.fn> {
  const execCommand = vi.fn((_command: string, _ui: boolean, text?: string) => {
    if (typeof text === 'string') {
      const el = textarea();
      el.setRangeText(text, el.selectionStart ?? 0, el.selectionEnd ?? 0, 'end');
    }
    return true;
  });
  document.execCommand = execCommand;
  return execCommand;
}

beforeEach(() => {
  fakeMeasurer = new FakeCaretMeasurer();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // execCommand is a boundary we stub per-test; always drop the stub.
  Reflect.deleteProperty(document, 'execCommand');
});

describe('<SelectionToolbar />', () => {
  it('appears with the formatting actions ~200ms after a selection settles', async () => {
    vi.useFakeTimers();
    render(<Harness />);
    act(() => controller().loadDocument('hello world'));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    select(6, 11);
    // Still hidden inside the debounce window (drag-select flicker guard).
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(menu()).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Bold' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Italic' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Code block' })).toBeInTheDocument();
    // The anchor measured the selection START.
    expect(fakeMeasurer.calls).toEqual([6]);
  });

  it('applies Bold through the controller: undo-path write, one change event', async () => {
    const onDocChange = vi.fn();
    render(<Harness onDocChange={onDocChange} />);
    act(() => controller().loadDocument('hello world'));
    const execCommand = stubExecCommand();

    await openMenu();

    await userEvent.setup().click(screen.getByRole('menuitem', { name: 'Bold' }));

    expect(textarea().value).toBe('hello **world**');
    expect(onDocChange).toHaveBeenCalledTimes(1);
    expect(onDocChange).toHaveBeenCalledWith('hello **world**');
    // The undo-preserving write path was the one that ran.
    expect(execCommand).toHaveBeenCalledWith('insertText', false, '**world**');
    // The action dismisses the menu.
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('does not re-open from its own write echo after an action', async () => {
    vi.useFakeTimers();
    const onDocChange = vi.fn();
    render(<Harness onDocChange={onDocChange} />);
    act(() => controller().loadDocument('hello world'));
    stubExecCommand();

    select(6, 11);
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(menu()).toBeInTheDocument();

    // Enter fires the focused first item (Bold) — no userEvent under fake
    // timers (house pattern: fireEvent for menu keyboard paths).
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Bold' }), { key: 'Enter' });
    expect(textarea().value).toBe('hello **world**');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    // The write's focus/setSelectionRange/insertText burst emitted
    // selectionchange events — none of them may re-open the menu.
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('acts on the PINNED selection even if the caret moved since', async () => {
    render(<Harness />);
    act(() => controller().loadDocument('alpha beta'));
    stubExecCommand();

    await openMenu(6, 10);
    // The user's selection churns after the menu opened…
    act(() => {
      textarea().setSelectionRange(0, 0);
    });

    await userEvent.setup().click(screen.getByRole('menuitem', { name: 'Bold' }));

    // …the action still targeted the pinned range.
    expect(textarea().value).toBe('alpha **beta**');
  });

  it('hides on Escape without touching the document', async () => {
    render(<Harness />);
    act(() => controller().loadDocument('hello world'));

    await openMenu();

    await userEvent.setup().keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(textarea().value).toBe('hello world');
    // Focus restore to the textarea is RAC's FocusScope restoreFocus
    // (react-aria Overlay): it runs on the focusout jsdom never fires when
    // the focused menu unmounts, so the real-engine proof lives in e2e
    // (selection-toolbar.spec.ts types into the editor right after Escape).
  });

  it('is fully keyboard-operable once open (arrows + Enter apply)', async () => {
    render(<Harness />);
    act(() => controller().loadDocument('hello world'));
    stubExecCommand();

    await openMenu();

    const user = userEvent.setup();
    // autoFocus lands on the first item (Bold); one ArrowDown → Italic.
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Italic' })).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(textarea().value).toBe('hello *world*');
  });

  it('never shows for a read-only document', async () => {
    vi.useFakeTimers();
    render(<Harness readOnly />);
    act(() => controller().loadDocument('hello world'));

    select(6, 11);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(fakeMeasurer.calls).toEqual([]); // measured nothing, showed nothing
  });

  it('hides when the selection collapses', async () => {
    render(<Harness />);
    act(() => controller().loadDocument('hello world'));

    await openMenu();
    select(11, 11);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('a collapse also cancels a pending show', async () => {
    vi.useFakeTimers();
    render(<Harness />);
    act(() => controller().loadDocument('hello world'));

    select(2, 8);
    select(5, 5); // collapses before the debounce settles
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('hides when the textarea scrolls', async () => {
    render(<Harness />);
    act(() => controller().loadDocument('hello world'));

    await openMenu();
    act(() => {
      textarea().dispatchEvent(new Event('scroll'));
    });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('hides on pointer-down in the textarea', async () => {
    render(<Harness />);
    act(() => controller().loadDocument('hello world'));

    await openMenu();
    act(() => {
      textarea().dispatchEvent(new PointerEvent('pointerdown'));
    });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('localizes the menu to the UI language (فارسی)', async () => {
    render(<Harness lang="fa" />);
    act(() => controller().loadDocument('سلام دنیا'));

    select(0, 4);
    expect(
      await screen.findByRole('menu', { name: 'قالب‌بندی' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'درشت' })).toBeInTheDocument();
  });
});
