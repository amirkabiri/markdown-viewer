// Unit tests for the global shortcut table (app/shortcuts): the
// exact-modifier matcher on both platforms, the display formatters, the
// table's own integrity rules, and the single-source-of-truth contract —
// README.md's keyboard-shortcut tables (EN + فارسی) must contain the
// <kbd> markup rendered from SHORTCUTS, so docs cannot drift from behavior.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  GROUPS,
  SHORTCUTS,
  formatCombo,
  formatMarkdownKbd,
  isEditableTarget,
  matchesCombo,
  platformFor,
  type ComboKeyEvent,
  type ShortcutDef,
} from './shortcuts';

function key(partial: Partial<ComboKeyEvent>): ComboKeyEvent {
  return {
    key: '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...partial,
  };
}

function byId(id: ShortcutDef['id']): ShortcutDef {
  const def = SHORTCUTS.find((candidate) => candidate.id === id);
  if (!def) throw new Error(`missing shortcut: ${id}`);
  return def;
}

describe('platformFor', () => {
  it('detects Apple platforms and treats everything else as PC', () => {
    expect(platformFor('MacIntel')).toBe('mac');
    expect(platformFor('iPhone')).toBe('mac');
    expect(platformFor('Win32')).toBe('pc');
    expect(platformFor('Linux x86_64')).toBe('pc');
    expect(platformFor('')).toBe('pc');
  });
});

describe('matchesCombo', () => {
  const open = byId('openDialog').combo;

  it('matches Ctrl+O on PC and ⌘O on macOS, case-insensitively', () => {
    expect(matchesCombo(key({ key: 'o', ctrlKey: true }), open, 'pc')).toBe(true);
    expect(matchesCombo(key({ key: 'O', ctrlKey: true }), open, 'pc')).toBe(true);
    expect(matchesCombo(key({ key: 'o', metaKey: true }), open, 'mac')).toBe(true);
  });

  it('keeps the platform modifiers exclusive (Ctrl+O on macOS is not ⌘O)', () => {
    expect(matchesCombo(key({ key: 'o', ctrlKey: true }), open, 'mac')).toBe(false);
    expect(matchesCombo(key({ key: 'o', metaKey: true }), open, 'pc')).toBe(false);
  });

  it('rejects extra modifiers (Ctrl+Shift+O is not Ctrl+O)', () => {
    expect(matchesCombo(key({ key: 'o', ctrlKey: true, shiftKey: true }), open, 'pc')).toBe(false);
    expect(matchesCombo(key({ key: 'o', ctrlKey: true, altKey: true }), open, 'pc')).toBe(false);
  });

  it('requires the exact shift state of the definition', () => {
    const share = byId('copyShareLink').combo;
    expect(matchesCombo(key({ key: 'c', ctrlKey: true, shiftKey: true }), share, 'pc')).toBe(true);
    expect(matchesCombo(key({ key: 'c', ctrlKey: true }), share, 'pc')).toBe(false);
  });

  it('matches the cheat-sheet key on the produced character alone', () => {
    const sheet = byId('cheatSheet').combo;
    expect(matchesCombo(key({ key: '?', shiftKey: true }), sheet, 'pc')).toBe(true);
    // A layout that produces '?' without Shift still opens the cheat sheet.
    expect(matchesCombo(key({ key: '?' }), sheet, 'pc')).toBe(true);
    expect(matchesCombo(key({ key: '/' }), sheet, 'pc')).toBe(false);
  });

  it('matches Escape regardless of source casing', () => {
    expect(matchesCombo(key({ key: 'Escape' }), byId('closeLayer').combo, 'pc')).toBe(true);
  });
});

describe('SHORTCUTS table integrity', () => {
  it('has unique ids and non-empty labels/keys', () => {
    const ids = SHORTCUTS.map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
    SHORTCUTS.forEach((def) => {
      expect(def.labelKey.length).toBeGreaterThan(0);
      expect(def.combo.key.length).toBeGreaterThan(0);
    });
  });

  it('has at least one shortcut in every cheat-sheet group', () => {
    GROUPS.forEach((group) => {
      expect(SHORTCUTS.some((def) => def.group === group.id)).toBe(true);
    });
  });

  it('suppresses bare-key shortcuts in text fields — except Escape', () => {
    SHORTCUTS.forEach((def) => {
      const bareKey = !def.combo.mod && !def.combo.alt;
      if (!bareKey) expect(def.allowInFields).toBe(true);
      else expect(def.allowInFields).toBe(def.id === 'closeLayer');
    });
  });
});

describe('isEditableTarget', () => {
  /** The production signature takes EventTarget; tests pass duck-typed fakes. */
  function probe(target: object | null | undefined): boolean {
    return isEditableTarget(target as EventTarget | null | undefined);
  }

  it('recognizes text-entry surfaces (duck-typed, no DOM needed)', () => {
    expect(probe({ tagName: 'INPUT' })).toBe(true);
    expect(probe({ tagName: 'TEXTAREA' })).toBe(true);
    expect(probe({ tagName: 'SELECT' })).toBe(true);
    expect(probe({ tagName: 'div', isContentEditable: true })).toBe(true);
    expect(probe({ tagName: 'BUTTON' })).toBe(false);
    expect(probe({ tagName: 'body' })).toBe(false);
    expect(probe(null)).toBe(false);
    expect(probe(undefined)).toBe(false);
  });
});

describe('formatCombo', () => {
  it('renders glyph stacks on macOS and plus-joined names elsewhere', () => {
    expect(formatCombo(byId('openDialog').combo, 'mac')).toBe('⌘O');
    expect(formatCombo(byId('openDialog').combo, 'pc')).toBe('Ctrl+O');
    expect(formatCombo(byId('paneSplit').combo, 'mac')).toBe('⌥2');
    expect(formatCombo(byId('paneSplit').combo, 'pc')).toBe('Alt+2');
    expect(formatCombo(byId('copyShareLink').combo, 'mac')).toBe('⌘⇧C');
    expect(formatCombo(byId('copyShareLink').combo, 'pc')).toBe('Ctrl+Shift+C');
    expect(formatCombo(byId('newDocument').combo, 'pc')).toBe('Ctrl+Alt+N');
  });

  it('shows Esc and ? without layout-dependent modifier noise', () => {
    expect(formatCombo(byId('cheatSheet').combo, 'mac')).toBe('?');
    expect(formatCombo(byId('cheatSheet').combo, 'pc')).toBe('?');
    expect(formatCombo(byId('closeLayer').combo, 'mac')).toBe('Esc');
    expect(formatCombo(byId('closeLayer').combo, 'pc')).toBe('Esc');
  });
});

describe('README sync (single source of truth)', () => {
  const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');

  it('documents every shortcut in BOTH the English and the Persian tables', () => {
    SHORTCUTS.forEach((def) => {
      const markup = formatMarkdownKbd(def.combo);
      const occurrences = readme.split(markup).length - 1;
      expect(occurrences, `${def.id} (${markup}) should appear in README twice`).toBeGreaterThanOrEqual(2);
    });
  });

  it('renders the platform-neutral Ctrl/⌘ notation as kbd markup', () => {
    expect(formatMarkdownKbd(byId('openDialog').combo)).toBe('<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>O</kbd>');
    expect(formatMarkdownKbd(byId('paneEditor').combo)).toBe('<kbd>Alt</kbd>+<kbd>1</kbd>');
    // Backslash uses the HTML entity: a raw '\' would escape the '<' of the
    // following tag in markdown source.
    expect(formatMarkdownKbd(byId('toggleSidebar').combo)).toBe('<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>&#92;</kbd>');
  });
});
