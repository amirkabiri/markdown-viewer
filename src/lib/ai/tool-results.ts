// Module: lib/ai/tool-results — the v2 tool services and the structured
// TOOL RESULT payloads. DOM-free and dependency-free (node-testable), all
// single-pass and 10 MB-safe (no quadratic structures — Qalam allows 10 MB
// documents; reads/search/outline walk the text once).
//
// Spec §5.3 (docs/agent-framework-research.md):
//   - read_document  → ranged, cat -n style LINE-NUMBERED reads; the header
//                      carries totalLines + a clipped flag (replaces the v1
//                      12k head+tail clip).
//   - search_document→ line-numbered hits; literal by default, regex opt-in,
//                      capped (default 20).
//   - document_outline → ATX headings with line numbers. NOTE: src/lib/
//                      markdown.ts parses POST-RENDER (DOMPurify + highlight
//                      .js + the rendered TOC) and cannot run here; the
//                      outline uses the same ATX grammar in one pure pass.
//   - errors are DATA: { code, message, hint, nearestLines? } formatted by
//     formatToolResult() — never prose the model must guess at (§5.4).
//
// Pending-diff support (§5.4): AUTO_APPLY_MAX_LINES bounds the changed-line
// budget under which a write auto-applies when direct editing is on;
// boundDiffLines bounds what a diff card renders.

/* ---------------- budgets ---------------- */

/** Default + hard cap for one read_document window (lines). */
export const DEFAULT_READ_LIMIT = 400;
export const MAX_READ_LINES = 2000;

/** Default + hard cap for search_document results. */
export const DEFAULT_SEARCH_RESULTS = 20;
export const MAX_SEARCH_RESULTS = 100;

/** One hit line is truncated to this (a 10 MB one-liner must not come back). */
export const MAX_HIT_LINE_CHARS = 200;

/**
 * Changed-line budget (removed + added) under which a write AUTO-APPLIES when
 * direct editing is on; larger edits land as pending diff cards. N = 20: a
 * 10-line SEARCH/REPLACE (~20 changed lines) stays one fluent, in-editor
 * reviewable edit; beyond that the review burden warrants a card, and the
 * bound caps the blast radius of one fuzzy-matched edit.
 */
export const AUTO_APPLY_MAX_LINES = 20;

/** Per-section cap a pending-diff card renders (collapsed beyond this). */
export const MAX_DIFF_LINES_PER_SECTION = 100;

/* ---------------- outcomes ---------------- */

/** Machine-readable failure codes (errors are data, never prose). */
export type ToolErrorCode =
  | 'READ_ONLY'
  | 'NOT_FOUND'
  | 'BAD_SEARCH'
  | 'BAD_BODY'
  | 'BAD_RANGE'
  | 'STALE_RANGE'
  | 'BAD_PATTERN'
  | 'CANCELLED'
  | 'CHANGED';

/** The diff data a pending write carries to the UI card (char span + both
 *  sides — small, bounded by the SEARCH/REPLACE body, never the document). */
export interface PendingDiffData {
  tool: string;
  /** 1-based inclusive line range the edit targets (for the card header). */
  startLine: number;
  endLine: number;
  /** Char span to splice at apply time (content re-verified by the panel). */
  startOffset: number;
  endOffset: number;
  removedText: string;
  addedText: string;
}

/** The executor's verdict for one tool call — the loop turns this into the
 *  TOOL RESULT payload; ok/pending/applied are successes for the model. */
export type ToolOutcome =
  | { status: 'ok'; message: string }
  | { status: 'applied'; message: string }
  | { status: 'pending'; message: string; diff: PendingDiffData }
  | { status: 'refused'; code: 'READ_ONLY'; message: string; hint: string }
  | { status: 'error'; code: ToolErrorCode; message: string; hint: string; nearestLines?: number[] };

/** True when the outcome means "the call succeeded" (a pending card is a
 *  success for the model — the edit awaits the user, it did not fail). */
export function isOkOutcome(outcome: ToolOutcome): boolean {
  return outcome.status === 'ok' || outcome.status === 'applied' || outcome.status === 'pending';
}

/* ---------------- line services ---------------- */

/** Line count in one pass ('' → 0). */
export function countLines(doc: string): number {
  let lines = 0;
  for (let i = 0; i < doc.length; i += 1) {
    if (doc[i] === '\n') lines += 1;
  }
  return doc.length > 0 && !doc.endsWith('\n') ? lines + 1 : lines;
}

/** One cat -n formatted line. */
function numbered(line: number, width: number, text: string): string {
  return `${String(line).padStart(width)}  ${text}`;
}

export interface ReadRange {
  totalLines: number;
  startLine: number;
  endLine: number;
  /** True whenever the response does not cover the whole document. */
  clipped: boolean;
  text: string;
}

/**
 * Pure: ranged, line-numbered read (cat -n style). 1-based inclusive offset,
 * clamped; limit clamped to MAX_READ_LINES. Single pass: walks to the window
 * once and stops. The header's numbers are the model's coordinate system for
 * replace_range.
 */
export function readDocumentLines(doc: string, offset = 1, limit = DEFAULT_READ_LIMIT): ReadRange {
  const totalLines = countLines(doc);
  const startLine = Math.max(1, Math.floor(offset) || 1);
  const maxLimit = Math.max(1, Math.min(Math.floor(limit) || DEFAULT_READ_LIMIT, MAX_READ_LINES));
  const endLine = Math.min(totalLines, startLine + maxLimit - 1);
  const out: string[] = [];
  if (endLine >= startLine) {
    const width = String(totalLines).length;
    let line = 1;
    let from = 0;
    while (from <= doc.length) {
      let nl = doc.indexOf('\n', from);
      const isLast = nl < 0;
      if (isLast) nl = doc.length;
      if (line >= startLine) {
        const text = doc.slice(from, nl);
        if (!(isLast && text === '')) out.push(numbered(line, width, text));
        if (line >= endLine) break;
      }
      if (isLast) break;
      from = nl + 1;
      line += 1;
    }
  }
  return {
    totalLines,
    startLine,
    endLine: out.length > 0 ? startLine + out.length - 1 : startLine - 1,
    clipped: startLine > 1 || endLine < totalLines,
    text: out.join('\n'),
  };
}

/** The read_document payload: header carries totalLines + clipped. */
export function formatDocumentRead(read: ReadRange): string {
  const covered = read.endLine < read.startLine
    ? 'none'
    : `${read.startLine}-${read.endLine}`;
  return `[document · ${read.totalLines} lines · showing ${covered}${read.clipped ? ' · clipped' : ''}]${read.text === '' ? '' : `\n${read.text}`}`;
}

export interface SearchHit {
  line: number;
  text: string;
}

export type SearchResult =
  | { status: 'ok'; hits: SearchHit[]; totalMatches: number; totalLines: number }
  | { status: 'error'; code: 'BAD_PATTERN'; hint: string };

/**
 * Pure: line-numbered search. Literal substring by default; `regex: true`
 * opts into JavaScript regex (invalid source → structured BAD_PATTERN).
 * Single pass, capped at maxResults — the total is still counted so the
 * model knows when to narrow the pattern.
 */
export function searchDocument(
  doc: string,
  pattern: string,
  opts?: { regex?: boolean; maxResults?: number },
): SearchResult {
  if (pattern === '') {
    return { status: 'error', code: 'BAD_PATTERN', hint: '"pattern" must be a non-empty string' };
  }
  let matcher: (line: string) => boolean;
  if (opts?.regex === true) {
    let re: RegExp;
    try {
      re = new RegExp(pattern);
    } catch (err) {
      return {
        status: 'error',
        code: 'BAD_PATTERN',
        hint: `invalid regex: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    matcher = (line) => re.test(line);
  } else {
    matcher = (line) => line.includes(pattern);
  }
  const maxResults = Math.max(1, Math.min(opts?.maxResults ?? DEFAULT_SEARCH_RESULTS, MAX_SEARCH_RESULTS));
  const hits: SearchHit[] = [];
  let totalMatches = 0;
  let line = 1;
  let from = 0;
  while (from <= doc.length) {
    let nl = doc.indexOf('\n', from);
    const isLast = nl < 0;
    if (isLast) nl = doc.length;
    const text = doc.slice(from, nl);
    if (!(isLast && text === '') && matcher(text)) {
      totalMatches += 1;
      if (hits.length < maxResults) {
        hits.push({ line, text: text.length > MAX_HIT_LINE_CHARS ? text.slice(0, MAX_HIT_LINE_CHARS) : text });
      }
    }
    if (isLast) break;
    from = nl + 1;
    line += 1;
  }
  return { status: 'ok', hits, totalMatches, totalLines: countLines(doc) };
}

/** The search_document payload (the ok variant — errors go through formatToolResult). */
export function formatSearchResult(
  result: Extract<SearchResult, { status: 'ok' }>,
  pattern: string,
  regex: boolean,
): string {
  const mode = regex ? 'regex' : 'literal';
  const more = result.totalMatches > result.hits.length
    ? ` — narrow the pattern, or raise maxResults (up to ${MAX_SEARCH_RESULTS})`
    : '';
  const body = result.hits.map((hit) => `${hit.line}: ${hit.text}`).join('\n');
  return `${result.totalMatches} match(es) for ${JSON.stringify(pattern)} (${mode}; ${result.totalLines} lines)${more}\n${body}`;
}

export interface OutlineEntry {
  line: number;
  level: number;
  text: string;
}

/** ATX heading: up to three leading spaces, 1-6 #s, one space, text. */
const ATX_HEADING = /^ {0,3}(#{1,6}) +(.*?)(?: +#*)? *$/;

/**
 * Pure: ATX headings with line numbers, one pass. Setext headings (underlined
 * with =/-) are NOT detected — markdown.ts's DOM-based TOC cannot run here,
 * and ATX is what an editing model emits/recognizes anyway.
 */
export function documentOutline(doc: string): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  let inFence = false;
  let line = 1;
  let from = 0;
  while (from <= doc.length) {
    let nl = doc.indexOf('\n', from);
    const isLast = nl < 0;
    if (isLast) nl = doc.length;
    const text = doc.slice(from, nl);
    if (/^ {0,3}(```|~~~)/.test(text)) inFence = !inFence;
    else if (!inFence) {
      const match = ATX_HEADING.exec(text);
      if (match) entries.push({ line, level: match[1].length, text: match[2].trim() });
    }
    if (isLast) break;
    from = nl + 1;
    line += 1;
  }
  return entries;
}

/** The document_outline payload. */
export function formatOutlineResult(entries: OutlineEntry[], totalLines: number): string {
  const body = entries.map((entry) => `${entry.line}: ${'#'.repeat(entry.level)} ${entry.text}`).join('\n');
  return `${entries.length} heading(s), ${totalLines} lines\n${body}`;
}

/* ---------------- pending-diff card support ---------------- */

export interface DiffSectionView {
  lines: string[];
  hidden: number;
}

/** Splits text into display lines (no phantom trailing empty line). */
export function boundDiffLines(text: string): DiffSectionView {
  if (text === '') return { lines: [], hidden: 0 };
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
  if (lines.length <= MAX_DIFF_LINES_PER_SECTION) return { lines, hidden: 0 };
  return {
    lines: lines.slice(0, MAX_DIFF_LINES_PER_SECTION),
    hidden: lines.length - MAX_DIFF_LINES_PER_SECTION,
  };
}

/** Changed-line count (removed + added) — the auto-apply budget unit. */
export function changedLineCount(removedText: string, addedText: string): number {
  return boundDiffLines(removedText).lines.length + boundDiffLines(addedText).lines.length;
}

/* ---------------- TOOL RESULT payload formatting ---------------- */

/**
 * Pure: one TOOL RESULT payload body (the loop prefixes `TOOL RESULT (tool): `).
 * Errors are data — code first, then message, nearest anchors, and a hint the
 * model can act on (retryable within the step cap).
 */
export function formatToolResult(outcome: ToolOutcome): string {
  switch (outcome.status) {
    case 'ok':
      return outcome.message;
    case 'applied':
      return `APPLIED — ${outcome.message}`;
    case 'pending':
      return `PENDING — ${outcome.message}. The user must Apply or Discard it; do not repeat the call.`;
    case 'refused':
      return `REFUSED (${outcome.code}) — ${outcome.message}. ${outcome.hint}`;
    case 'error': {
      const anchors = outcome.nearestLines && outcome.nearestLines.length > 0
        ? ` Nearest matching lines: ${outcome.nearestLines.join(', ')}.`
        : '';
      return `ERROR ${outcome.code} — ${outcome.message}.${anchors} ${outcome.hint}`;
    }
  }
}
