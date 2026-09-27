// Module: app/i18n — the FROZEN React i18n contract. I18nProvider wraps the
// whole app: it derives the React Aria locale from the app language (so every
// React Aria primitive mirrors RTL automatically — see docs/uikit-research.md)
// and exposes the pure t(lang, key) translator from src/i18n bound to the
// current language. useT() returns that translator. The AI panel receives
// t/lang through this contract — do not rename, move, or change these exports
// without lead sign-off.
import {
  createContext, useContext, useMemo, type ReactNode,
} from 'react';
import { I18nProvider as ReactAriaI18nProvider } from 'react-aria-components';

import { t } from '../i18n';
import { localeForLang, type Lang } from '../lib/store';

interface I18nContextValue {
  lang: Lang;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export interface I18nProviderProps {
  /** The UI language — owns documentElement lang/dir upstream of this provider. */
  lang: Lang;
  children: ReactNode;
}

/** Supplies t()/lang to the app and points React Aria at the matching locale. */
export function I18nProvider({ lang, children }: I18nProviderProps) {
  const value = useMemo<I18nContextValue>(
    () => ({ lang, t: (key: string) => t(lang, key) }),
    [lang],
  );
  return (
    <ReactAriaI18nProvider locale={localeForLang(lang)}>
      <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
    </ReactAriaI18nProvider>
  );
}

/** The translator bound to the current language (legacy fallback chain intact:
 *  requested language → English → the key itself). Identity is stable per
 *  language, so it is safe in dependency arrays. */
export function useT(): (key: string) => string {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useT must be used inside <I18nProvider>');
  return ctx.t;
}
