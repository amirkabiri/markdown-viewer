import styles from './App.module.css';

/**
 * Top-level application shell.
 *
 * The real workspace (split-pane editor, AI co-author panel) replaces the
 * placeholder main region in later porting steps; this component stays the
 * stable root that <App /> tests and the e2e boot spec anchor on.
 */
export default function App() {
  return (
    <>
      <header className={styles.topBar}>
        <a
          className={styles.brand}
          href="?file=README.md"
          aria-label="Qalam home"
        >
          <svg
            className={styles.brandMark}
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 2.5C8.5 6 5.5 10.5 5.5 14.5c0 4.1 2.9 7 6.5 7s6.5-2.9 6.5-7c0-4-3-8.5-6.5-12Z" />
            <path d="M12 5.5v9" />
            <circle cx="12" cy="16" r="1.4" fill="currentColor" stroke="none" />
          </svg>
          <span>Qalam</span>
        </a>
      </header>

      <main className={styles.main}>
        <p className={styles.placeholder}>
          The bilingual Markdown workspace is being ported to React.
        </p>
      </main>

      <footer className={styles.footer}>
        <span>Qalam — free &amp; open source</span>
        {' · '}
        <a
          className={styles.footerLink}
          href="https://github.com/amirkabiri/qalam"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
      </footer>
    </>
  );
}
