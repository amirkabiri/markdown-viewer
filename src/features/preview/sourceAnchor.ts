// Module: features/preview/sourceAnchor — the PURE half of the
// preview-selection→AI handoff (no DOM): mapping a selection's rendered block
// units back to source line ranges in the raw markdown.
//
// Why this exists: the render pipeline is marked 12 (frozen — GFM), whose
// parse output carries NO per-node source positions (unlike remark's
// node.position or markdown-it's token.map). What it DOES carry is
// `Lexer.lex()` tokens with `raw` — the exact source slice each block was
// parsed from, in document order. So the strongest anchoring the current
// pipeline supports without swapping the renderer is:
//
//   1. lex the (CRLF-normalized, like renderMarkdown) source and recover each
//      top-level token's [startOffset, endOffset) by sequential scanning
//      (token.raw slices are exact and contiguous, verified empirically);
//   2. pair the preview article's rendered block units with those tokens —
//      order-based, then VERIFIED by comparing the token's expected rendered
//      text (inline markers stripped, whitespace-insensitive) with the unit's
//      text; any disagreement ⇒ null and the caller falls back to the
//      nearest-heading path only;
//   3. the selection's source range is the union of the spans of the block
//      units it starts in and ends in (block-level granularity — a per-
//      character map would need renderer support; see the feature report).
//
// The DOM half (reading units and selection boundaries from the live article)
// lives in selectionExcerpt.tsx; tests here inject plain data.

import { marked } from 'marked';
import type { Token, Tokens } from 'marked';

/* ---------------- types ---------------- */

/** Where a selection lives in the raw markdown (offsets into the
 *  LF-normalized source; lines are 1-based, inclusive). */
export interface SourceRange {
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
}

/** One top-level lexer token with its recovered source span and the text its
 *  rendered block should contain (markers stripped) — the verification key. */
export interface SourceBlockSpan {
  kind: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
  expectedText: string;
  /** True for tokens that render no DOM element (blank lines, link reference
   *  definitions, sanitized-away HTML comments) — alignment skips them. */
  skippable: boolean;
}

/** One rendered top-level block of the preview article, as the DOM adapter
 *  reports it (text with app-injected decoration removed). */
export interface BlockUnit {
  text: string;
  kind: 'text' | 'hr' | 'mermaid';
  /** 1–6 when the unit is a heading, else null. */
  headingLevel: number | null;
}

/* ---------------- inline-marker stripping (verification only) ---------------- */

/**
 * Strips the inline markdown the renderer consumes so a token's source text
 * can be compared with the rendered text: images → alt, links → label,
 * autolinks/html tags → unwrapped, emphasis/code markers removed. Whitespace
 * is normalized away by norm() on both sides, so the comparison is about the
 * characters a reader sees, not their source spelling.
 */
function stripInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/[*_~`]+/g, '');
}

/** Case- and whitespace-insensitive form used only for verification. */
function norm(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase();
}

/** The text a token's rendered block is expected to contain. */
function expectedTokenText(token: Token): string {
  switch (token.type) {
    case 'heading':
    case 'paragraph':
    case 'text':
      return stripInline((token as Tokens.Text).text ?? '');
    case 'code':
      return (token as Tokens.Code).text ?? '';
    case 'space':
    case 'hr':
    case 'def':
      return '';
    case 'blockquote':
      return ((token as Tokens.Blockquote).tokens ?? []).map(expectedTokenText).join(' ');
    case 'list':
      return (token as Tokens.List).items
        .flatMap((item) => (item.tokens ?? []).map(expectedTokenText))
        .join(' ');
    case 'table': {
      const table = token as Tokens.Table;
      const cells = [
        ...table.header.map((cell) => cell.text),
        ...table.rows.flat().map((cell) => cell.text),
      ];
      return cells.map((cell) => stripInline(cell)).join(' ');
    }
    case 'html':
      return stripInline((token.raw ?? '').replace(/<[^>]*>/g, ' '));
    default:
      return stripInline(token.raw ?? '');
  }
}

/** Tokens that produce no element in the sanitized preview DOM. */
function isSkippableToken(token: Token, expectedText: string): boolean {
  if (token.type === 'space' || token.type === 'def') return true;
  // HTML comments (and any other html block DOMPurify empties) render nothing.
  return token.type === 'html' && expectedText.trim() === '';
}

/* ---------------- line index ---------------- */

function computeLineStarts(source: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineOf(lineStarts: number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1; // 1-based
}

/* ---------------- span recovery ---------------- */

/**
 * Pure: recovers every top-level token's source span for the raw markdown.
 * CRLF is normalized exactly like renderMarkdown. Returns null when lexing
 * fails; an empty array for empty input.
 */
export function buildSourceBlockSpans(source: string): SourceBlockSpan[] | null {
  const normalized = source.replace(/\r\n?/g, '\n');
  let tokens: Token[];
  try {
    tokens = marked.lexer(normalized);
  } catch {
    return null;
  }
  const lineStarts = computeLineStarts(normalized);
  let cursor = 0;
  return tokens.map((token) => {
    // token.raw is the exact source slice; scan forward so repeated block
    // text can never rewind the cursor. (A miss keeps the cursor — the span
    // is then untrustworthy, and the unit-text verification below rejects it.)
    const found = normalized.indexOf(token.raw, cursor);
    const start = found < 0 ? cursor : found;
    const end = start + token.raw.length;
    cursor = end;
    // The CONTENT bounds exclude the blank line(s) a block token swallows
    // (marked headings/codes carry their trailing newlines in raw) — the
    // reported range should point at the block's own lines.
    const contentEnd = start + token.raw.replace(/\n+$/, '').length;
    const expectedText = expectedTokenText(token);
    return {
      kind: token.type,
      startOffset: start,
      endOffset: contentEnd,
      startLine: lineOf(lineStarts, start),
      endLine: lineOf(lineStarts, Math.max(start, contentEnd - 1)),
      expectedText,
      skippable: isSkippableToken(token, expectedText),
    };
  });
}

/* ---------------- unit ↔ span alignment ---------------- */

function spanMatchesUnit(span: SourceBlockSpan, unit: BlockUnit): boolean {
  if (span.kind === 'hr') return unit.kind === 'hr';
  if (unit.kind === 'hr') return false;
  // A mermaid shell replaces its pre>code; match it by kind, not by text —
  // the shell's content is re-rendered into an SVG after mount.
  if (unit.kind === 'mermaid') return span.kind === 'code';
  return norm(span.expectedText) === norm(unit.text);
}

/**
 * Pure: order-based pairing of rendered block units to source spans, VERIFIED
 * per unit by text comparison; invisible tokens (blank lines etc.) are
 * skipped. Returns the unit-index → span-index mapping, or null when the two
 * sequences disagree anywhere — callers must treat null as "no anchoring
 * available" and fall back (never guess a source range).
 */
export function alignUnitsToSpans(
  units: BlockUnit[],
  spans: SourceBlockSpan[],
): number[] | null {
  const mapping: number[] = [];
  let j = 0;
  for (let i = 0; i < units.length; i += 1) {
    while (j < spans.length && spans[j].skippable) j += 1;
    if (j >= spans.length || !spanMatchesUnit(spans[j], units[i])) return null;
    mapping.push(j);
    j += 1;
  }
  return mapping;
}

/**
 * Pure: the union source range covered by the units the selection touches
 * ([startUnit..endUnit], inclusive). Null when any touched unit lacks a span
 * — the caller falls back to the heading path.
 */
export function sourceRangeForUnits(
  spans: SourceBlockSpan[],
  alignment: number[],
  startUnit: number,
  endUnit: number,
): SourceRange | null {
  const first = alignment[startUnit];
  const last = alignment[endUnit];
  if (first === undefined || last === undefined) return null;
  const startSpan = spans[first];
  const endSpan = spans[last];
  if (!startSpan || !endSpan) return null;
  return {
    startOffset: startSpan.startOffset,
    endOffset: endSpan.endOffset,
    startLine: startSpan.startLine,
    endLine: endSpan.endLine,
  };
}

/* ---------------- heading path (the fallback anchor) ---------------- */

/**
 * Pure: the nearest-heading path enclosing the selection start — the heading
 * outline accumulated over the units up to and including startUnit. Works
 * with or without source anchoring (it only needs the rendered units).
 */
export function headingPathForUnits(units: BlockUnit[], startUnit: number): string[] {
  const stack: { level: number; text: string }[] = [];
  const last = Math.min(startUnit, units.length - 1);
  for (let i = 0; i <= last; i += 1) {
    const { headingLevel, text: rawText } = units[i];
    const text = rawText.trim();
    if (headingLevel !== null && text !== '') {
      while (stack.length > 0 && stack[stack.length - 1].level >= headingLevel) {
        stack.pop();
      }
      stack.push({ level: headingLevel, text });
    }
  }
  return stack.map((heading) => heading.text);
}
