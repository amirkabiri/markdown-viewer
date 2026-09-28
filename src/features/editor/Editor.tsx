// The plain document textarea (legacy #editor). Uncontrolled on purpose: the
// DOM value is the single source of truth — documents and AI edits write into
// it imperatively (preserving the native undo stack) and the controller
// mirrors changes into React state.
import { useEffect, useRef } from 'react';

import type { EditorController } from './useEditorController';

import styles from './Editor.module.css';

export interface EditorProps {
  controller: EditorController;
  /** Rendered text direction — the shell computes it (auto-detect or forced). */
  dir: 'ltr' | 'rtl';
  ariaLabel: string;
  placeholder: string;
  /** Non-editable document (readonly session — locked by another tab). */
  readOnly: boolean;
}

export default function Editor({
  controller, dir, ariaLabel, placeholder, readOnly,
}: EditorProps) {
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  // Register the element with the controller from an effect — the controller
  // writes into it imperatively (loadDocument / applyEdit) between renders.
  useEffect(() => {
    controller.attachTextarea(editorRef.current);
    return () => controller.attachTextarea(null);
  }, [controller]);

  return (
    <textarea
      ref={editorRef}
      className={styles.editor}
      dir={dir}
      defaultValue=""
      spellCheck={false}
      autoCapitalize="off"
      autoComplete="off"
      readOnly={readOnly}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onInput={() => controller.syncFromTextarea()}
      onKeyDown={(e) => controller.handleKeyDown(e)}
    />
  );
}
