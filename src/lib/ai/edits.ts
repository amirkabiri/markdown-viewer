// Module: lib/ai/edits — the PURE half of the direct-edit pipeline: the
// EditMode union, the pure computeEdit planner (edit plans over an
// EditorSnapshot, no DOM), the v2 content-anchored planners
// (planReplaceText / planReplaceRange — structured, retryable, no DOM), and
// the selection-aware chat prompt builder (buildSelectionMessages). The DOM
// half — applyEdit writing into the live textarea (execCommand + undo stack,
// replace-document confirm, the bubbling input event) — STAYS in
// legacy/src/ai/edits.ts on purpose: the React layer re-imagines it as
// effects over the editor. The aiReplaceDocConfirm string lives in
// src/i18n/dictionaries.ts. Legacy twin: legacy/src/ai/edits.ts.

import { BUILTIN_SYSTEM_PROMPT } from './providers/builtin';
import { countLines } from './tool-results';
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

/* ---------------- v2 content-anchored planners ---------------- */

/** Which match(es) a replace_text targets. */
export type ReplaceTextOccurrence = 'first' | 'all';

/** One replacement span over the CURRENT document (char offsets, [start, end))
 *  plus the anchors the TOOL RESULT reports. `matchCount` surfaces ambiguity:
 *  a SEARCH text found N>1 times replaces the first span and says so. */
export interface SpanReplacePlan {
  start: number;
  end: number;
  replacement: string;
  matchCount: number;
  startLine: number;
  endLine: number;
}

export type ReplaceTextPlan =
  | { status: 'ok'; plan: SpanReplacePlan }
  | { status: 'error'; code: 'NOT_FOUND' | 'BAD_SEARCH'; hint: string; nearestLines: number[] };

export type ReplaceRangePlan =
  | { status: 'ok'; plan: SpanReplacePlan }
  | { status: 'error'; code: 'STALE_RANGE' | 'BAD_RANGE'; hint: string; totalLines: number };

/** Count of '\n' before offset (→ 1-based line number), one pass. */
function lineAt(doc: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < doc.length; i += 1) {
    if (doc[i] === '\n') line += 1;
  }
  return line;
}

function spanPlan(doc: string, start: number, end: number, replacement: string, matchCount: number): SpanReplacePlan {
  return {
    start,
    end,
    replacement,
    matchCount,
    startLine: lineAt(doc, start),
    endLine: lineAt(doc, Math.max(start, end - 1)),
  };
}

/** All non-overlapping matches, exact pass first. */
function findExactMatches(doc: string, search: string): [number, number][] {
  const matches: [number, number][] = [];
  let from = 0;
  for (;;) {
    const at = doc.indexOf(search, from);
    if (at < 0) break;
    matches.push([at, at + search.length]);
    from = at + search.length; // non-overlapping
  }
  return matches;
}

/** Whitespace-tolerant fallback: every whitespace RUN in the search text
 *  (spaces, tabs, newlines — the exact drift models produce) matches any
 *  whitespace run in the document; everything else is literal. */
function findTolerantMatches(doc: string, search: string): [number, number][] {
  const parts = search.split(/\s+/).filter((part) => part !== '');
  if (parts.length === 0) return [];
  const source = parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  const re = new RegExp(source, 'g');
  const matches: [number, number][] = [];
  for (let m = re.exec(doc); m !== null; m = re.exec(doc)) {
    matches.push([m.index, m.index + m[0].length]);
    if (m.index === re.lastIndex) re.lastIndex += 1; // zero-width safety
  }
  return matches;
}

/** 1-based lines of the document whose text contains one of the search text's
 *  own non-trivial lines — the "nearest anchors" of a NOT_FOUND result. */
function nearestAnchors(doc: string, search: string, limit = 3): number[] {
  const probes = search
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 4)
    .slice(0, 2); // first + last significant line of the SEARCH block
  if (probes.length === 0) return [];
  const anchors: number[] = [];
  const lines = doc.split('\n');
  for (let i = 0; i < lines.length && anchors.length < limit; i += 1) {
    if (probes.some((probe) => lines[i].includes(probe))) anchors.push(i + 1);
  }
  return anchors;
}

/**
 * Pure: plans a content-anchored SEARCH/REPLACE against the current document.
 * Exact match first; a whitespace-tolerant fallback catches indentation/EOL
 * drift. `occurrence: 'all'` collapses every match into ONE span (the
 * interior is rebuilt) so applying it stays a single editor undo step.
 * Failure is structured data (code + hint + nearest matching lines), never
 * prose — the agent feeds it back verbatim for a retry.
 */
export function planReplaceText(
  doc: string,
  search: string,
  replacement: string,
  occurrence: ReplaceTextOccurrence = 'first',
): ReplaceTextPlan {
  if (search === '') {
    return {
      status: 'error',
      code: 'BAD_SEARCH',
      hint: 'the SEARCH block is empty — quote the exact current text to find',
      nearestLines: [],
    };
  }
  let matches = findExactMatches(doc, search);
  if (matches.length === 0) matches = findTolerantMatches(doc, search);
  if (matches.length === 0) {
    return {
      status: 'error',
      code: 'NOT_FOUND',
      hint: 're-read the region with read_document and retry with the exact current text, or include the text in your reply',
      nearestLines: nearestAnchors(doc, search),
    };
  }
  const [firstStart] = matches[0];
  if (occurrence === 'first' || matches.length === 1) {
    return { status: 'ok', plan: spanPlan(doc, firstStart, matches[0][1], replacement, matches.length) };
  }
  // occurrence 'all': ONE span from the first to the last match, the interior
  // rebuilt match-by-match — a single splice keeps undo atomic.
  const lastEnd = matches[matches.length - 1][1];
  let interior = '';
  let cursor = firstStart;
  for (const [start, end] of matches) {
    interior += doc.slice(cursor, start) + replacement;
    cursor = end;
  }
  return { status: 'ok', plan: spanPlan(doc, firstStart, lastEnd, interior, matches.length) };
}

/**
 * Pure: plans a whole-line range replacement. `basisDoc` is the document as
 * of the model's most recent read/search — when the live document has moved
 * past it (user typing, an earlier edit), the range is STALE and the plan
 * refuses with structured data instead of corrupting the document. A body
 * that would glue onto the following line gains a terminating newline.
 */
export function planReplaceRange(
  doc: string,
  basisDoc: string,
  startLine: number,
  endLine: number,
  body: string,
): ReplaceRangePlan {
  const totalLines = countLines(doc);
  if (doc !== basisDoc) {
    return {
      status: 'error',
      code: 'STALE_RANGE',
      hint: 'the document changed since your last read — re-read the region with read_document, then retry',
      totalLines,
    };
  }
  const valid = Number.isInteger(startLine) && Number.isInteger(endLine)
    && startLine >= 1 && endLine >= startLine && endLine <= totalLines;
  if (!valid) {
    return {
      status: 'error',
      code: 'BAD_RANGE',
      hint: `use 1-based inclusive line numbers within the document (1-${totalLines})`,
      totalLines,
    };
  }
  const starts: number[] = [0];
  for (let i = 0; i < doc.length; i += 1) {
    if (doc[i] === '\n') starts.push(i + 1);
  }
  const start = starts[startLine - 1];
  const endsWithNewline = doc.endsWith('\n');
  const isLastLine = endLine === totalLines;
  // The final line's terminator: when the document is newline-terminated,
  // replace up to (not through) the trailing '\n' so the document stays
  // newline-terminated; otherwise the range runs to the end.
  const end = isLastLine
    ? (endsWithNewline ? doc.length - 1 : doc.length)
    : starts[endLine];
  // Splice hygiene: unless we are replacing through the very end of the
  // document, the body must end with a newline or it glues onto line B+1.
  const replacement = !isLastLine && body !== '' && !body.endsWith('\n') ? `${body}\n` : body;
  return { status: 'ok', plan: spanPlan(doc, start, end, replacement, 1) };
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

const SELECTION_DIRECTIVE = 'The user selected a section of their document (the <selection> block). Apply their instruction to that selection. Either return ONLY the edited selection as Markdown — never the whole document — or, when document editing is enabled, apply it with the document tools as instructed in the tool protocol.';

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
