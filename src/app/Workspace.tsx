// The workspace (legacy div#workspace): editor pane | divider | preview pane.
// Owns the split-fraction drag (double-click resets, RTL-aware) and the
// bidirectional editor/preview scroll sync with the legacy 60 ms lock.
import { useEffect, useRef, type CSSProperties } from 'react';

import { useT } from './i18n';
import Editor from '../features/editor/Editor';
import type { EditorController } from '../features/editor/useEditorController';
import Preview from '../features/preview/Preview';
import type { MarkdownPreviewState } from '../features/preview/useMarkdownPreview';
import {
  countChars, countWords, localeForLang, store,
} from '../lib/store';
import type {
  ContentDir, Lang, PaneMode, Theme,
} from '../lib/store';

import styles from './Workspace.module.css';

export interface WorkspaceProps {
  mode: PaneMode;
  editor: EditorController;
  docName: string;
  lang: Lang;
  dirEditor: 'ltr' | 'rtl';
  previewState: MarkdownPreviewState;
  previewDir: 'ltr' | 'rtl';
  dirMode: ContentDir;
  theme: Theme;
  docIdentity: string;
  onSpyChange: (id: string | null) => void;
  onOpenDocLink: (href: string) => void;
}

const SPLIT_MIN = 0.2;
const SPLIT_MAX = 0.8;
/** Legacy scroll-sync lock: ignore echo scrolls for 60 ms. */
const SCROLL_LOCK_MS = 60;

export default function Workspace({
  mode, editor, docName, lang, dirEditor, previewState, previewDir, dirMode,
  theme, docIdentity, onSpyChange, onOpenDocLink,
}: WorkspaceProps) {
  const t = useT();
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const dividerRef = useRef<HTMLDivElement | null>(null);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const savedSplit = store.get<string | null>('split', null);

  /* Divider drag + double-click reset (legacy initDivider). */
  useEffect(() => {
    const divider = dividerRef.current;
    const workspace = workspaceRef.current;
    if (!divider || !workspace) return undefined;

    const onPointerDown = (e: PointerEvent) => {
      if (modeRef.current !== 'split') return;
      divider.setPointerCapture(e.pointerId);
      divider.classList.add(styles.dragging);
      const rect = workspace.getBoundingClientRect();
      const move = (ev: PointerEvent) => {
        let frac = (ev.clientX - rect.left) / rect.width;
        if (document.documentElement.dir === 'rtl') frac = 1 - frac;
        frac = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, frac));
        workspace.style.setProperty('--split', `${(frac * 100).toFixed(2)}%`);
      };
      const up = () => {
        divider.classList.remove(styles.dragging);
        store.set('split', workspace.style.getPropertyValue('--split'));
        divider.removeEventListener('pointermove', move);
        divider.removeEventListener('pointerup', up);
      };
      divider.addEventListener('pointermove', move);
      divider.addEventListener('pointerup', up);
    };
    const onDblClick = () => {
      workspace.style.removeProperty('--split');
      store.set('split', null);
    };

    divider.addEventListener('pointerdown', onPointerDown);
    divider.addEventListener('dblclick', onDblClick);
    return () => {
      divider.removeEventListener('pointerdown', onPointerDown);
      divider.removeEventListener('dblclick', onDblClick);
    };
  }, []);

  /* Editor <-> preview scroll sync (legacy bindScrollSync). */
  useEffect(() => {
    const workspace = workspaceRef.current;
    const previewScroll = previewScrollRef.current;
    if (!workspace || !previewScroll) return undefined;
    const editorEl = workspace.querySelector('textarea');
    if (!editorEl) return undefined;

    let lockUntil = 0;
    const fraction = (el: HTMLElement) => el.scrollTop
      / Math.max(1, el.scrollHeight - el.clientHeight);
    const onEditorScroll = () => {
      if (modeRef.current !== 'split' || Date.now() < lockUntil) return;
      lockUntil = Date.now() + SCROLL_LOCK_MS;
      previewScroll.scrollTop = fraction(editorEl)
        * Math.max(0, previewScroll.scrollHeight - previewScroll.clientHeight);
    };
    const onPreviewScroll = () => {
      if (modeRef.current !== 'split' || Date.now() < lockUntil) return;
      lockUntil = Date.now() + SCROLL_LOCK_MS;
      editorEl.scrollTop = fraction(previewScroll)
        * Math.max(0, editorEl.scrollHeight - editorEl.clientHeight);
    };
    editorEl.addEventListener('scroll', onEditorScroll);
    previewScroll.addEventListener('scroll', onPreviewScroll);
    return () => {
      editorEl.removeEventListener('scroll', onEditorScroll);
      previewScroll.removeEventListener('scroll', onPreviewScroll);
    };
  }, []);

  const splitStyle = savedSplit
    ? ({ '--split': savedSplit } as CSSProperties)
    : undefined;

  return (
    <main
      ref={workspaceRef}
      className={`${styles.workspace} ${styles[`mode${mode[0].toUpperCase()}${mode.slice(1)}`]}`}
      style={splitStyle}
    >
      <section className={styles.editorPane} aria-label="Markdown editor">
        <div className={styles.paneHead}>
          <span className={styles.paneLabel}>{t('editor')}</span>
          <span className={styles.docName}>{docName}</span>
        </div>
        <Editor
          controller={editor}
          dir={dirEditor}
          ariaLabel={t('editorAria')}
          placeholder="# Start writing… / بنویسید…"
        />
        <div className={styles.statusbar}>
          <span>{countWords(editor.text).toLocaleString(localeForLang(lang))}</span>
          <span>{t('words')}</span>
          <span className={styles.dot}>·</span>
          <span>{countChars(editor.text).toLocaleString(localeForLang(lang))}</span>
          <span>{t('chars')}</span>
        </div>
      </section>

      <div
        ref={dividerRef}
        className={styles.divider}
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize · double-click to reset"
      />

      <section className={styles.previewPane} aria-label="Preview">
        <div className={styles.paneHead}>
          <span className={styles.paneLabel}>{t('preview')}</span>
        </div>
        <Preview
          state={previewState}
          dir={previewDir}
          dirMode={dirMode}
          theme={theme}
          docIdentity={docIdentity}
          scrollRef={previewScrollRef}
          onSpyChange={onSpyChange}
          onOpenDocLink={onOpenDocLink}
        />
      </section>
    </main>
  );
}
