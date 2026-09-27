// Module: app/preferences — the small persisted shell preferences that don't
// warrant providers of their own: the pane mode (mv:mode) and the content
// direction mode (mv:dir). Both validate stored values through enumOr, like
// legacy/src/state.ts.
import { useCallback, useState } from 'react';

import { enumOr, store } from '../lib/store';
import type { ContentDir, PaneMode } from '../lib/store';

const PANE_MODES: readonly PaneMode[] = ['editor', 'split', 'preview'];
const DIR_MODES: readonly ContentDir[] = ['auto', 'ltr', 'rtl'];

/** The active pane layout, persisted under mv:mode (legacy default: split). */
export function usePaneMode(): { mode: PaneMode; setMode: (mode: PaneMode) => void } {
  const [mode, setModeState] = useState<PaneMode>(() => enumOr(store.get<PaneMode | null>('mode', null), PANE_MODES, 'split'));
  const setMode = useCallback((next: PaneMode) => {
    setModeState(next);
    store.set('mode', next);
  }, []);
  return { mode, setMode };
}

/**
 * The content-direction mode (auto | ltr | rtl), persisted under mv:dir.
 * cycleDir walks auto → ltr → rtl → auto (legacy toggleDir) and returns the
 * new mode for the caller's toast.
 */
/** The next content-direction mode in the legacy toggle cycle. */
function nextDir(mode: ContentDir): ContentDir {
  if (mode === 'auto') return 'ltr';
  if (mode === 'ltr') return 'rtl';
  return 'auto';
}

export function useContentDir(): { dirMode: ContentDir; cycleDir: () => ContentDir } {
  const [dirMode, setDirMode] = useState<ContentDir>(() => enumOr(
    store.get<ContentDir | null>('dir', null),
    DIR_MODES,
    'auto',
  ));
  const cycleDir = useCallback((): ContentDir => {
    const next = nextDir(dirMode);
    store.set('dir', next);
    setDirMode(next);
    return next;
  }, [dirMode]);
  return { dirMode, cycleDir };
}
