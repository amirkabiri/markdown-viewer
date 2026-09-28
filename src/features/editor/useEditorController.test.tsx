// Component tests for the editor controller + textarea: mirror sync, the
// frozen applyEdit mechanics (undo-stack path, setRangeText fallback,
// replace-document confirm, pinned ranges) and Tab insertion — the legacy
// behaviors the AI panel depends on.
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import {
  describe, expect, it, vi, afterEach,
} from 'vitest';

import { I18nProvider } from '../../app/i18n';

import Editor from './Editor';
import { useEditorController } from './useEditorController';
import type { EditorController } from './useEditorController';

let ctl: EditorController | undefined;

function Inner({ capture }: { capture: (c: EditorController) => void }) {
  const ctrl = useEditorController();
  useEffect(() => {
    capture(ctrl);
  }, [capture, ctrl]);
  return <Editor controller={ctrl} dir="ltr" ariaLabel="Markdown source" placeholder="# Start writing…" readOnly={false} />;
}

function Harness({ lang }: { lang: 'en' | 'fa' }) {
  return (
    <I18nProvider lang={lang}>
      <Inner capture={(c) => {
        ctl = c;
      }}
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

afterEach(() => {
  vi.restoreAllMocks();
  // execCommand is a boundary we stub per-test; always drop the stub.
  Reflect.deleteProperty(document, 'execCommand');
});

describe('value mirror', () => {
  it('mirrors user typing into controller state and getText()', async () => {
    render(<Harness lang="en" />);

    await userEvent.type(textarea(), '# Hello');

    expect(controller().text).toBe('# Hello');
    expect(controller().api.getText()).toBe('# Hello');
  });

  it('loadDocument replaces the textarea and mirror, caret at the start', () => {
    render(<Harness lang="en" />);
    act(() => controller().loadDocument('new body'));

    expect(textarea().value).toBe('new body');
    expect(controller().text).toBe('new body');
    expect(textarea().selectionStart).toBe(0);
    expect(textarea().selectionEnd).toBe(0);
  });

  it('keeps a stable api identity across re-renders', () => {
    const { rerender } = render(<Harness lang="en" />);
    const { api } = controller();
    rerender(<Harness lang="en" />);

    expect(controller().api).toBe(api);
  });
});

describe('selection access', () => {
  it('exposes the live selection and hasSelection()', () => {
    render(<Harness lang="en" />);
    act(() => controller().loadDocument('hello world'));
    act(() => textarea().setSelectionRange(0, 5));

    expect(controller().api.getSelection()).toEqual({ start: 0, end: 5 });
    expect(controller().api.hasSelection()).toBe(true);

    act(() => textarea().setSelectionRange(5, 5));

    expect(controller().api.getSelection()).toEqual({ start: 5, end: 5 });
    expect(controller().api.hasSelection()).toBe(false);
  });
});

describe('applyEdit', () => {
  it('inserts at the caret in cursor mode (setRangeText fallback)', () => {
    render(<Harness lang="en" />);
    act(() => controller().loadDocument('ab'));
    act(() => textarea().setSelectionRange(1, 1));

    let ok = false;
    act(() => {
      ok = controller().api.applyEdit('cursor', 'X');
    });

    expect(ok).toBe(true);
    expect(textarea().value).toBe('aXb');
    expect(controller().text).toBe('aXb');
    expect(textarea().selectionStart).toBe(2); // caret after the inserted text
  });

  it('replaces the selection in replace-selection mode', () => {
    render(<Harness lang="en" />);
    act(() => controller().loadDocument('hello world'));
    act(() => textarea().setSelectionRange(6, 11));

    act(() => {
      controller().api.applyEdit('replace-selection', 'qalam');
    });

    expect(textarea().value).toBe('hello qalam');
  });

  it('appends at the end of the document in append mode', () => {
    render(<Harness lang="en" />);
    act(() => controller().loadDocument('end'));
    act(() => textarea().setSelectionRange(0, 0)); // caret elsewhere on purpose

    act(() => {
      controller().api.applyEdit('append', '!');
    });

    expect(textarea().value).toBe('end!');
    expect(textarea().selectionStart).toBe(4);
  });

  it('prefers the undo-preserving execCommand path when available', () => {
    render(<Harness lang="en" />);
    act(() => controller().loadDocument('ab'));
    act(() => textarea().setSelectionRange(1, 1));
    const execCommand = vi.fn(() => true);
    document.execCommand = execCommand;

    act(() => {
      controller().api.applyEdit('cursor', 'X');
    });

    expect(execCommand).toHaveBeenCalledWith('insertText', false, 'X');
  });

  it('targets a pinned range instead of the moved live selection', () => {
    render(<Harness lang="en" />);
    act(() => controller().loadDocument('hello world'));
    act(() => textarea().setSelectionRange(0, 5)); // the pinned selection…
    act(() => textarea().setSelectionRange(11, 11)); // …the caret moved since

    act(() => {
      controller().api.applyEdit('replace-selection', 'HOWDY', [0, 5]);
    });

    expect(textarea().value).toBe('HOWDY world');
  });

  it('replaces the whole document after confirmation, aborts on cancel', () => {
    render(<Harness lang="en" />);
    act(() => controller().loadDocument('old doc'));

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    let ok = true;
    act(() => {
      ok = controller().api.applyEdit('replace-document', 'new doc');
    });

    expect(confirm).toHaveBeenCalledWith('Replace the whole document with this text?');
    expect(ok).toBe(false);
    expect(textarea().value).toBe('old doc');

    confirm.mockReturnValue(true);
    act(() => {
      ok = controller().api.applyEdit('replace-document', 'new doc');
    });

    expect(ok).toBe(true);
    expect(textarea().value).toBe('new doc');
    expect(controller().text).toBe('new doc');
  });

  it('localizes the replace-document confirmation to the UI language', () => {
    render(<Harness lang="fa" />);
    act(() => controller().loadDocument('قدیمی'));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    act(() => {
      controller().api.applyEdit('replace-document', 'جدید');
    });

    expect(confirm).toHaveBeenCalledWith('کل سند با این متن جایگزین شود؟');
    expect(textarea().value).toBe('قدیمی');
  });
});

describe('Tab key', () => {
  it('inserts two spaces instead of moving focus', async () => {
    render(<Harness lang="en" />);
    act(() => controller().loadDocument('ab'));

    textarea().focus();
    act(() => textarea().setSelectionRange(1, 1));
    await userEvent.keyboard('{Tab}');

    expect(textarea().value).toBe('a  b');
    expect(textarea().selectionStart).toBe(3);
  });
});

describe('autosave callback (onDocChange)', () => {
  function InnerWithChange({ onDocChange }: { onDocChange: (text: string) => void }) {
    const ctrl = useEditorController({ onDocChange });
    useEffect(() => {
      ctl = ctrl;
    }, [ctrl]);
    return (
      <Editor
        controller={ctrl}
        dir="ltr"
        ariaLabel="Markdown source"
        placeholder=""
        readOnly={false}
      />
    );
  }

  function HarnessWithChange({ onDocChange }: { onDocChange: (text: string) => void }) {
    return (
      <I18nProvider lang="en">
        <InnerWithChange onDocChange={onDocChange} />
      </I18nProvider>
    );
  }

  it('fires on user typing, tab-insert and AI edits — never on loadDocument', async () => {
    const onDocChange = vi.fn();
    render(<HarnessWithChange onDocChange={onDocChange} />);

    act(() => controller().loadDocument('base'));
    expect(onDocChange).not.toHaveBeenCalled(); // loading is not an edit

    await userEvent.type(textarea(), '!');
    expect(onDocChange).toHaveBeenLastCalledWith('base!');

    textarea().focus();
    act(() => textarea().setSelectionRange(5, 5));
    await userEvent.keyboard('{Tab}');
    expect(onDocChange).toHaveBeenLastCalledWith('base!  ');

    act(() => controller().api.applyEdit('append', '?'));
    expect(onDocChange).toHaveBeenLastCalledWith('base!  ?');
  });
});
