// Module: features/ai/useBuiltinAi — the builtin (on-device) availability
// state machine as a React hook. States: checking / available / downloadable /
// downloading / unavailable, exactly like legacy/src/ai/index.ts. The single
// BuiltinProvider instance owns the LanguageModel session for the panel's
// lifetime; destroy() on unmount replaces legacy's pagehide cleanup. A
// 'downloadable' result NEVER starts a download — the panel's explicit consent
// flow (AlertDialog Download press or the settings download button, both real
// user activations) is the only path into startDownload().

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { BuiltinProvider } from '../../lib/ai/providers/builtin';

export type BuiltinAvailability =
  | 'checking'
  | 'available'
  | 'downloadable'
  | 'downloading'
  | 'unavailable';

export interface BuiltinAi {
  availability: BuiltinAvailability;
  /** Last downloadprogress value in % — -1 means indeterminate. */
  downloadPercent: number;
  provider: BuiltinProvider;
  /** Re-checks availability; resolves with the state it landed on. */
  refresh: () => Promise<BuiltinAvailability>;
  /**
   * The consent-gated download: create() with a progress monitor. Resolves
   * true when the model became available, false on failure (availability is
   * re-checked so the status area reflects reality).
   */
  startDownload: () => Promise<boolean>;
}

export function useBuiltinAi(): BuiltinAi {
  // One BuiltinProvider for the hook's lifetime (useState initializer, not a
  // lazily-touched ref — refs must not be read during render).
  const [provider] = useState(() => new BuiltinProvider());

  const [availability, setAvailability] = useState<BuiltinAvailability>('checking');
  const [downloadPercent, setDownloadPercent] = useState(-1);
  const mountedRef = useRef(true);

  /** Queries the platform once and records the verdict (no visual reset). */
  const check = useCallback(async (): Promise<BuiltinAvailability> => {
    const next = await provider.availability();
    if (mountedRef.current) setAvailability(next);
    return next;
  }, [provider]);

  /** Re-check with the visible 'checking' reset (re-checks from handlers). */
  const refresh = useCallback(async (): Promise<BuiltinAvailability> => {
    setAvailability('checking');
    return check();
  }, [check]);

  const startDownload = useCallback(async (): Promise<boolean> => {
    setDownloadPercent(-1);
    setAvailability('downloading');
    const ok = await provider.startDownload((percent) => {
      if (mountedRef.current) setDownloadPercent(percent);
    });
    if (mountedRef.current) {
      if (ok) setAvailability('available');
      else await refresh();
    }
    return ok;
  }, [provider, refresh]);

  useEffect(() => {
    mountedRef.current = true;
    const onVisibility = (): void => {
      // The model may finish downloading (or be removed by policy) elsewhere
      // — re-check when the tab becomes visible again (legacy parity).
      if (document.visibilityState === 'visible') {
        check().catch((err) => console.warn('[ai] availability re-check failed', err));
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    // First check of the session; the verdict lands after the await, so no
    // state is set synchronously inside the effect.
    check().catch((err) => console.warn('[ai] availability check failed', err));
    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', onVisibility);
      provider.destroy(); // frees the on-device session (legacy pagehide)
    };
  }, [provider, check]);

  return {
    availability,
    downloadPercent,
    provider,
    refresh,
    startDownload,
  };
}
