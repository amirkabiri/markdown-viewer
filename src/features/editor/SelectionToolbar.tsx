// The floating markdown formatting menu over an editor selection: a hidden
// 0×0 anchor div positioned at the selection's start (wrapper coordinates
// from useSelectionToolbar / caretGeometry) anchors a standalone React Aria
// Popover+Menu — the verified custom-anchor pattern (research §2.2). RAC
// provides the full APG menu semantics once open (arrows, Home/End,
// typeahead, Enter, Escape), outside-press dismissal, viewport clamping and
// focus restore to the textarea; the nested I18nProvider makes the placement
// follow the DOCUMENT's direction (an RTL document flips the menu even under
// an LTR UI), consistent with the app-wide RAC choice (docs/uikit-research).
//
// Writes go through controller.applyFormat with the PINNED selection, so
// every action is one native undo step and fires onDocChange (autosave).
// Phase 1 is pointer-driven only (the hook gates to fine pointers); no
// keyboard shortcuts are bound to the actions (SHORTCUTS audit: Mod+B/I/U
// stay free).
import { useRef } from 'react';
import type { RefObject } from 'react';
import {
  I18nProvider, MenuItem, Menu, Popover,
} from 'react-aria-components';

import { useT } from '../../app/i18n';

import type { CaretMeasurer } from './caretGeometry';
import type { FormatAction } from './markdownActions';
import styles from './SelectionToolbar.module.css';
import { useSelectionToolbar } from './useSelectionToolbar';
import type { EditorController } from './useEditorController';

export interface SelectionToolbarProps {
  /** The editor textarea (the selection owner). */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Writes formatting through the controller's undo-preserving primitive. */
  controller: EditorController;
  /** The DOCUMENT's rendered direction — the menu placement follows it. */
  dir: 'ltr' | 'rtl';
  /** Non-editable documents never show the toolbar. */
  readOnly: boolean;
  /** Measurement seam — tests inject a scripted fake (caretGeometry). */
  // eslint-disable-next-line react/require-default-props
  createMeasurer?: (textarea: HTMLTextAreaElement) => CaretMeasurer;
}

/** The default menu, in the research's §6 order. */
const ACTIONS: readonly { id: FormatAction; labelKey: string }[] = [
  { id: 'bold', labelKey: 'fmtBold' },
  { id: 'italic', labelKey: 'fmtItalic' },
  { id: 'strikethrough', labelKey: 'fmtStrikethrough' },
  { id: 'inlineCode', labelKey: 'fmtInlineCode' },
  { id: 'link', labelKey: 'fmtLink' },
  { id: 'heading2', labelKey: 'fmtHeading2' },
  { id: 'heading3', labelKey: 'fmtHeading3' },
  { id: 'bulletList', labelKey: 'fmtBulletList' },
  { id: 'numberedList', labelKey: 'fmtNumberedList' },
  { id: 'taskList', labelKey: 'fmtTaskList' },
  { id: 'blockquote', labelKey: 'fmtBlockquote' },
  { id: 'codeBlock', labelKey: 'fmtCodeBlock' },
];

/** RAC derives menu direction from its locale; picking the locale that
 *  matches the DOCUMENT's direction flips placement for RTL documents. */
function localeForDirection(dir: 'ltr' | 'rtl'): string {
  return dir === 'rtl' ? 'fa' : 'en';
}

export default function SelectionToolbar({
  textareaRef, controller, dir, readOnly, createMeasurer,
}: SelectionToolbarProps) {
  const t = useT();
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const {
    open, anchor, hide, applyAction,
  } = useSelectionToolbar({
    textareaRef, controller, readOnly, createMeasurer,
  });

  return (
    <>
      <div
        ref={anchorRef}
        className={styles.anchor}
        style={{ left: `${anchor.x}px`, top: `${anchor.y}px` }}
        aria-hidden="true"
        data-testid="selection-anchor"
      />
      <I18nProvider locale={localeForDirection(dir)}>
        <Popover
          triggerRef={anchorRef}
          isOpen={open}
          onOpenChange={(next) => {
            if (!next) hide();
          }}
          placement="top"
          offset={10}
          isNonModal
          className={styles.popover}
        >
          <Menu
            aria-label={t('fmtMenu')}
            autoFocus="first"
            onClose={hide}
            onAction={(key) => applyAction(key as FormatAction)}
            className={styles.menu}
          >
            {ACTIONS.map(({ id, labelKey }) => (
              <MenuItem key={id} id={id} className={styles.menuItem}>
                {t(labelKey)}
              </MenuItem>
            ))}
          </Menu>
        </Popover>
      </I18nProvider>
    </>
  );
}
