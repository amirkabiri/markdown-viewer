// Component tests for the EditorApi context: the api object is published
// unchanged (stable identity — the AI panel may hold it across renders) and
// useEditor fails loudly outside a provider.
import { render, screen } from '@testing-library/react';
import {
  describe, expect, it, vi,
} from 'vitest';

import type { EditorApi } from './api';
import { EditorProvider, useEditor } from './context';

function makeFakeApi(): EditorApi {
  return {
    getText: () => 'hello',
    getSelection: () => ({ start: 0, end: 5 }),
    hasSelection: () => true,
    applyEdit: () => true,
  };
}

describe('<EditorProvider /> + useEditor()', () => {
  it('publishes the api object with a stable identity across re-renders', () => {
    const api = makeFakeApi();
    const seen: EditorApi[] = [];

    function Probe() {
      seen.push(useEditor());
      return null;
    }

    const { rerender } = render(
      <EditorProvider api={api}>
        <Probe />
      </EditorProvider>,
    );
    rerender(
      <EditorProvider api={api}>
        <Probe />
      </EditorProvider>,
    );

    expect(seen).toHaveLength(2);
    expect(seen.every((x) => x === api)).toBe(true);
  });

  it('exposes the live contract methods to consumers', () => {
    function Probe() {
      const editor = useEditor();
      return <output>{editor.getText()}</output>;
    }

    render(
      <EditorProvider api={makeFakeApi()}>
        <Probe />
      </EditorProvider>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('hello');
  });

  it('throws when useEditor is used outside a provider', () => {
    function Probe() {
      useEditor();
      return null;
    }

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<Probe />)).toThrow('useEditor must be used inside <EditorProvider>');
    } finally {
      consoleError.mockRestore();
    }
  });
});
