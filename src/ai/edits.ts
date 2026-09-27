// Module: ai/edits — direct-edit pipeline: pure edit computation, applying
// edits to the document textarea, and the selection-aware chat prompt builder.
// computeEdit/buildSelectionMessages are pure (unit-tested in
// test/ai-edits.test.ts); applyEdit touches the DOM (editor/i18n/confirm).

import { editor } from '../state.js';
import { t } from '../i18n.js';
import { BUILTIN_SYSTEM_PROMPT } from './providers/builtin.js';
import type { ChatMessage } from './types.js';

/* ---------------- pure edit computation ---------------- */

/** How an assistant text lands in the document. */
export type EditMode = 'cursor' | 'replace-selection' | 'append' | 'replace-document';

export interface EditorSnapshot { value: string; selectionStart: number; selectionEnd: number }

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** Ordered, clamped [start, end) of a snapshot's selection. */
function clampRange(snap: EditorSnapshot): [number, number] {
  const len = snap.value.length;
  const a = clamp(Math.min(snap.selectionStart, snap.selectionEnd), 0, len);
  return [a, clamp(Math.max(snap.selectionStart, snap.selectionEnd), a, len)];
}

/**
 * Pure: plans an edit against a document snapshot without touching the DOM.
 * Returns the new value plus where the caret lands — always at the end of the
 * inserted text (collapsed selection). Empty selection in
 * `replace-selection` mode degrades to a plain insert at the caret.
 */
export function computeEdit(snap: EditorSnapshot, text: string, mode: EditMode): Required<EditorSnapshot> {
  if (mode === 'replace-document') {
    return { value: text, selectionStart: text.length, selectionEnd: text.length };
  }
  if (mode === 'append') {
    const at = snap.value.length;
    return { value: snap.value + text, selectionStart: at + text.length, selectionEnd: at + text.length };
  }
  const [a, b] = clampRange(snap); // 'cursor' inserts at a; 'replace-selection' rewrites [a, b)
  const head = snap.value.slice(0, a);
  const tail = snap.value.slice(mode === 'replace-selection' ? b : a);
  const caret = a + text.length;
  return { value: head + text + tail, selectionStart: caret, selectionEnd: caret };
}

/* ---------------- applying edits to the textarea ---------------- */

/**
 * Writes `text` into the document textarea per `mode`. Focuses the editor.
 * cursor/replace-selection first try setSelectionRange + execCommand
 * insertText, which preserves the native undo stack (wrapped — execCommand is
 * deprecated and may be missing); otherwise (and for append/replace-document)
 * setRangeText applies the exact computeEdit plan. replace-document asks for
 * confirmation and aborts silently on cancel. Always dispatches a bubbling
 * input event so preview/counts/RTL stay live. Returns false only when the
 * user cancelled the replace-document confirmation.
 */
export function applyEdit(mode: EditMode, text: string): boolean {
  if (mode === 'replace-document' && !confirm(t('aiReplaceDocConfirm'))) return false;

  const len = editor.value.length;
  const a = clamp(Math.min(editor.selectionStart, editor.selectionEnd), 0, len);
  const b = clamp(Math.max(editor.selectionStart, editor.selectionEnd), a, len);
  // Source range the edit targets (insert-only range for cursor/append) —
  // exactly the range computeEdit would rewrite for this mode.
  const [insStart, insEnd] =
    mode === 'replace-selection' ? [a, b]
      : mode === 'append' ? [len, len]
        : mode === 'replace-document' ? [0, len]
          : [a, a];

  editor.focus();
  let done = false;
  if ((mode === 'cursor' || mode === 'replace-selection') && text !== '') {
    try {
      editor.setSelectionRange(insStart, insEnd);
      done = document.execCommand('insertText', false, text);
    } catch { done = false; } // execCommand may be undefined / throw — fall back
  }
  if (!done) editor.setRangeText(text, insStart, insEnd, 'end');
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

/* ---------------- selection-aware chat prompt builder ---------------- */

/** Soft cap for the context block (mirrors MAX_PROMPT_CHARS in index.ts). */
const MAX_CONTEXT_CHARS = 12000;

/** Pure: head+tail clip with an elision marker (same shape as index.ts clip). */
function clipContext(text: string): string {
  if (text.length <= MAX_CONTEXT_CHARS) return text;
  const half = Math.floor(MAX_CONTEXT_CHARS / 2);
  return text.slice(0, half) + '\n\n[…]\n\n' + text.slice(-half);
}

const SELECTION_DIRECTIVE =
  'The user selected a section of their document. Apply their instruction to that selection. Return ONLY the edited selection as Markdown — never the whole document.';

/**
 * Pure: prompt for selection-aware chat — the user selects a section and
 * gives a natural-language instruction; the model must return exactly the
 * edited selection. System message restates the markdown-assistant rules plus
 * the selection directive; the user message carries the instruction, the
 * selection delimited (<selection>…</selection>, never clipped — the reply
 * replaces it verbatim) and the surrounding document as clearly-labelled,
 * clipped context so the edit blends in. Guard: an empty (whitespace-only)
 * selection falls back to the plain whole-document chat shape.
 */
export function buildSelectionMessages(instruction: string, selection: string, docContext: string): ChatMessage[] {
  if (selection.trim() === '') return [{ role: 'user', content: instruction }];
  const user =
    instruction + '\n\n' +
    '<selection>\n' + selection + '\n</selection>\n\n' +
    'Surrounding document context (reference only — never part of the reply; the edited selection must blend into it):\n' +
    '<document>\n' + clipContext(docContext) + '\n</document>';
  return [
    { role: 'system', content: BUILTIN_SYSTEM_PROMPT + '\n\n' + SELECTION_DIRECTIVE },
    { role: 'user', content: user },
  ];
}
