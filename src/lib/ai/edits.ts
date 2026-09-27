// Module: lib/ai/edits — the PURE half of the direct-edit pipeline: the
// EditMode union, the pure computeEdit planner (edit plans over an
// EditorSnapshot, no DOM), and the selection-aware chat prompt builder
// (buildSelectionMessages). The DOM half — applyEdit writing into the live
// textarea (execCommand + undo stack, replace-document confirm, the bubbling
// input event) — STAYS in legacy/src/ai/edits.ts on purpose: the React layer
// re-imagines it as effects over the editor. The aiReplaceDocConfirm string
// lives in src/i18n/dictionaries.ts. Legacy twin: legacy/src/ai/edits.ts.

import { BUILTIN_SYSTEM_PROMPT } from './providers/builtin';
import type { ChatMessage } from './types';

/* ---------------- pure edit computation ---------------- */

/** How an assistant text lands in the document. */
export type EditMode = 'cursor' | 'replace-selection' | 'append' | 'replace-document';

export interface EditorSnapshot {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface EditPlan {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
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
export function computeEdit(snap: EditorSnapshot, text: string, mode: EditMode): EditPlan {
  if (mode === 'replace-document') {
    return { value: text, selectionStart: text.length, selectionEnd: text.length };
  }
  if (mode === 'append') {
    const caret = snap.value.length + text.length;
    return { value: snap.value + text, selectionStart: caret, selectionEnd: caret };
  }
  const [a, b] = clampRange(snap); // 'cursor' inserts at a; 'replace-selection' rewrites [a, b)
  const head = snap.value.slice(0, a);
  const tail = snap.value.slice(mode === 'replace-selection' ? b : a);
  const caret = a + text.length;
  return { value: head + text + tail, selectionStart: caret, selectionEnd: caret };
}

/* ---------------- selection-aware chat prompt builder ---------------- */

/** Soft cap for the context block (agent.ts keeps the same cap for
 *  read_document tool results). */
export const MAX_CONTEXT_CHARS = 12000;

/** Pure: head+tail clip with an elision marker (same shape as agent.ts clipToolResult). */
export function clipContext(text: string): string {
  if (text.length <= MAX_CONTEXT_CHARS) return text;
  const half = Math.floor(MAX_CONTEXT_CHARS / 2);
  return `${text.slice(0, half)}\n\n[…]\n\n${text.slice(-half)}`;
}

const SELECTION_DIRECTIVE = 'The user selected a section of their document. Apply their instruction to that selection. Return ONLY the edited selection as Markdown — never the whole document.';

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
export function buildSelectionMessages(
  instruction: string,
  selection: string,
  docContext: string,
): ChatMessage[] {
  if (selection.trim() === '') return [{ role: 'user', content: instruction }];
  // Byte-identical to the legacy concatenation: instruction, the delimited
  // (never clipped) selection, then the labelled, clipped document context.
  const user = [
    instruction,
    '',
    `<selection>\n${selection}\n</selection>`,
    '',
    'Surrounding document context (reference only — never part of the reply; the edited selection must blend into it):',
    `<document>\n${clipContext(docContext)}\n</document>`,
  ].join('\n');
  return [
    { role: 'system', content: `${BUILTIN_SYSTEM_PROMPT}\n\n${SELECTION_DIRECTIVE}` },
    { role: 'user', content: user },
  ];
}
