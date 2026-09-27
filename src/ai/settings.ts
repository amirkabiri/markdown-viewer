// Module: ai/settings — validated load/save of the AI provider configuration
// in localStorage under the `mv:ai` key (via the app's shared store). Invalid
// or hostile stored values are ignored/repaired, never thrown. The apiKey is
// client-side only and is never logged anywhere in this module.

import { store } from '../state.js';
import type { ProviderId, ProviderSettings } from './types.js';

const PROVIDERS: readonly ProviderId[] = ['builtin', 'openai', 'anthropic'];

export const DEFAULT_SETTINGS: ProviderSettings = {
  provider: 'builtin',
  baseUrl: '',
  apiKey: '',
  model: '',
};

/**
 * Repairs an arbitrary (JSON.parse'd) value into a valid ProviderSettings:
 * unknown provider ids fall back to 'builtin', non-string fields become ''.
 * baseUrl/model are trimmed; apiKey is preserved verbatim (tokens are exact).
 * Pure.
 */
export function normalizeSettings(raw: unknown): ProviderSettings {
  const src = (raw !== null && typeof raw === 'object' && !Array.isArray(raw))
    ? raw as Record<string, unknown>
    : {};
  const provider = (PROVIDERS as readonly unknown[]).includes(src.provider)
    ? src.provider as ProviderId
    : 'builtin';
  return {
    provider,
    baseUrl: typeof src.baseUrl === 'string' ? src.baseUrl.trim() : '',
    apiKey: typeof src.apiKey === 'string' ? src.apiKey : '',
    model: typeof src.model === 'string' ? src.model.trim() : '',
  };
}

/** Reads `mv:ai` from localStorage, repairing anything invalid to defaults. */
export function loadSettings(): ProviderSettings {
  let raw: unknown = null;
  try {
    raw = store.get<unknown>('ai', null);
  } catch { /* storage blocked — fall through to defaults */ }
  return normalizeSettings(raw);
}

/** Persists the settings (only the four known fields are written). */
export function saveSettings(next: ProviderSettings): void {
  store.set('ai', normalizeSettings(next));
}

/** An external provider is usable once the gateway URL and model are known; the token stays optional (some proxies don't need one). */
export function isExternalReady(s: ProviderSettings): boolean {
  if (s.provider === 'builtin') return false;
  return s.baseUrl.trim() !== '' && s.model.trim() !== '';
}
