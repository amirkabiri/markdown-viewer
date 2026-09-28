// Module: features/documents/DocumentList — the persisted documents list for
// the sidebar. One row per repository record, in repository (sortIndex)
// order: activate selects it into the editor, double-click (or the row menu's
// Rename) renames inline, Move up / Move down reorder from the keyboard, and
// the grip handle reorders by pointer (hit-tested against row midpoints —
// direction-agnostic, so RTL mirrors for free through logical CSS). Removal
// is gated by a non-dismissable confirm dialog (RAC alertdialog — explicit
// answer required), localized, with the document name interpolated.
//
// Presentational + intent-firing: persistence itself happens in the parent
// (useDocuments → repository); this component owns only interaction state.
import { useCallback, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import {
  Button, Dialog, Heading, Menu, MenuItem, MenuTrigger, Modal, ModalOverlay, Popover,
} from 'react-aria-components';

import { useT } from '../../app/i18n';
import type { DocumentRecord } from '../../lib/persistence';

import DocumentName from './DocumentName';
import styles from './DocumentList.module.css';

export interface DocumentListProps {
  docs: DocumentRecord[];
  activeDocId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
}

type RowAction = 'rename' | 'up' | 'down' | 'remove';

/** Pointer movement under this threshold is a press, not a drag. */
const DRAG_THRESHOLD_PX = 3;

export default function DocumentList({
  docs, activeDocId, onSelect, onRename, onRemove, onReorder,
}: DocumentListProps) {
  const t = useT();
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const dragMovedRef = useRef(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<DocumentRecord | null>(null);

  const rowRef = useCallback((id: string, el: HTMLLIElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  /** Insert `draggedId` at the position under pointer `y`, then commit. */
  const reorderTo = useCallback((
    y: number,
    draggedId: string,
    midYs: { id: string; midY: number }[],
  ): void => {
    // Hit-test against the geometry FROZEN at drag start: the live list
    // re-renders under the pointer mid-drag (and engines interleave those
    // commits with pointer events differently — see WebKit).
    const rest = docs.map((record) => record.id).filter((id) => id !== draggedId);
    const insertAt = midYs.filter(
      (row) => row.id !== draggedId && y >= row.midY,
    ).length;
    const next = [
      ...rest.slice(0, insertAt),
      draggedId,
      ...rest.slice(insertAt),
    ];
    if (next.some((id, index) => id !== docs[index].id)) onReorder(next);
  }, [docs, onReorder]);

  /*
   * Pointer-based drag. The window listeners attach SYNCHRONOUSLY inside the
   * pointerdown handler — going through an effect would miss the moves an
   * automated (or merely fast) pointer makes before React commits.
   */
  const startDrag = useCallback((id: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    // Prevent the default press behavior (focus ring, text-selection
    // gesture) — WebKit fires pointercancel for selection mid-drag, which
    // would silently end the reorder.
    event.preventDefault();
    const startY = event.clientY;
    dragMovedRef.current = false;
    setDraggingId(id);
    const midYs = [...rowRefs.current.entries()].map(([rowId, el]) => ({
      id: rowId,
      midY: el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2,
    }));

    const onMove = (moveEvent: PointerEvent): void => {
      if (!dragMovedRef.current && Math.abs(moveEvent.clientY - startY) < DRAG_THRESHOLD_PX) {
        return;
      }
      dragMovedRef.current = true;
      reorderTo(moveEvent.clientY, id, midYs);
    };
    const onUp = (): void => {
      dragMovedRef.current = false;
      setDraggingId(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [reorderTo]);

  /** The keyboard-accessible reorder path (the grip is pointer-only). */
  const moveRow = useCallback((id: string, delta: -1 | 1) => {
    const ids = docs.map((record) => record.id);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    onReorder(ids);
  }, [docs, onReorder]);

  const handleRowAction = useCallback((key: RowAction, record: DocumentRecord) => {
    if (key === 'rename') setRenamingId(record.id);
    else if (key === 'up') moveRow(record.id, -1);
    else if (key === 'down') moveRow(record.id, 1);
    else setPendingRemove(record);
  }, [moveRow]);

  const confirmRemove = useCallback(() => {
    if (!pendingRemove) return;
    onRemove(pendingRemove.id);
    setPendingRemove(null);
  }, [onRemove, pendingRemove]);

  const handleDialogKeyDown = useCallback((event: ReactKeyboardEvent) => {
    if (event.key === 'Escape') setPendingRemove(null);
  }, []);

  /**
   * a11y — arrow-key list navigation: Up/Down move focus between rows
   * (wrapping at the ends), landing on the row's name button. Vertical
   * arrows are direction-neutral, so RTL needs no flip; left/right stay the
   * natural Tab order within a row. Only PLAIN buttons participate: the
   * inline rename input is never hijacked mid-typing, the decorative grip
   * (tabIndex -1, aria-hidden) is excluded by the selector, and RAC widgets
   * (the row-menu trigger) keep their own arrow-key semantics.
   */
  const handleListKeyDown = useCallback((event: ReactKeyboardEvent<HTMLUListElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const target = event.target as Element;
    if (target.tagName !== 'BUTTON' || target.hasAttribute('data-rac')) return;
    const currentLi = target.closest('li');
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLLIElement>('li'));
    if (rows.length < 2 || !currentLi) return;
    const index = rows.indexOf(currentLi);
    if (index < 0) return;
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const next = rows[(index + delta + rows.length) % rows.length];
    next.querySelector<HTMLButtonElement>('button:not([tabindex="-1"])')?.focus();
    event.preventDefault();
  }, []);

  const body = pendingRemove
    ? t('docRemoveConfirmBody').replace('{name}', pendingRemove.name)
    : '';

  return (
    <>
      {/* The ARIA APG list pattern: the CONTAINER roves arrow-key focus
          between rows, so the key handler legitimately lives on the list. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <ul className={styles.list} aria-label={t('documents')} onKeyDown={handleListKeyDown}>
        {docs.map((record) => {
          const active = record.id === activeDocId;
          return (
            <li
              key={record.id}
              ref={(el) => rowRef(record.id, el)}
              className={[styles.row, active ? styles.rowActive : '', draggingId === record.id ? styles.rowDragging : '']
                .join(' ')
                .trim()}
              aria-current={active ? 'true' : undefined}
            >
              <button
                type="button"
                className={styles.grip}
                aria-hidden="true"
                tabIndex={-1}
                onPointerDown={(event) => startDrag(record.id, event)}
              >
                ⠿
              </button>
              <DocumentName
                name={record.name}
                label={t('docRename')}
                editing={renamingId === record.id}
                onEditingChange={(on) => setRenamingId(on ? record.id : null)}
                onCommit={(name) => onRename(record.id, name)}
                onActivate={() => onSelect(record.id)}
                className={styles.name}
                inputClassName={styles.nameInput}
              />
              <MenuTrigger>
                <Button
                  aria-label={`${t('docActions')} – ${record.name}`}
                  className={styles.menuBtn}
                >
                  ⋯
                </Button>
                <Popover className={styles.popover}>
                  <Menu
                    className={styles.menu}
                    onAction={(key) => handleRowAction(String(key) as RowAction, record)}
                  >
                    <MenuItem id="rename" className={styles.menuItem}>{t('docRename')}</MenuItem>
                    <MenuItem id="up" className={styles.menuItem} isDisabled={docs[0]?.id === record.id}>
                      {t('docMoveUp')}
                    </MenuItem>
                    <MenuItem id="down" className={styles.menuItem} isDisabled={docs[docs.length - 1]?.id === record.id}>
                      {t('docMoveDown')}
                    </MenuItem>
                    <MenuItem id="remove" className={`${styles.menuItem} ${styles.menuItemDanger}`}>
                      {t('docRemove')}
                    </MenuItem>
                  </Menu>
                </Popover>
              </MenuTrigger>
            </li>
          );
        })}
      </ul>

      {pendingRemove && (
        <ModalOverlay isDismissable={false} isOpen className={styles.overlay}>
          <Modal className={styles.modal}>
            <Dialog role="alertdialog" aria-label={t('docRemoveConfirmTitle')} className={styles.dialog}>
              <Heading slot="title" className={styles.title}>{t('docRemoveConfirmTitle')}</Heading>
              <p className={styles.body}>{body}</p>
              <div className={styles.actions}>
                <Button className={styles.btnGhost} onPress={() => setPendingRemove(null)}>
                  {t('cancel')}
                </Button>
                <Button
                  className={styles.btnDanger}
                  onPress={confirmRemove}
                  onKeyDown={handleDialogKeyDown}
                >
                  {t('docRemove')}
                </Button>
              </div>
            </Dialog>
          </Modal>
        </ModalOverlay>
      )}
    </>
  );
}
