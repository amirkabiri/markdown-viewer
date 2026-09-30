// Unit tests for the global shortcut table (app/shortcuts): the
// exact-modifier matcher on both platforms, the display formatters, the
// table's own integrity rules, the reserved-combo invariant (no SHORTCUTS
// entry may collide with an OS- or browser-reserved combo — see
// docs/SHORTCUTS.md), and the single-source-of-truth contract — README.md's
// keyboard-shortcut tables (EN + فارسی) must contain the <kbd> markup
// rendered from SHORTCUTS, so docs cannot drift from behavior.
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
  type Platform,
  type ShortcutCombo,
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

  it('matches Ctrl+Alt+O on PC and ⌘⌥O on macOS, case-insensitively', () => {
    expect(matchesCombo(key({ key: 'o', ctrlKey: true, altKey: true }), open, 'pc')).toBe(true);
    expect(matchesCombo(key({ key: 'O', ctrlKey: true, altKey: true }), open, 'pc')).toBe(true);
    expect(matchesCombo(key({ key: 'o', metaKey: true, altKey: true }), open, 'mac')).toBe(true);
  });

  it('keeps the platform modifiers exclusive (Ctrl+Alt+O on macOS is not ⌘⌥O)', () => {
    expect(matchesCombo(key({ key: 'o', ctrlKey: true, altKey: true }), open, 'mac')).toBe(false);
    expect(matchesCombo(key({ key: 'o', metaKey: true, altKey: true }), open, 'pc')).toBe(false);
  });

  it('rejects wrong and extra modifiers (Ctrl+O and Ctrl+Alt+Shift+O are not ⌘⌥O)', () => {
    expect(matchesCombo(key({ key: 'o', ctrlKey: true }), open, 'pc')).toBe(false);
    expect(matchesCombo(key({
      key: 'o', ctrlKey: true, altKey: true, shiftKey: true,
    }), open, 'pc')).toBe(false);
  });

  it('requires the exact shift state of the definition', () => {
    // Inline combo: after the conflict audit no table entry carries Shift
    // except the character-matched '?' (docs/SHORTCUTS.md §4).
    const hypothetical: ShortcutCombo = {
      mod: true, alt: false, shift: true, key: 'c',
    };
    expect(matchesCombo(key({ key: 'c', ctrlKey: true, shiftKey: true }), hypothetical, 'pc')).toBe(true);
    expect(matchesCombo(key({ key: 'c', ctrlKey: true }), hypothetical, 'pc')).toBe(false);
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

/**
 * Reserved combos the SHORTCUTS table must never bind (docs/SHORTCUTS.md).
 * OS-level combos (macOS system/Dock/app-menu, Windows system) and browser
 * viewport feature bindings (Chrome/Edge/Firefox/Safari help + DevTools docs),
 * normalized into the app's combo model per platform: `mod` is ⌘ on mac and
 * Ctrl on pc. In-DevTools-only combos (Shift+? = DevTools settings, ⌥⌘A =
 * Web Inspector Sources tab) are deliberately excluded — they never fire on
 * the page viewport (docs/SHORTCUTS.md §2).
 */
const RESERVED_COMBOS: Record<Platform, readonly ShortcutCombo[]> = {
  mac: [
    // Apple, "Mac keyboard shortcuts" (support.apple.com/en-us/102650)
    {
      mod: true, alt: true, shift: false, key: 'd',
    }, // Show/hide Dock
    {
      mod: true, alt: true, shift: false, key: 'escape',
    }, // Force quit
    {
      mod: true, alt: true, shift: false, key: 'h',
    }, // Hide others (app menu)
    {
      mod: true, alt: true, shift: false, key: 'm',
    }, // Minimize all
    {
      mod: true, alt: true, shift: false, key: 'w',
    }, // Close all windows
    {
      mod: true, alt: true, shift: false, key: 'l',
    }, // Downloads (Finder)
    {
      mod: true, alt: true, shift: false, key: 'n',
    }, // Smart Folder (Finder)
    {
      mod: true, alt: true, shift: false, key: 'p',
    }, // Path bar (Finder)
    {
      mod: true, alt: true, shift: false, key: 's',
    }, // Sidebar (Finder)
    {
      mod: true, alt: true, shift: false, key: 't',
    }, // Toolbar / Fonts
    {
      mod: true, alt: true, shift: false, key: 'v',
    }, // Paste style / move
    {
      mod: true, alt: true, shift: false, key: 'y',
    }, // Quick Look slideshow
    {
      mod: true, alt: true, shift: false, key: 'f',
    }, // Spotlight in Finder
    {
      mod: true, alt: true, shift: false, key: ' ',
    }, // Spotlight window
    // Safari Web Inspector + Chromium/Firefox DevTools on macOS (webkit.org,
    // developer.chrome.com, learn.microsoft.com, firefox-source-docs)
    {
      mod: true, alt: true, shift: false, key: 'i',
    }, // Web Inspector / DevTools
    {
      mod: true, alt: true, shift: false, key: 'c',
    }, // Console / element picker
    {
      mod: true, alt: true, shift: false, key: 'j',
    }, // DevTools console
    {
      mod: true, alt: true, shift: false, key: 'r',
    }, // Reload from origin
    // Chrome on Mac (support.google.com/chrome/answer/157179)
    {
      mod: true, alt: true, shift: false, key: 'b',
    }, // Bookmark manager
    {
      mod: true, alt: true, shift: false, key: 'u',
    }, // View source (Chrome Help ⌘⌥U; Safari Develop ⌥⌘U page source)
    {
      mod: true, alt: true, shift: false, key: 'k',
    }, // Firefox mac Web Console (firefox-source-docs ⌘⌥K)
    // Browser viewport features, macOS columns of the four browsers' docs
    {
      mod: true, alt: false, shift: false, key: 'o',
    }, // Open file (all)
    {
      mod: true, alt: false, shift: false, key: 'i',
    }, // Italic / Page info
    {
      mod: true, alt: false, shift: false, key: 'b',
    }, // Bold / bookmarks bar
    {
      mod: true, alt: false, shift: false, key: 'u',
    }, // Page source
    {
      mod: true, alt: false, shift: false, key: 'p',
    }, // Print
    {
      mod: true, alt: false, shift: false, key: 's',
    }, // Save page
    {
      mod: true, alt: false, shift: false, key: 'j',
    }, // Downloads
    {
      mod: true, alt: false, shift: false, key: 'd',
    }, // Bookmark
    {
      mod: true, alt: false, shift: false, key: 'l',
    }, // Address bar
    {
      mod: true, alt: false, shift: false, key: 'r',
    }, // Reload
    {
      mod: true, alt: false, shift: false, key: 'f',
    }, // Find
    {
      mod: true, alt: false, shift: false, key: 'h',
    }, // Hide (app menu)
    {
      mod: true, alt: false, shift: false, key: 'm',
    }, // Minimize
    {
      mod: true, alt: false, shift: false, key: 'w',
    }, // Close tab/window
    {
      mod: true, alt: false, shift: false, key: 't',
    }, // New tab
    {
      mod: true, alt: false, shift: false, key: 'n',
    }, // New window
    ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => ({
      mod: true, alt: false, shift: false, key: digit,
    })), // Jump to tab N
    {
      mod: true, alt: false, shift: false, key: 'q',
    }, // Quit (app menu)
    {
      mod: true, alt: false, shift: true, key: 'c',
    }, // DevTools Elements / Finder
    {
      mod: true, alt: false, shift: true, key: 'd',
    }, // Reading list / bookmark all
    {
      mod: true, alt: false, shift: true, key: 't',
    }, // Reopen closed tab
    {
      mod: true, alt: false, shift: true, key: 'n',
    }, // New incognito window
    {
      mod: true, alt: false, shift: true, key: 'r',
    }, // Hard reload
    {
      mod: true, alt: false, shift: true, key: '\\',
    }, // Safari tab overview
  ],
  pc: [
    // Windows system (support.microsoft.com keyboard-shortcuts-in-windows)
    {
      mod: true, alt: true, shift: true, key: 'delete',
    }, // Ctrl+Alt+Del
    {
      mod: true, alt: false, shift: true, key: 'escape',
    }, // Task Manager
    // Browser viewport features, Windows columns of the four browsers' docs
    // (Chrome Help, Edge Help, Edge DevTools, Firefox SUMO + DevTools docs)
    {
      mod: true, alt: false, shift: false, key: 'o',
    }, // Open file (all)
    {
      mod: true, alt: false, shift: false, key: 'i',
    }, // Italic / Page info
    {
      mod: true, alt: false, shift: false, key: 'b',
    }, // Bold / bookmarks sidebar
    {
      mod: true, alt: false, shift: false, key: 'u',
    }, // Page source
    {
      mod: true, alt: false, shift: false, key: 'p',
    }, // Print
    {
      mod: true, alt: false, shift: false, key: 's',
    }, // Save page
    {
      mod: true, alt: false, shift: false, key: 'j',
    }, // Downloads
    {
      mod: true, alt: false, shift: false, key: 'd',
    }, // Bookmark
    {
      mod: true, alt: false, shift: false, key: 'l',
    }, // Address bar
    {
      mod: true, alt: false, shift: false, key: 'k',
    }, // Search from address bar
    {
      mod: true, alt: false, shift: false, key: 'r',
    }, // Reload
    {
      mod: true, alt: false, shift: false, key: 'f',
    }, // Find
    {
      mod: true, alt: false, shift: false, key: 'h',
    }, // History
    {
      mod: true, alt: false, shift: false, key: 't',
    }, // New tab
    {
      mod: true, alt: false, shift: false, key: 'n',
    }, // New window
    {
      mod: true, alt: false, shift: false, key: 'w',
    }, // Close tab
    ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => ({
      mod: true, alt: false, shift: false, key: digit,
    })), // Jump to tab N
    {
      mod: true, alt: false, shift: true, key: 'c',
    }, // DevTools inspect element
    {
      mod: true, alt: false, shift: true, key: 'i',
    }, // DevTools
    {
      mod: true, alt: false, shift: true, key: 'j',
    }, // DevTools console
    {
      mod: true, alt: false, shift: true, key: 'k',
    }, // Firefox web console
    {
      mod: true, alt: false, shift: true, key: 'd',
    }, // Bookmark all tabs / dock
    {
      mod: true, alt: false, shift: true, key: 'o',
    }, // Bookmark manager
    {
      mod: true, alt: false, shift: true, key: 'b',
    }, // Bookmarks bar
    {
      mod: true, alt: false, shift: true, key: 'm',
    }, // Device emulation
    {
      mod: true, alt: false, shift: true, key: 'p',
    }, // DevTools command menu
    {
      mod: true, alt: false, shift: true, key: 'r',
    }, // Hard reload
    {
      mod: true, alt: false, shift: true, key: 't',
    }, // Reopen closed tab
    {
      mod: true, alt: false, shift: true, key: 'n',
    }, // New private window
    {
      mod: true, alt: false, shift: true, key: 'w',
    }, // Close window
    {
      mod: true, alt: false, shift: true, key: 'y',
    }, // Firefox downloads
    {
      mod: true, alt: false, shift: true, key: 'z',
    }, // Firefox debugger
    {
      alt: true, mod: false, shift: false, key: 'd',
    }, // Chrome/Edge address bar (Alt+D)
    {
      alt: true, mod: false, shift: true, key: 'n',
    }, // Chrome split view (Shift+Alt+N)
  ],
};

function sameCombo(a: ShortcutCombo, b: ShortcutCombo): boolean {
  return a.mod === b.mod && a.alt === b.alt && a.shift === b.shift
    && a.key.toLowerCase() === b.key.toLowerCase();
}

describe('SHORTCUTS table integrity', () => {
  it('has unique ids and non-empty labels/keys', () => {
    const ids = SHORTCUTS.map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
    SHORTCUTS.forEach((def) => {
      expect(def.labelKey.length).toBeGreaterThan(0);
      expect(def.combo.key.length).toBeGreaterThan(0);
    });
  });

  it('has unique combos (one combo, one action — `mod` maps per platform)', () => {
    const normalized = SHORTCUTS.map((def) => JSON.stringify([
      def.combo.mod, def.combo.alt, def.combo.shift, def.combo.key.toLowerCase(),
    ]));
    expect(new Set(normalized).size).toBe(normalized.length);
  });

  it('binds no OS- or browser-reserved combo on either platform', () => {
    (['mac', 'pc'] as const).forEach((platform) => {
      SHORTCUTS.forEach((def) => {
        RESERVED_COMBOS[platform].forEach((reserved) => {
          expect(
            sameCombo(def.combo, reserved),
            `${def.id} (${formatCombo(def.combo, platform)}) collides with a reserved ${platform} combo`,
          ).toBe(false);
        });
      });
    });
  });

  it('never binds bare Mod+B/I/U/P/S to non-formatting actions (editor conventions)', () => {
    SHORTCUTS.forEach((def) => {
      const bareMod = def.combo.mod && !def.combo.alt;
      if (bareMod) {
        const letter = def.combo.key.toLowerCase();
        expect(
          ['b', 'i', 'u', 'p', 's'],
          `${def.id} binds the bare Mod+${letter.toUpperCase()} convention`,
        ).not.toContain(letter);
      }
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
    expect(formatCombo(byId('openDialog').combo, 'mac')).toBe('⌘⌥O');
    expect(formatCombo(byId('openDialog').combo, 'pc')).toBe('Ctrl+Alt+O');
    expect(formatCombo(byId('paneSplit').combo, 'mac')).toBe('⌥2');
    expect(formatCombo(byId('paneSplit').combo, 'pc')).toBe('Alt+2');
    expect(formatCombo(byId('copyShareLink').combo, 'mac')).toBe('⌘⌥⇧K');
    expect(formatCombo(byId('copyShareLink').combo, 'pc')).toBe('Ctrl+Alt+Shift+K');
    expect(formatCombo(byId('toggleAiPanel').combo, 'mac')).toBe('⌘⌥A');
    expect(formatCombo(byId('toggleAiPanel').combo, 'pc')).toBe('Ctrl+Alt+A');
    expect(formatCombo(byId('cycleDir').combo, 'mac')).toBe('⌘⌥X');
    expect(formatCombo(byId('cycleDir').combo, 'pc')).toBe('Ctrl+Alt+X');
    expect(formatCombo(byId('newDocument').combo, 'mac')).toBe('⌘⌥⇧N');
    expect(formatCombo(byId('newDocument').combo, 'pc')).toBe('Ctrl+Alt+Shift+N');
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
    expect(formatMarkdownKbd(byId('openDialog').combo)).toBe('<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Alt</kbd>+<kbd>O</kbd>');
    expect(formatMarkdownKbd(byId('paneEditor').combo)).toBe('<kbd>Alt</kbd>+<kbd>1</kbd>');
    // Backslash uses the HTML entity: a raw '\' would escape the '<' of the
    // following tag in markdown source.
    expect(formatMarkdownKbd(byId('toggleSidebar').combo)).toBe('<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>&#92;</kbd>');
  });
});
