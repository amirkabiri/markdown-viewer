// Module: features/editor/api — the FROZEN editor contract the AI panel
// programs against. The live implementation is built by useEditorController
// (the textarea is the single source of truth) and published app-wide through
// EditorProvider; the AI panel consumes it with useEditor(). Do not rename,
// move, or change these exports without lead sign-off.

import type { EditMode } from '../../lib/ai/edits';

export type { EditMode };

export interface EditorApi {
  /** The full document text (the textarea value). */
  getText(): string;
  /** The live selection as textarea offsets ([start, end)). */
  getSelection(): { start: number; end: number };
  /** True when the selection is non-empty. */
  hasSelection(): boolean;
  /**
   * Apply an assistant edit per mode ('cursor' | 'replace-selection' |
   * 'append' | 'replace-document'). `pinnedRange` targets the range the
   * caller captured earlier (the selection may have moved while the reply
   * was streaming); without it the live selection is used. Preserves the
   * native undo stack where the platform allows (execCommand insertText),
   * falling back to setRangeText — the identical legacy mechanism. Asks for
   * confirmation only for replace-document (the aiReplaceDocConfirm string).
   * Returns false only when the user cancelled that confirmation.
   */
  applyEdit(mode: EditMode, text: string, pinnedRange?: [number, number]): boolean;
}
