// Component tests for the composed shell: layout landmarks, the boot
// document, editor→preview flow, theme/lang persistence and pane modes.
// The network boundary is a stubbed global fetch returning real Responses
// (house style); storage is the real jsdom localStorage, reset per test.
// The AI panel is stubbed via vi.mock (justified last resort per TESTING.md:
// the panel drags the whole builtin-AI/fetch-SSE boundary along) — only its
// mounting through the topbar toggle is asserted here.
import {
  render, screen, waitFor, within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

import App from './App';

vi.mock('./features/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./features/ai')>();
  function StubAiPanel() {
    return (
      <button type="button" onClick={() => actual.aiToast('Bridged from the panel')}>
        Emit AI toast
      </button>
    );
  }
  return { ...actual, AiPanel: StubAiPanel };
});

function stubFetch(body: string, ok = true): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: ok ? 200 : 404 })));
}

function stubClipboard(): { writeText: ReturnType<typeof vi.fn> } {
  const clipboard = { writeText: vi.fn(async () => {}) };
  Object.assign(navigator, { clipboard });
  return clipboard;
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  document.documentElement.lang = '';
  document.documentElement.dir = 'ltr';
  delete document.documentElement.dataset.theme;
  stubFetch('# Stub README\n\nhello from the boot document');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('<App /> shell', () => {
  it('renders the topbar, workspace and footer landmarks', () => {
    render(<App />);

    expect(screen.getByRole('banner')).toHaveTextContent('Qalam');
    expect(screen.getByRole('main')).toBeVisible();
    expect(screen.getByRole('contentinfo')).toHaveTextContent('Qalam');
    expect(screen.getByRole('link', { name: 'GitHub repository' })).toHaveAttribute(
      'href',
      'https://github.com/amirkabiri/qalam',
    );
  });

  it('renders the boot document from README.md into the preview', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: /Stub README/ })).toBeVisible();
    // The editor mirrors the loaded document.
    expect(screen.getByLabelText('Markdown source'))
      .toHaveValue('# Stub README\n\nhello from the boot document');
  });

  it('falls back to the embedded welcome doc when the boot fetch fails', async () => {
    stubFetch('nope', false);
    render(<App />);

    expect(await screen.findByRole('heading', { name: /Markdown Viewer/ })).toBeVisible();
  });

  it('updates the preview as the user types (after the debounce)', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: /Stub README/ }, { timeout: 4000 });

    const editor = screen.getByLabelText('Markdown source');
    await userEvent.clear(editor);
    await userEvent.type(editor, '# E2E Hello');

    expect(await screen.findByRole('heading', { name: /E2E Hello/ })).toBeVisible();
  });

  it('toggles the theme, flipping data-theme and persisting mv:theme', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: /Stub README/ }, { timeout: 4000 });

    await userEvent.click(screen.getByRole('button', { name: 'Toggle light / dark theme' }));

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(JSON.parse(localStorage.getItem('mv:theme') as string)).toBe('dark');

    await userEvent.click(screen.getByRole('button', { name: 'Toggle light / dark theme' }));

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(JSON.parse(localStorage.getItem('mv:theme') as string)).toBe('light');
  });

  it('toggles the language, flipping html lang/dir and persisting mv:lang', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: /Stub README/ }, { timeout: 4000 });

    // The button announces the language it switches TO (legacy toggleLang).
    await userEvent.click(screen.getByRole('button', { name: 'تغییر زبان به فارسی' }));

    expect(document.documentElement.lang).toBe('fa');
    expect(document.documentElement.dir).toBe('rtl');
    expect(JSON.parse(localStorage.getItem('mv:lang') as string)).toBe('fa');
    expect(screen.getByRole('banner')).toHaveTextContent('قلم');
  });

  it('persists the pane mode when switching to preview-only', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: /Stub README/ }, { timeout: 4000 });

    await userEvent.click(screen.getByRole('button', { name: 'Preview only' }));

    expect(JSON.parse(localStorage.getItem('mv:mode') as string)).toBe('preview');
  });

  it('copies a share link and toasts "copied"', async () => {
    const clipboard = stubClipboard();
    render(<App />);
    await screen.findByRole('heading', { name: /Stub README/ }, { timeout: 4000 });

    await userEvent.click(screen.getByRole('button', { name: 'Copy link to this document' }));

    await waitFor(() => {
      expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    });
    const url = clipboard.writeText.mock.calls[0][0] as string;
    expect(url).toContain('#d=');
    expect(screen.getByRole('status')).toHaveTextContent('Link copied to clipboard');
  });

  it('opens the dialog from the Open button and closes it again', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: /Stub README/ }, { timeout: 4000 });

    await userEvent.click(screen.getByRole('button', { name: /Open/ }));
    expect(screen.getByRole('heading', { name: 'Open a document' })).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Open a document' })).toBeNull();
    });
  });

  it('toggles the AI panel by mounting and unmounting it', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: /Stub README/ }, { timeout: 4000 });

    expect(screen.queryByRole('button', { name: 'Emit AI toast' })).not.toBeInTheDocument();
    const aiButton = screen.getByRole('button', { name: 'AI assistant' });
    expect(aiButton).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(aiButton);
    expect(screen.getByRole('button', { name: 'Emit AI toast' })).toBeInTheDocument();
    expect(aiButton).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(aiButton);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Emit AI toast' })).not.toBeInTheDocument();
    });
    expect(aiButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('bridges AI panel toasts into the app-root toast region', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: /Stub README/ }, { timeout: 4000 });

    await userEvent.click(screen.getByRole('button', { name: 'AI assistant' }));
    await userEvent.click(screen.getByRole('button', { name: 'Emit AI toast' }));

    // The shared aiToastQueue is rendered by the app ToastProvider — the
    // panel no longer owns a ToastRegion of its own.
    expect(await screen.findByText('Bridged from the panel')).toBeInTheDocument();
  });

  it('creates a document from the sidebar, listing it among persisted docs', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: /Stub README/ }, { timeout: 4000 });

    await userEvent.click(screen.getByRole('button', { name: 'Toggle panel' }));
    await userEvent.click(screen.getByRole('button', { name: 'New document' }));

    // The new document replaces the boot doc in the editor without a confirm
    // (the previous document is already persisted).
    await waitFor(() => {
      expect(screen.getByLabelText('Markdown source')).toHaveValue('');
    });
    expect(screen.getAllByRole('button', { name: 'Untitled' })).not.toHaveLength(0);
    expect(screen.getAllByRole('button', { name: 'README' })).not.toHaveLength(0);
  });

  it('routes Ctrl+Alt+O to the Open dialog through the shortcut layer', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: /Stub README/ }, { timeout: 4000 });

    await userEvent.keyboard('{Control>}{Alt>}o{/Alt}{/Control}');

    expect(screen.getByRole('heading', { name: 'Open a document' })).toBeVisible();
  });

  it('closes the Open dialog with Escape while the sidebar stays open', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: /Stub README/ }, { timeout: 4000 });
    const toggle = screen.getByRole('button', { name: 'Toggle panel' });

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await userEvent.keyboard('{Control>}{Alt>}o{/Alt}{/Control}');
    expect(screen.getByRole('heading', { name: 'Open a document' })).toBeVisible();

    // First Escape: the topmost layer (the dialog) closes…
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Open a document' })).toBeNull();
    });
    // …and the panel BELOW it stays open for the next Escape.
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });
  });

  it('opens the ? cheat sheet, focuses inside it, and restores on Escape', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: /Stub README/ }, { timeout: 4000 });

    // The editor has focus after boot — typing ? must still open the sheet
    // is NOT expected (typing wins in fields): click away to a chrome button
    // first, exactly like a keyboard user tabbing out of the editor.
    await userEvent.click(screen.getByRole('button', { name: 'Toggle light / dark theme' }));
    await userEvent.keyboard('?');

    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(dialog).getByText('Ctrl+Alt+O')).toBeInTheDocument();
    // RAC autofocus: the dialog container takes focus and the focus scope
    // keeps focus inside.
    expect(dialog).toHaveFocus();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull();
    });
    // RAC focus restore: the control focused before the dialog has it again.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Toggle light / dark theme' })).toHaveFocus();
    });
  });
});
