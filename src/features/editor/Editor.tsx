// The plain document textarea (legacy #editor). Uncontrolled on purpose: the
// DOM value is the single source of truth — documents and AI edits write into
// it imperatively (preserving the native undo stack) and the controller
// mirrors changes into React state.
//
// The line-number gutter (display-only) overlays the textarea's inline-start
// padding: the textarea keeps being THE scroll container with its original
// semantics (regression guard: e2e/scroll.spec.ts), and the gutter's numbers
// derive from the controller's text mirror via useLineNumbers.
import { useEffect, useRef, type CSSProperties } from 'react';

import LineGutter from './LineGutter';
import { createDomLineMeasurer } from './lineMeasurer';
import type { LineMeasurer } from './lineMeasurer';
import { gutterWidthStyle } from './lineNumbers';
import { useLineNumbers } from './useLineNumbers';
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
  /** Measurement seam for the gutter (tests inject a scripted fake). React
   *  19 removed defaultProps — the default parameter is the sanctioned way
   *  to express an optional prop on a function component. */
  // eslint-disable-next-line react/require-default-props
  createMeasurer?: (textarea: HTMLTextAreaElement) => LineMeasurer;
}

/** Module-level so the default never re-creates the measurer per render. */
const defaultCreateMeasurer = createDomLineMeasurer;

export default function Editor({
  controller, dir, ariaLabel, placeholder, readOnly,
  createMeasurer = defaultCreateMeasurer,
}: EditorProps) {
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const lineNumbers = useLineNumbers({
    textareaRef: editorRef,
    text: controller.text,
    createMeasurer,
  });

  // Register the element with the controller from an effect — the controller
  // writes into it imperatively (loadDocument / applyEdit) between renders.
  useEffect(() => {
    controller.attachTextarea(editorRef.current);
    return () => controller.attachTextarea(null);
  }, [controller]);

  return (
    <div
      className={styles.editorWrap}
      style={{ '--gutter-w': gutterWidthStyle(lineNumbers.lineCount) } as CSSProperties}
    >
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
      <LineGutter
        dir={dir}
        tops={lineNumbers.tops}
        scrollTop={lineNumbers.scrollTop}
        viewportHeight={lineNumbers.viewportHeight}
        lineHeight={lineNumbers.lineHeight}
      />
    </div>
  );
}
