// Module: app/shortcuts — the SINGLE SOURCE OF TRUTH for Qalam's global
// keyboard shortcuts: the combo table, the exact-modifier event matcher
// (⌘ on macOS, Ctrl elsewhere — browser-reserved plain Ctrl+P/T/S/W/N are
// deliberately avoided), the display formatters (cheat-sheet glyphs and the
// README <kbd> markup) and the two DOM probes the dispatcher needs (is the
// event inside a text field; is a React Aria floating layer open). Pure and
// DOM-free at import time. The cheat-sheet dialog, the global hook and the
// README all render from SHORTCUTS, so documentation and behavior cannot
// drift — the README table is test-enforced (shortcuts.test.ts).

/** Which platform's modifier naming and symbols to use. */
export type Platform = 'mac' | 'pc';

/** A key combination. `mod` is ⌘ on macOS and Ctrl everywhere else. */
export interface ShortcutCombo {
  mod: boolean;
  alt: boolean;
  shift: boolean;
  /** KeyboardEvent.key, matched case-insensitively ('o', '1', 'Escape', '?', '\\'). */
  key: string;
}

export type ShortcutId =
  | 'openDialog'
  | 'newDocument'
  | 'copyShareLink'
  | 'toggleSidebar'
  | 'toggleAiPanel'
  | 'paneEditor'
  | 'paneSplit'
  | 'panePreview'
  | 'cycleDir'
  | 'cheatSheet'
  | 'closeLayer';

export type ShortcutGroup = 'documents' | 'view' | 'general';

export interface ShortcutDef {
  id: ShortcutId;
  combo: ShortcutCombo;
  /** Dictionary key for the action label (cheat sheet + README). */
  labelKey: string;
  group: ShortcutGroup;
  /**
   * Modifier combos stay live while typing — they cannot produce text
   * (preventDefault even stops macOS Option-digits typing ¡™£ into the
   * editor). Bare-key shortcuts that are not allowInFields ('?') yield to
   * typing: inside a text field the character wins, never the shortcut.
   */
  allowInFields: boolean;
}

/** Cheat-sheet order: Documents, View, General (GROUPS below). The
 *  dispatcher matches by combo, so array order is presentation only. */
export const SHORTCUTS: readonly ShortcutDef[] = [
  {
    id: 'openDialog',
    combo: {
      mod: true, alt: false, shift: false, key: 'o',
    },
    labelKey: 'openTitle',
    group: 'documents',
    allowInFields: true,
  },
  {
    id: 'newDocument',
    combo: {
      mod: true, alt: true, shift: false, key: 'n',
    },
    labelKey: 'newDoc',
    group: 'documents',
    allowInFields: true,
  },
  {
    id: 'copyShareLink',
    combo: {
      mod: true, alt: false, shift: true, key: 'c',
    },
    labelKey: 'copyLink',
    group: 'documents',
    allowInFields: true,
  },
  {
    id: 'toggleSidebar',
    combo: {
      mod: true, alt: false, shift: false, key: '\\',
    },
    labelKey: 'togglePanel',
    group: 'view',
    allowInFields: true,
  },
  {
    id: 'toggleAiPanel',
    combo: {
      mod: true, alt: false, shift: false, key: 'i',
    },
    labelKey: 'toggleAiPanel',
    group: 'view',
    allowInFields: true,
  },
  {
    id: 'paneEditor',
    combo: {
      mod: false, alt: true, shift: false, key: '1',
    },
    labelKey: 'paneEditor',
    group: 'view',
    allowInFields: true,
  },
  {
    id: 'paneSplit',
    combo: {
      mod: false, alt: true, shift: false, key: '2',
    },
    labelKey: 'paneSplit',
    group: 'view',
    allowInFields: true,
  },
  {
    id: 'panePreview',
    combo: {
      mod: false, alt: true, shift: false, key: '3',
    },
    labelKey: 'panePreview',
    group: 'view',
    allowInFields: true,
  },
  {
    id: 'cycleDir',
    combo: {
      mod: true, alt: true, shift: false, key: 'd',
    },
    labelKey: 'toggleDir',
    group: 'view',
    allowInFields: true,
  },
  {
    id: 'cheatSheet',
    combo: {
      mod: false, alt: false, shift: true, key: '?',
    },
    labelKey: 'shortcuts',
    group: 'general',
    allowInFields: false,
  },
  {
    id: 'closeLayer',
    combo: {
      mod: false, alt: false, shift: false, key: 'escape',
    },
    labelKey: 'shortcutsCloseLayer',
    group: 'general',
    allowInFields: true,
  },
];

/** Cheat-sheet sections, in render order. 'documents' reuses the sidebar's
 *  existing "Documents" dictionary key. */
export const GROUPS: readonly { id: ShortcutGroup; labelKey: string }[] = [
  { id: 'documents', labelKey: 'documents' },
  { id: 'view', labelKey: 'shortcutsGroupView' },
  { id: 'general', labelKey: 'shortcutsGroupGeneral' },
];

/** macOS detection for the platform-appropriate modifier symbol. */
export function platformFor(navigatorPlatform: string): Platform {
  return /mac|iphone|ipad|ipod/i.test(navigatorPlatform) ? 'mac' : 'pc';
}

/** The subset of KeyboardEvent the matcher reads (keeps tests honest). */
export interface ComboKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * Exact-modifier match: a ⌘-combo requires meta and ignores Ctrl on macOS
 * (and vice versa elsewhere), unmodified combos reject extra modifiers —
 * Ctrl+Shift+C must not fire the Ctrl-only map. The cheat-sheet key matches
 * on the produced character alone: '?' IS the character the user typed,
 * whatever physical shift state their layout needs to produce it.
 */
export function matchesCombo(
  event: ComboKeyEvent,
  combo: ShortcutCombo,
  platform: Platform,
): boolean {
  if (event.key.toLowerCase() !== combo.key.toLowerCase()) return false;
  if (combo.key !== '?' && event.shiftKey !== combo.shift) return false;
  const wantCtrl = combo.mod && platform === 'pc';
  const wantMeta = combo.mod && platform === 'mac';
  return event.ctrlKey === wantCtrl
    && event.metaKey === wantMeta
    && event.altKey === combo.alt;
}

const MAC_SYMBOLS: Record<'mod' | 'alt' | 'shift', string> = {
  mod: '⌘',
  alt: '⌥',
  shift: '⇧',
};

const PC_NAMES: Record<'mod' | 'alt' | 'shift', string> = {
  mod: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
};

/** Human-readable key label (cheat sheet and README agree on this). */
function keyLabel(key: string): string {
  if (key === 'escape') return 'Esc';
  return key.length === 1 ? key.toUpperCase() : key;
}

/** Cheat-sheet rendering: glyph stack on macOS ("⌘⇧C"), plus-joined names
 *  elsewhere ("Ctrl+Shift+C"). The '?' entry shows the character only — its
 *  shift state is layout-dependent noise. */
export function formatCombo(combo: ShortcutCombo, platform: Platform): string {
  const parts: string[] = [];
  if (combo.mod) parts.push(platform === 'mac' ? MAC_SYMBOLS.mod : PC_NAMES.mod);
  if (combo.alt) parts.push(platform === 'mac' ? MAC_SYMBOLS.alt : PC_NAMES.alt);
  if (combo.shift && combo.key !== '?') {
    parts.push(platform === 'mac' ? MAC_SYMBOLS.shift : PC_NAMES.shift);
  }
  parts.push(keyLabel(combo.key));
  return platform === 'mac' ? parts.join('') : parts.join('+');
}

/**
 * README rendering (<kbd> markup). The backslash key uses the &#92; entity:
 * a literal '\' in markdown source would escape the following '<' and break
 * the surrounding tags (CommonMark backslash escapes).
 */
export function formatMarkdownKbd(combo: ShortcutCombo): string {
  const parts: string[] = [];
  if (combo.mod) parts.push('<kbd>Ctrl</kbd>/<kbd>⌘</kbd>');
  if (combo.alt) parts.push('<kbd>Alt</kbd>');
  if (combo.shift && combo.key !== '?') parts.push('<kbd>Shift</kbd>');
  const label = combo.key === '\\' ? '&#92;' : keyLabel(combo.key);
  parts.push(`<kbd>${label}</kbd>`);
  return parts.join('+');
}

/** Elements React Aria renders while a floating layer (dialog, alertdialog,
 *  menu, listbox) is open — the layers that own Escape themselves. */
const LAYER_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/**
 * True when the event target is a text-entry surface. Duck-typed (no
 * instanceof) so node-project unit tests can pass plain objects.
 */
export function isEditableTarget(target: EventTarget | null | undefined): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null | undefined;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable === true) return true;
  const tag = el.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** True while any React Aria floating layer is open (RAC owns Escape then). */
export function isOverlayLayerOpen(root: ParentNode = document): boolean {
  return root.querySelector(LAYER_SELECTOR) !== null;
}

/**
 * True when a floating layer is open OUTSIDE `scope` — a layer ABOVE the
 * scope's own surface. The AI panel yields Escape to the consent/Open
 * dialogs this way (they are separate portals, not ancestors of the panel).
 */
export function isForeignLayerOpen(scope: Element, root: ParentNode = document): boolean {
  return Array.from(root.querySelectorAll<HTMLElement>(LAYER_SELECTOR))
    .some((el) => !scope.contains(el));
}
