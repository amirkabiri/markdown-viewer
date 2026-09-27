// Top-level application shell: composes the providers (i18n, theme, toast,
// editor api) and the workspace — topbar, split editor/preview, sidebar
// panel, open dialog, share, drag & drop, overlays and the footer. Behavior
// is ported from the vanilla app in legacy/src (main/ui/workspace/documents).
import {
  useCallback, useEffect, useMemo, useState,
} from 'react';

import { I18nProvider, useT } from './app/i18n';
import { ThemeProvider, useTheme } from './app/theme';
import { ToastProvider, useToast } from './components/Toast';
import OpenDialog from './features/documents/OpenDialog';
import { useDocuments } from './features/documents/useDocuments';
import { EditorProvider, useEditorController } from './features/editor';
import { previewDirFor, useMarkdownPreview } from './features/preview';
import { copyShareLink } from './features/share';
import Sidebar from './app/Sidebar';
import Topbar from './app/Topbar';
import Workspace from './app/Workspace';
import { useContentDir, usePaneMode } from './app/preferences';
import { defaultLang, enumOr, store } from './lib/store';
import type { ContentDir, Lang } from './lib/store';

import styles from './App.module.css';

const LANGS: readonly Lang[] = ['fa', 'en'];

const DIR_LABELS: Record<ContentDir, string> = {
  auto: 'Auto / خودکار',
  ltr: 'LTR',
  rtl: 'RTL',
};

/** Fire-and-forget for promises that handle their own errors (every loader
 *  catches internally; a rejection here is impossible by construction). */
function run(promise: Promise<unknown>): void {
  promise.catch(() => {});
}

/** document.title per UI language (legacy applyLang sets it to appTitle). */
function documentTitle(lang: Lang): string {
  return lang === 'fa' ? 'قلم' : 'Qalam';
}

interface ShellProps {
  lang: Lang;
  onToggleLang: () => void;
}

function Shell({ lang, onToggleLang }: ShellProps) {
  const t = useT();
  const { theme, toggleTheme } = useTheme();
  const toast = useToast();

  const editorCtl = useEditorController();
  const documents = useDocuments({
    setEditorDocument: editorCtl.loadDocument,
    toast,
  });

  const { mode, setMode } = usePaneMode();
  const { dirMode, cycleDir } = useContentDir();

  const [panelOpen, setPanelOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);

  const previewState = useMarkdownPreview(editorCtl.text, {
    baseUrl: documents.doc?.baseUrl,
    immediateKey: documents.docIdentity,
  });

  const dirEditor = previewDirFor(dirMode, editorCtl.text);
  const {
    boot, route, readAndLoad, loadUrl, loadFile, newDocument, recent, doc,
    docIdentity, loading,
  } = documents;

  /* Boot routing + popstate (legacy main.ts boot/route). */
  useEffect(() => {
    run(boot());
    const onPopstate = () => {
      run(route());
    };
    window.addEventListener('popstate', onPopstate);
    return () => window.removeEventListener('popstate', onPopstate);
  }, [boot, route]);

  /* Legacy bindUI keyboard shortcuts: Ctrl/Cmd+O opens the dialog, Escape
     closes the panel. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        setDialogOpen(true);
      } else if (e.key === 'Escape') {
        setPanelOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* Legacy bindDrop: dropping a .md file anywhere loads it. */
  useEffect(() => {
    const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e)) {
        e.preventDefault();
        setDropOpen(true);
      }
    };
    const onDragLeave = (e: DragEvent) => {
      if (!e.relatedTarget) setDropOpen(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDropOpen(false);
      run(readAndLoad(e.dataTransfer?.files[0] ?? null));
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [readAndLoad]);

  const handleCycleDir = useCallback(() => {
    const next = cycleDir();
    toast(`${t('toggleDir').split('(')[0].trim()}: ${DIR_LABELS[next]}`);
  }, [cycleDir, toast, t]);

  const handleShare = useCallback(() => {
    run(copyShareLink(editorCtl.api.getText(), { t, toast }));
  }, [editorCtl, toast, t]);

  const handleNewDocument = useCallback(() => {
    if (!newDocument(editorCtl.text.trim() !== '')) return;
    setPanelOpen(false);
    editorCtl.focus();
  }, [newDocument, editorCtl]);

  const sidebar = useMemo(() => (
    <Sidebar
      open={panelOpen}
      onClose={() => setPanelOpen(false)}
      toc={previewState.toc}
      activeHeadingId={activeHeadingId}
      recent={recent}
      onOpenFileParam={(fileParam) => {
        run(loadFile(fileParam));
      }}
      onOpenRecent={(item) => {
        run(loadUrl(item.url));
      }}
      onNewDocument={handleNewDocument}
    />
  ), [panelOpen, previewState.toc, activeHeadingId, recent, loadFile, loadUrl, handleNewDocument]);

  return (
    <EditorProvider api={editorCtl.api}>
      <Topbar
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen((open) => !open)}
        mode={mode}
        onSetMode={setMode}
        onOpen={() => setDialogOpen(true)}
        onShare={handleShare}
        onCycleDir={handleCycleDir}
        lang={lang}
        onToggleLang={onToggleLang}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <Workspace
        mode={mode}
        editor={editorCtl}
        docName={doc?.name ?? ''}
        lang={lang}
        dirEditor={dirEditor}
        previewState={previewState}
        previewDir={dirEditor}
        dirMode={dirMode}
        theme={theme}
        docIdentity={docIdentity}
        onSpyChange={setActiveHeadingId}
        onOpenDocLink={(href) => {
          run(loadUrl(href));
        }}
      />

      {sidebar}

      <OpenDialog
        isOpen={dialogOpen}
        onOpenChange={setDialogOpen}
        onOpenUrl={(url) => {
          run(loadUrl(url));
        }}
        onOpenFile={(file) => {
          run(readAndLoad(file));
        }}
        onPaste={(text) => documents.loadPasted(text)}
      />

      {dropOpen && (
        <div className={styles.dropOverlay} aria-hidden="true">
          <div className={styles.dropBox}>
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
            </svg>
            <p>{t('dropHere')}</p>
          </div>
        </div>
      )}

      {loading && (
        <div className={styles.loading} aria-hidden="true">
          <div className={styles.spinner} />
        </div>
      )}

      <footer className={styles.footer}>
        <span>
          {t('appTitle')}
          {' '}
          —
          {' '}
          {t('footer')}
        </span>
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
    </EditorProvider>
  );
}

export default function App() {
  const [lang, setLang] = useState<Lang>(() => enumOr(
    store.get<Lang | null>('lang', null),
    LANGS,
    defaultLang(navigator.language),
  ));

  // The documentElement lang/dir flip drives everything: CSS mirroring and
  // React Aria's direction (it reads <html lang> by design).
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
    document.title = documentTitle(lang);
  }, [lang]);

  const toggleLang = useCallback(() => {
    setLang((prev) => {
      const next: Lang = prev === 'fa' ? 'en' : 'fa';
      store.set('lang', next);
      return next;
    });
  }, []);

  return (
    <I18nProvider lang={lang}>
      <ThemeProvider>
        <ToastProvider>
          <Shell lang={lang} onToggleLang={toggleLang} />
        </ToastProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}
