// Component tests for the global shortcut dispatcher (app/useShortcuts):
// combo dispatch on the default (PC) platform and on a stubbed macOS
// navigator.platform, typing suppression for the bare '?' key (with
// preventDefault still applied to Alt-digits so macOS layouts never type
// ¡™£ into the editor), and Escape's yield to open React Aria layers.
// Combo presses go through raw KeyboardEvent dispatches (sync, inspectable
// defaultPrevented); userEvent covers the realistic typing paths.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach, describe, expect, it,
} from 'vitest';

import { useGlobalShortcuts, type ShortcutHandlers } from './useShortcuts';

/** Sync keydown dispatch on window — returns the event for assertions. */
function press(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
}

/** jsdom reports ''; stub a platform to exercise the macOS matcher branch. */
function setPlatform(platform: string): void {
  Object.defineProperty(window.navigator, 'platform', {
    value: platform,
    configurable: true,
  });
}

function recordingHandlers(log: string[]): ShortcutHandlers {
  return {
    openDialog: () => log.push('openDialog'),
    newDocument: () => log.push('newDocument'),
    toggleAiPanel: () => log.push('toggleAiPanel'),
    toggleSidebar: () => log.push('toggleSidebar'),
    setPaneMode: (mode) => log.push(`pane:${mode}`),
    copyShareLink: () => log.push('copyShareLink'),
    cycleDirection: () => log.push('cycleDirection'),
    openCheatSheet: () => log.push('cheatSheet'),
    closeTopPanel: () => log.push('closeTopPanel'),
  };
}

interface HarnessProps {
  log: string[];
  /** Renders a foreign React Aria-style layer (role="dialog") when true. */
  layerOpen: boolean;
}

function Harness({ log, layerOpen }: HarnessProps) {
  useGlobalShortcuts(recordingHandlers(log));
  return (
    <div>
      {layerOpen && <div role="dialog" aria-label="A dialog above everything" />}
      <textarea aria-label="Editor" />
      <button type="button">Plain button</button>
    </div>
  );
}

afterEach(() => {
  setPlatform('');
});

describe('useGlobalShortcuts', () => {
  it('dispatches openDialog on Ctrl+O (PC platform default in jsdom)', async () => {
    const log: string[] = [];
    render(<Harness log={log} layerOpen={false} />);

    press({ key: 'o', ctrlKey: true });

    expect(log).toEqual(['openDialog']);
  });

  it('dispatches on ⌘ and ignores Ctrl-only presses on a mac platform', () => {
    setPlatform('MacIntel');
    const log: string[] = [];
    render(<Harness log={log} layerOpen={false} />);

    press({ key: 'o', metaKey: true });
    expect(log).toEqual(['openDialog']);

    press({ key: 'o', ctrlKey: true });
    expect(log).toEqual(['openDialog']); // unchanged — Ctrl is not ⌘ on macOS
  });

  it('lets ? type into a textarea instead of opening the cheat sheet', async () => {
    const log: string[] = [];
    const user = userEvent.setup();
    render(<Harness log={log} layerOpen={false} />);

    const editor = screen.getByLabelText('Editor');
    await user.click(editor);
    await user.keyboard('Why?');

    expect(log).toEqual([]);
    expect(editor).toHaveValue('Why?');
  });

  it('opens the cheat sheet from ? when no text field has focus', async () => {
    const log: string[] = [];
    const user = userEvent.setup();
    render(<Harness log={log} layerOpen={false} />);

    await user.tab(); // textarea
    await user.tab(); // plain button
    await user.keyboard('?');

    expect(log).toEqual(['cheatSheet']);
  });

  it('dispatches Alt+digit pane modes in a textarea and prevents typing ¡™£', () => {
    const log: string[] = [];
    render(<Harness log={log} layerOpen={false} />);
    screen.getByLabelText('Editor').focus();

    const event = press({ key: '2', altKey: true });

    expect(log).toEqual(['pane:split']);
    expect(event.defaultPrevented).toBe(true);
  });

  it('closes the top panel on Escape when no layer is open', () => {
    const log: string[] = [];
    render(<Harness log={log} layerOpen={false} />);

    press({ key: 'Escape' });

    expect(log).toEqual(['closeTopPanel']);
  });

  it('yields Escape to an open dialog layer (topmost closes first)', () => {
    const log: string[] = [];
    render(<Harness log={log} layerOpen />);

    press({ key: 'Escape' });

    expect(log).toEqual([]);
  });

  it('routes the remaining combos to their handlers', () => {
    const log: string[] = [];
    render(<Harness log={log} layerOpen={false} />);

    press({ key: 'n', ctrlKey: true, altKey: true });
    press({ key: 'c', ctrlKey: true, shiftKey: true });
    press({ key: 'd', ctrlKey: true, altKey: true });
    press({ key: 'i', ctrlKey: true });
    press({ key: '\\', ctrlKey: true });

    expect(log).toEqual([
      'newDocument',
      'copyShareLink',
      'cycleDirection',
      'toggleAiPanel',
      'toggleSidebar',
    ]);
  });

  it('leaves unbound keys alone (no preventDefault, no dispatch)', () => {
    const log: string[] = [];
    render(<Harness log={log} layerOpen={false} />);

    const event = press({ key: 'k', ctrlKey: true });

    expect(log).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });
});
