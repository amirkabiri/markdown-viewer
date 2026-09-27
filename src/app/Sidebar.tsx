// The slide-over sidebar panel (legacy aside#panel + #scrim): table of
// contents with scroll-spy highlighting, the document links, recent
// documents, and the footer. Clicking a TOC link closes the panel and
// smooth-scrolls to the heading, like legacy buildToc.
import { useT } from './i18n';
import type { RecentItem } from '../lib/documents';
import type { MarkdownTocEntry } from '../lib/markdown';

import styles from './Sidebar.module.css';

export interface SidebarProps {
  open: boolean;
  onClose: () => void;
  toc: MarkdownTocEntry[];
  activeHeadingId: string | null;
  recent: RecentItem[];
  onOpenFileParam: (fileParam: string) => void;
  onOpenRecent: (item: RecentItem) => void;
  onNewDocument: () => void;
}

/** The in-panel document links (same hrefs as legacy). */
const DOC_LINKS: readonly { file: string; labelKey: string }[] = [
  { file: 'README.md', labelKey: 'docReadme' },
  { file: 'samples/sample-en.md', labelKey: 'docSampleEn' },
  { file: 'samples/sample-fa.md', labelKey: 'docSampleFa' },
];

export default function Sidebar({
  open, onClose, toc, activeHeadingId, recent,
  onOpenFileParam, onOpenRecent, onNewDocument,
}: SidebarProps) {
  const t = useT();
  const minLevel = toc.length ? Math.min(...toc.map((e) => e.level)) : 2;

  const scrollToHeading = (id: string) => {
    onClose();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <>
      <aside id="panel" className={`${styles.panel}${open ? ` ${styles.open}` : ''}`} aria-label="Sidebar panel">
        {toc.length > 0 && (
          <section className={styles.sideSection}>
            <h2 className={styles.sectionTitle}>{t('contents')}</h2>
            <nav className={styles.toc} aria-label={t('contents')}>
              {toc.map((entry) => {
                const depth = Math.min(3, entry.level - minLevel + 1);
                return (
                  <a
                    key={entry.id}
                    href={`#${entry.id}`}
                    className={[
                      styles.tocLink,
                      styles[`tocL${depth}`],
                      entry.id === activeHeadingId ? styles.tocActive : '',
                    ].join(' ').trim()}
                    onClick={(ev) => {
                      ev.preventDefault();
                      scrollToHeading(entry.id);
                    }}
                  >
                    {entry.text}
                  </a>
                );
              })}
            </nav>
          </section>
        )}

        <section className={styles.sideSection}>
          <h2 className={styles.sectionTitle}>{t('documents')}</h2>
          {DOC_LINKS.map((doc) => (
            <a
              key={doc.file}
              className={styles.sideLink}
              href={`?file=${doc.file}`}
              onClick={(ev) => {
                ev.preventDefault();
                onClose();
                onOpenFileParam(doc.file);
              }}
            >
              <span>{t(doc.labelKey)}</span>
            </a>
          ))}
          <button type="button" className={styles.sideLink} onClick={onNewDocument}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span>{t('newDoc')}</span>
          </button>
        </section>

        {recent.length > 0 && (
          <section className={styles.sideSection}>
            <h2 className={styles.sectionTitle}>{t('recent')}</h2>
            {recent.map((item) => (
              <a
                key={item.url}
                className={styles.sideLink}
                href={item.url}
                onClick={(ev) => {
                  ev.preventDefault();
                  onClose();
                  onOpenRecent(item);
                }}
              >
                <span>{item.name}</span>
              </a>
            ))}
          </section>
        )}

        <div className={styles.sideFooter}>
          <span>{t('footer')}</span>
          {' · '}
          <a href="https://github.com/amirkabiri/qalam" target="_blank" rel="noopener noreferrer">GitHub</a>
        </div>
      </aside>

      {open && <div className={styles.scrim} onClick={onClose} aria-hidden="true" />}
    </>
  );
}
