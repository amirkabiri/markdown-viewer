// Component tests for the composed shell: layout landmarks, the boot
// document, editor→preview flow, theme/lang persistence and pane modes.
// The network boundary is a stubbed global fetch returning real Responses
// (house style); storage is the real jsdom localStorage, reset per test.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

import App from './App';

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
    await screen.findByRole('heading', { name: /Stub README/ });

    const editor = screen.getByLabelText('Markdown source');
    await userEvent.clear(editor);
    await userEvent.type(editor, '# E2E Hello');

    expect(await screen.findByRole('heading', { name: /E2E Hello/ })).toBeVisible();
  });

  it('toggles the theme, flipping data-theme and persisting mv:theme', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: /Stub README/ });

    await userEvent.click(screen.getByRole('button', { name: 'Toggle light / dark theme' }));

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(JSON.parse(localStorage.getItem('mv:theme') as string)).toBe('dark');

    await userEvent.click(screen.getByRole('button', { name: 'Toggle light / dark theme' }));

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(JSON.parse(localStorage.getItem('mv:theme') as string)).toBe('light');
  });

  it('toggles the language, flipping html lang/dir and persisting mv:lang', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: /Stub README/ });

    // The button announces the language it switches TO (legacy toggleLang).
    await userEvent.click(screen.getByRole('button', { name: 'تغییر زبان به فارسی' }));

    expect(document.documentElement.lang).toBe('fa');
    expect(document.documentElement.dir).toBe('rtl');
    expect(JSON.parse(localStorage.getItem('mv:lang') as string)).toBe('fa');
    expect(screen.getByRole('banner')).toHaveTextContent('قلم');
  });

  it('persists the pane mode when switching to preview-only', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: /Stub README/ });

    await userEvent.click(screen.getByRole('button', { name: 'Preview only' }));

    expect(JSON.parse(localStorage.getItem('mv:mode') as string)).toBe('preview');
  });

  it('copies a share link and toasts "copied"', async () => {
    const clipboard = stubClipboard();
    render(<App />);
    await screen.findByRole('heading', { name: /Stub README/ });

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
    await screen.findByRole('heading', { name: /Stub README/ });

    await userEvent.click(screen.getByRole('button', { name: /Open/ }));
    expect(screen.getByRole('heading', { name: 'Open a document' })).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Open a document' })).toBeNull();
    });
  });
});
