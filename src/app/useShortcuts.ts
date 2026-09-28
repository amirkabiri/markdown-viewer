// Module: app/useShortcuts — binds the SHORTCUTS table (app/shortcuts) to
// shell handlers through ONE window-level capture listener. Capture, like the
// AI panel's Esc handler, so key events from inside RAC portals are always
// seen. Rules of engagement:
//   - modifier combos stay live while typing (preventDefault included, so
//     macOS Option-digits never type ¡™£ into the editor),
//   - the bare '?' never fires inside a text field — typing wins,
//   - Escape yields to React Aria while any of ITS floating layers is open
//     (dialogs and menus close first, topmost first); only then does it
//     close the sidebar panel — the last non-RAC layer (the AI panel owns
//     its own Escape handler with the same foreign-layer rule).
import { useEffect, useRef } from 'react';

import type { PaneMode } from '../lib/store';
import {
  SHORTCUTS,
  isEditableTarget,
  isOverlayLayerOpen,
  matchesCombo,
  platformFor,
  type ShortcutId,
} from './shortcuts';

export interface ShortcutHandlers {
  openDialog(): void;
  newDocument(): void;
  toggleAiPanel(): void;
  toggleSidebar(): void;
  setPaneMode(mode: PaneMode): void;
  copyShareLink(): void;
  cycleDirection(): void;
  openCheatSheet(): void;
  closeTopPanel(): void;
}

/** Shortcut id → handler invocation (the dispatch table). */
const DISPATCH: Record<ShortcutId, (handlers: ShortcutHandlers) => void> = {
  openDialog: (h) => h.openDialog(),
  newDocument: (h) => h.newDocument(),
  toggleAiPanel: (h) => h.toggleAiPanel(),
  toggleSidebar: (h) => h.toggleSidebar(),
  paneEditor: (h) => h.setPaneMode('editor'),
  paneSplit: (h) => h.setPaneMode('split'),
  panePreview: (h) => h.setPaneMode('preview'),
  copyShareLink: (h) => h.copyShareLink(),
  cycleDir: (h) => h.cycleDirection(),
  cheatSheet: (h) => h.openCheatSheet(),
  closeLayer: (h) => h.closeTopPanel(),
};

/** Registers the global keyboard-shortcut layer. Never re-binds: the latest
 *  handlers are read through a ref, so caller-side identity churn is free. */
export function useGlobalShortcuts(handlers: ShortcutHandlers): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const platform = platformFor(window.navigator.platform);
      const def = SHORTCUTS.find((candidate) => matchesCombo(event, candidate.combo, platform));
      if (!def) return;
      // RAC owns Escape while one of its layers is open (topmost first).
      if (def.id === 'closeLayer' && isOverlayLayerOpen()) return;
      // Typing wins over bare-key shortcuts ('?' must type a question mark).
      if (!def.allowInFields && isEditableTarget(event.target)) return;
      event.preventDefault();
      DISPATCH[def.id](latest.current);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
}
