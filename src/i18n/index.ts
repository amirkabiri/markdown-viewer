// Module: i18n — EN/FA dictionaries and the pure translator. Owner of t() and
// the Lang re-export. The React provider/`setLang` flow is a later agent's
// job: this module keeps NO module-global language state — callers pass the
// language explicitly, so switching languages is just a re-render.

import type { Lang } from '../lib/store';
import { dictionaries } from './dictionaries';
import type { Dictionary } from './dictionaries';

export type { Dictionary, Lang };

export { dictionaries };

/**
 * Pure translation lookup with the legacy fallback chain: the requested
 * language first, then English, then the key itself. (`||`, not `??` — an
 * empty translation falls through exactly like legacy t().)
 */
export function t(lang: Lang, key: string): string {
  return dictionaries[lang][key] || dictionaries.en[key] || key;
}
