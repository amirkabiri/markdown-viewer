// Module: app/theme — the light/dark theme provider. Owns the mv:theme
// persistence and the legacy applyTheme DOM contract (public/boot.js sets
// data-theme before first paint; this provider re-applies it after mount and
// on every toggle): the data-theme attribute, the theme-color meta, and the
// highlight.js theme swapped through a dedicated <style> tag (both themes
// bundled as strings so the production build can address the dark one).
import {
  createContext, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';

import {
  defaultTheme, enumOr, store, type Theme,
} from '../lib/store';

import hljsLightCss from '../../style/hljs/github.css?raw';
import hljsDarkCss from '../../style/hljs/github-dark.css?raw';

const HLJS_STYLES: Record<Theme, string> = {
  light: hljsLightCss,
  dark: hljsDarkCss,
};

const THEMES: readonly Theme[] = ['light', 'dark'];

/** The OS color-scheme preference, guarded for non-browser environments. */
function prefersDark(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#0d1117' : '#0969da';
  let styleEl = document.getElementById('hljs-theme-inline') as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'hljs-theme-inline';
    document.head.appendChild(styleEl); // after any bundled CSS so it wins
  }
  styleEl.textContent = HLJS_STYLES[theme] ?? HLJS_STYLES.light;
}

export interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => enumOr(
    store.get<Theme | null>('theme', null),
    THEMES,
    defaultTheme(prefersDark()),
  ));

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    toggleTheme: () => {
      setTheme((prev) => {
        const next = prev === 'dark' ? 'light' : 'dark';
        store.set('theme', next);
        return next;
      });
    },
  }), [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The current theme and its toggle. Throws outside a provider. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
