// Component tests for the `?` cheat-sheet dialog: one localized row per
// SHORTCUTS entry with the platform-formatted combo (PC names in jsdom, ⌘
// glyphs on a stubbed macOS platform), the RAC focus trap (autofocus into
// the dialog, Esc restore via RAC), and the Persian mirroring through the
// same table.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach, describe, expect, it, vi,
} from 'vitest';
import { I18nProvider } from './i18n';
import { t } from '../i18n';

import ShortcutsDialog from './ShortcutsDialog';
import { SHORTCUTS } from './shortcuts';

interface SetupOpts {
  lang?: 'en' | 'fa';
}

/** jsdom reports ''; stub a platform to exercise the macOS display branch. */
function setPlatform(platform: string): void {
  Object.defineProperty(window.navigator, 'platform', {
    value: platform,
    configurable: true,
  });
}

function setup({ lang = 'en' }: SetupOpts = {}) {
  const onOpenChange = vi.fn();
  render(
    <I18nProvider lang={lang}>
      <ShortcutsDialog isOpen onOpenChange={onOpenChange} />
    </I18nProvider>,
  );
  return { onOpenChange };
}

afterEach(() => {
  setPlatform('');
});

describe('<ShortcutsDialog />', () => {
  it('lists every shortcut in the table under its group heading', () => {
    setup();

    expect(screen.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Documents' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'General' })).toBeInTheDocument();

    SHORTCUTS.forEach((def) => {
      // The cheat-sheet row label ("?") doubles as the dialog title — hence
      // getAllByText: at least one localized row per table entry.
      expect(screen.getAllByText(t('en', def.labelKey)).length).toBeGreaterThan(0);
    });
  });

  it('renders the audited PC bindings (no reserved combos shown)', () => {
    setup();

    expect(screen.getByText('Ctrl+Alt+O')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+Alt+Shift+N')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+Alt+U')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+Alt+A')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+Alt+X')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+\\')).toBeInTheDocument();
    expect(screen.getByText('Alt+2')).toBeInTheDocument();
    expect(screen.getByText('?')).toBeInTheDocument();
    expect(screen.getByText('Esc')).toBeInTheDocument();
    // The moved bindings must be GONE, not doubled: no DevTools-inspect,
    // browser Open File, italic or macOS Dock combos on display.
    expect(screen.queryByText('Ctrl+O')).not.toBeInTheDocument();
    expect(screen.queryByText('Ctrl+Shift+C')).not.toBeInTheDocument();
    expect(screen.queryByText('Ctrl+I')).not.toBeInTheDocument();
    expect(screen.queryByText('Ctrl+Alt+D')).not.toBeInTheDocument();
    expect(screen.queryByText('Ctrl+Alt+N')).not.toBeInTheDocument();
    expect(screen.queryByText(/⌘/)).not.toBeInTheDocument();
  });

  it('renders ⌘-glyph stacks for the audited bindings on a mac platform', () => {
    setPlatform('MacIntel');
    setup();

    expect(screen.getByText('⌘⌥O')).toBeInTheDocument();
    expect(screen.getByText('⌘⌥⇧N')).toBeInTheDocument();
    expect(screen.getByText('⌘⌥U')).toBeInTheDocument();
    expect(screen.getByText('⌘⌥A')).toBeInTheDocument();
    expect(screen.getByText('⌘⌥X')).toBeInTheDocument();
    expect(screen.getByText('⌘\\')).toBeInTheDocument();
    expect(screen.queryByText(/Ctrl\+/)).not.toBeInTheDocument();
  });

  it('renders the Persian table for the FA language', () => {
    setup({ lang: 'fa' });

    expect(screen.getByRole('heading', { name: 'میان‌برهای صفحه‌کلید' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'اسناد' })).toBeInTheDocument();
    expect(screen.getByText('سند جدید')).toBeInTheDocument();
    // The key combos stay LTR islands inside the RTL layout.
    expect(screen.getByText('Ctrl+Alt+O')).toBeInTheDocument();
  });

  it('traps focus inside the dialog on open (RAC autofocus)', () => {
    setup();

    // RAC focuses the dialog CONTAINER itself; the focus scope keeps focus
    // inside for the dialog's whole lifetime.
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveFocus();
  });

  it('closes through the close button and reports the change', async () => {
    const { onOpenChange } = setup();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes on Escape through the RAC overlay (isDismissable)', async () => {
    const { onOpenChange } = setup();
    const user = userEvent.setup();

    await user.keyboard('{Escape}');

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
