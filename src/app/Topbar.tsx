// The top bar (legacy header.topbar): panel toggle, brand, pane-mode
// segmented control, Open, share, direction, language, theme and the GitHub
// link. All labels/titles come from the i18n contract; icons are the frozen
// legacy SVG paths.
import type { ReactElement } from 'react';
import { useT } from './i18n';

import type { Lang, PaneMode, Theme } from '../lib/store';

import styles from './Topbar.module.css';

export interface TopbarProps {
  panelOpen: boolean;
  onTogglePanel: () => void;
  mode: PaneMode;
  onSetMode: (mode: PaneMode) => void;
  onOpen: () => void;
  onShare: () => void;
  onCycleDir: () => void;
  aiOpen: boolean;
  onToggleAi: () => void;
  lang: Lang;
  onToggleLang: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}

const PANE_MODES: readonly PaneMode[] = ['editor', 'split', 'preview'];

function PanelIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  );
}

function BrandMark() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2.5C8.5 6 5.5 10.5 5.5 14.5c0 4.1 2.9 7 6.5 7s6.5-2.9 6.5-7c0-4-3-8.5-6.5-12Z" />
      <path d="M12 5.5v9" />
      <circle cx="12" cy="16" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

const PANE_ICONS: Record<PaneMode, ReactElement> = {
  editor: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  ),
  split: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16" />
    </svg>
  ),
  preview: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
};

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function DirIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3 4 7l4 4" />
      <path d="M4 7h16" />
      <path d="m16 21 4-4-4-4" />
      <path d="M20 17H4" />
    </svg>
  );
}

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === 'dark') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57L9 21.07c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.08-.74.09-.73.09-.73 1.2.09 1.83 1.24 1.83 1.24 1.07 1.83 2.8 1.3 3.49 1 .1-.78.42-1.31.76-1.61-2.66-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.11-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.81 5.63-5.49 5.92.43.38.82 1.11.82 2.24l-.01 3.32c0 .31.21.69.83.57A12 12 0 0 0 12 .3z" />
    </svg>
  );
}

function OpenIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />
    </svg>
  );
}

const PANE_ARIA: Record<PaneMode, string> = {
  editor: 'Editor only',
  split: 'Split view',
  preview: 'Preview only',
};

export default function Topbar({
  panelOpen, onTogglePanel, mode, onSetMode, onOpen, onShare,
  onCycleDir, aiOpen, onToggleAi, lang, onToggleLang, theme, onToggleTheme,
}: TopbarProps) {
  const t = useT();

  return (
    <header className={styles.topbar}>
      <button
        type="button"
        className={styles.iconBtn}
        aria-label={t('togglePanel')}
        title={t('togglePanel')}
        aria-expanded={panelOpen}
        onClick={onTogglePanel}
      >
        <PanelIcon />
      </button>

      <a className={styles.brand} href="?file=README.md" aria-label="Qalam home">
        <BrandMark />
        <span>{t('appTitle')}</span>
      </a>

      <span className={styles.spacer} />

      <div className={styles.segmented} role="group" aria-label="Pane layout">
        {PANE_MODES.map((m) => (
          <button
            key={m}
            type="button"
            data-mode={m}
            className={`${styles.segment}${m === mode ? ` ${styles.segmentActive}` : ''}`}
            aria-label={PANE_ARIA[m]}
            title={t(`pane${m[0].toUpperCase()}${m.slice(1)}`)}
            onClick={() => onSetMode(m)}
          >
            {PANE_ICONS[m]}
          </button>
        ))}
      </div>

      <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onOpen}>
        <OpenIcon />
        <span>{t('open')}</span>
      </button>

      <button
        type="button"
        className={styles.iconBtn}
        aria-label={t('aiButton')}
        title={t('aiButton')}
        aria-expanded={aiOpen}
        onClick={onToggleAi}
      >
        <SparkleIcon />
      </button>

      <button
        type="button"
        className={styles.iconBtn}
        aria-label={t('copyLink')}
        title={t('copyLink')}
        onClick={onShare}
      >
        <ShareIcon />
      </button>

      <button
        type="button"
        className={styles.iconBtn}
        aria-label={t('toggleDir')}
        title={t('toggleDir')}
        onClick={onCycleDir}
      >
        <DirIcon />
      </button>

      <button
        type="button"
        className={`${styles.btn} ${styles.ghost} ${styles.langBtn}`}
        aria-label={t('toggleLang')}
        title={t('toggleLang')}
        onClick={onToggleLang}
      >
        {lang === 'fa' ? 'EN' : 'فا'}
      </button>

      <button
        type="button"
        className={styles.iconBtn}
        aria-label={t('toggleTheme')}
        title={t('toggleTheme')}
        onClick={onToggleTheme}
      >
        <ThemeIcon theme={theme} />
      </button>

      <a
        className={styles.iconBtn}
        href="https://github.com/amirkabiri/qalam"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="GitHub repository"
      >
        <GitHubIcon />
      </a>
    </header>
  );
}
