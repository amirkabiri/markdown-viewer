// The slide-over sidebar panel (legacy aside#panel + #scrim): table of
// contents with scroll-spy highlighting, the persisted document list
// (create/select/rename/remove/reorder — the repository IS the recents list
// now), the site document links, and the footer. Clicking a TOC link closes
// the panel and smooth-scrolls to the heading, like legacy buildToc.
import { useT } from './i18n';
import { DocumentList } from '../features/documents';
import type { DocumentRecord } from '../lib/persistence';
import type { MarkdownTocEntry } from '../lib/markdown';

import styles from './Sidebar.module.css';

export interface SidebarProps {
  open: boolean;
  onClose: () => void;
  toc: MarkdownTocEntry[];
  activeHeadingId: string | null;
  /** All persisted documents, live (repository sortIndex order). */
  docs: DocumentRecord[];
  activeDocId: string | null;
  onSelectDoc: (id: string) => void;
  onRemoveDoc: (id: string) => void;
  onRenameDoc: (id: string, name: string) => void;
  onReorderDocs: (orderedIds: string[]) => void;
  onOpenFileParam: (fileParam: string) => void;
  onNewDocument: () => void;
}

/** The in-panel document links (same hrefs as legacy). */
const DOC_LINKS: readonly { file: string; labelKey: string }[] = [
  { file: 'README.md', labelKey: 'docReadme' },
  { file: 'samples/sample-en.md', labelKey: 'docSampleEn' },
  { file: 'samples/sample-fa.md', labelKey: 'docSampleFa' },
];

export default function Sidebar({
  open, onClose, toc, activeHeadingId, docs, activeDocId,
  onSelectDoc, onRemoveDoc, onRenameDoc, onReorderDocs,
  onOpenFileParam, onNewDocument,
}: SidebarProps) {
  const t = useT();
  const minLevel = toc.length ? Math.min(...toc.map((e) => e.level)) : 2;

  const scrollToHeading = (id: string) => {
    onClose();
    // prefers-reduced-motion: the tokens.css media query only covers CSS
    // transitions — this JS-driven scroll honors it explicitly.
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(id)?.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'start',
    });
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
          <DocumentList
            docs={docs}
            activeDocId={activeDocId}
            /* Selecting a persisted document keeps the panel open — the
               switch is instant and the active highlight stays visible (only
               the site doc links navigate and close). Double-click-to-rename
               also depends on the click not tearing the panel down. */
            onSelect={onSelectDoc}
            onRemove={onRemoveDoc}
            onRename={onRenameDoc}
            onReorder={onReorderDocs}
          />
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
