// Module: features/editor/markdownActions — the PURE formatting engine behind
// the editor's selection toolbar. (text, selStart, selEnd, action) →
// (text, selStart, selEnd), no DOM access, so the whole toggle matrix is
// unit-testable in node and the controller can write the result back through
// its undo-preserving write primitive (one native undo step per action).
//
// Semantics per docs/selection-toolbar-research.md §3.3 (references: GitHub's
// @github/markdown-toolbar-element, EasyMDE's _toggleBlock, CommonMark
// emphasis rules):
//   1. unwrap-in-place   — markers immediately around the selection → remove;
//   2. strip-from-selection — selection fully wrapped in markers → strip;
//   3. wrap              — otherwise insert marker+core+marker, edge
//                          whitespace trimmed out of the wrap; empty
//                          selection inserts an empty pair, caret inside.
// Prefix actions (headings, lists, blockquote) are per-line on the whole-line
// expansion of the selection, and toggle: off when EVERY non-empty selected
// line already carries the prefix, on otherwise.

/** The toolbar's action ids (the RAC Menu keys). */
export type FormatAction =
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'inlineCode'
  | 'link'
  | 'heading2'
  | 'heading3'
  | 'bulletList'
  | 'numberedList'
  | 'taskList'
  | 'blockquote'
  | 'codeBlock';

/** New document text plus where the selection should land afterwards. */
export interface FormatResult {
  text: string;
  selStart: number;
  selEnd: number;
}

const INLINE_MARKERS: Partial<Record<FormatAction, string>> = {
  bold: '**',
  italic: '*',
  strikethrough: '~~',
  inlineCode: '`',
};

/** ATX heading marker of `level` ('## '), list markers, etc. */
const HEADING_RE = /^(\s*)(#{1,6})[ \t]+(.*)$/;
const BULLET_RE = /^(\s*)- /;
const NUMBERED_RE = /^(\s*)\d+[.)] /;
const TASK_RE = /^(\s*)- \[[ xX]\] /;
const QUOTE_RE = /^(\s*)> ?/;
const INDENT_RE = /^\s*/;
const URL_RE = /^https?:\/\//i;

/** Leading indentation of a line ('' when none). */
function indentOf(line: string): string {
  const m = line.match(INDENT_RE);
  return m ? m[0] : '';
}

/** Whole-line expansion bounds of [lo, hi): the first line's start and the
 *  end of the line containing the last covered character. */
function lineBounds(text: string, lo: number, hi: number): [number, number] {
  const start = lo === 0 ? 0 : text.lastIndexOf('\n', lo - 1) + 1;
  const lastCovered = Math.max(hi - 1, lo);
  const nl = text.indexOf('\n', lastCovered);
  const end = nl === -1 ? text.length : nl;
  return [start, end];
}

/** Classic inline toggle (research §3.3 algorithm 1–3). */
function toggleWrap(text: string, lo: number, hi: number, marker: string): FormatResult {
  const n = marker.length;
  // 1. Unwrap-in-place: markers immediately outside the selection.
  if (
    lo >= n &&
    text.slice(lo - n, lo) === marker &&
    text.slice(hi, hi + n) === marker
  ) {
    return {
      text: text.slice(0, lo - n) + text.slice(lo, hi) + text.slice(hi + n),
      selStart: lo - n,
      selEnd: hi - n,
    };
  }
  const selected = text.slice(lo, hi);
  // 2. Strip-from-selection: the selection itself is fully wrapped.
  if (selected.length >= 2 * n && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(n, selected.length - n);
    return {
      text: text.slice(0, lo) + inner + text.slice(hi),
      selStart: lo,
      selEnd: lo + inner.length,
    };
  }
  // 3. Wrap; edge whitespace moves outside the markers (GitHub's trimFirst).
  const lead = indentOf(selected);
  const trail = selected.slice(lead.length).match(/\s*$/)?.[0] ?? '';
  const core = selected.slice(lead.length, selected.length - trail.length);
  if (lo === hi) {
    // Empty selection: an empty pair with the caret parked inside.
    return {
      text: text.slice(0, lo) + marker + marker + text.slice(hi),
      selStart: lo + n,
      selEnd: lo + n,
    };
  }
  const inserted = lead + marker + core + marker + trail;
  return {
    text: text.slice(0, lo) + inserted + text.slice(hi),
    selStart: lo + lead.length + n,
    selEnd: lo + lead.length + n + core.length,
  };
}

/** Remove one `[label](url)` layer around the selection, selecting the label.
 *  Scans back for the '[' and forward for its '](…)' (research §3.3). */
function unwrapLink(text: string, lo: number, hi: number): FormatResult | null {
  const open = text.lastIndexOf('[', lo);
  if (open < 0) return null;
  const close = text.indexOf(']', open);
  if (close <= open) return null;
  if (text.slice(close, close + 2) !== '](') return null;
  const urlEnd = text.indexOf(')', close);
  if (urlEnd < 0) return null;
  // The selection must sit inside the link (the whole link counts too).
  if (lo < open || hi > urlEnd + 1) return null;
  const label = text.slice(open + 1, close);
  return {
    text: text.slice(0, open) + label + text.slice(urlEnd + 1),
    selStart: open,
    selEnd: open + label.length,
  };
}

/** Link is not a toggle: label-first, URL-in-selection, or the empty case. */
function applyLink(text: string, lo: number, hi: number): FormatResult {
  const unwrapped = unwrapLink(text, lo, hi);
  if (unwrapped) return unwrapped;
  const selected = text.slice(lo, hi);
  if (URL_RE.test(selected.trim())) {
    // URL-in-selection → label-first: [](selected-url), cursor on the label.
    return {
      text: `${text.slice(0, lo)}[](${selected})${text.slice(hi)}`,
      selStart: lo + 1,
      selEnd: lo + 1,
    };
  }
  if (selected === '') {
    // Empty selection → [](url) with the placeholder selected.
    return {
      text: `${text.slice(0, lo)}[](url)${text.slice(hi)}`,
      selStart: lo + 2,
      selEnd: lo + 5,
    };
  }
  return {
    text: `${text.slice(0, lo)}[${selected}](url)${text.slice(hi)}`,
    selStart: lo + selected.length + 3,
    selEnd: lo + selected.length + 6,
  };
}

/** Per-line transform shared by every prefix action: `lines` are the whole-
 *  line expansion of the selection, and the result selects the whole range. */
function transformLines(
  text: string,
  lo: number,
  hi: number,
  perLine: (line: string, index: number) => string,
): FormatResult {
  const [start, end] = lineBounds(text, lo, hi);
  const lines = text.slice(start, end).split('\n');
  const next = lines.map(perLine);
  const inserted = next.join('\n');
  return {
    text: text.slice(0, start) + inserted + text.slice(end),
    selStart: start,
    selEnd: start + inserted.length,
  };
}

/** Line is visually empty (blank or whitespace-only) — prefix actions skip it. */
function isBlank(line: string): boolean {
  return line.trim() === '';
}

function applyHeading(
  text: string,
  lo: number,
  hi: number,
  level: 2 | 3,
): FormatResult {
  const marker = `${'#'.repeat(level)} `;
  const exact = new RegExp(`^(\\s*)${'#'.repeat(level)}[ \\t]+`);
  const [start, end] = lineBounds(text, lo, hi);
  const lines = text.slice(start, end).split('\n');
  const body = lines.filter((line) => !isBlank(line));
  // Toggle off only when EVERY non-empty line carries exactly this level;
  // otherwise every line settles on the target level (replace or add).
  const allExact = body.length > 0 && body.every((line) => exact.test(line));
  return transformLines(text, lo, hi, (line) => {
    if (isBlank(line)) return line;
    if (allExact) return line.replace(exact, '$1');
    const atx = line.match(HEADING_RE);
    const indent = indentOf(line);
    if (atx) return `${indent}${marker}${atx[3]}`;
    return `${indent}${marker}${line.slice(indent.length)}`;
  });
}

/** Shared per-line list/prefix toggle: off when every non-empty line matches
 *  `mark` (one level stripped), otherwise `add` prefixes each non-empty line
 *  (`ordinal` = 0-based index among the non-empty lines, for renumbering). */
function togglePrefix(
  text: string,
  lo: number,
  hi: number,
  mark: RegExp,
  add: (line: string, ordinal: number) => string,
): FormatResult {
  const [start, end] = lineBounds(text, lo, hi);
  const lines = text.slice(start, end).split('\n');
  const body = lines.filter((line) => !isBlank(line));
  const allMarked = body.length > 0 && body.every((line) => mark.test(line));
  let ordinal = 0;
  return transformLines(text, lo, hi, (line) => {
    if (isBlank(line)) return line;
    if (allMarked) return line.replace(mark, '$1');
    const next = ordinal;
    ordinal += 1;
    return add(line, next);
  });
}

/** Code block / multi-line inline code: fence the whole-line expansion with
 *  blank-line padding (GitHub's surroundWithNewlines); a selected fenced
 *  block toggles the fences back off (padding is left as-is). */
function toggleCodeBlock(text: string, lo: number, hi: number): FormatResult {
  const [start, end] = lineBounds(text, lo, hi);
  const content = text.slice(start, end);
  if (content.startsWith('```\n') && content.endsWith('\n```')) {
    const inner = content.slice(4, content.length - 4);
    return {
      text: text.slice(0, start) + inner + text.slice(end),
      selStart: start,
      selEnd: start + inner.length,
    };
  }
  // Ensure exactly one blank line before/after (already-blank edges stay).
  let pre = '';
  if (start > 0) {
    if (text[start - 1] !== '\n') pre = '\n\n';
    else if (start >= 2 && text[start - 2] !== '\n') pre = '\n';
  }
  let post = '';
  if (end < text.length) {
    if (text[end] !== '\n') post = '\n\n';
    else if (end + 1 < text.length && text[end + 1] !== '\n') post = '\n';
  }
  const inserted = `${pre}\`\`\`\n${content}\n\`\`\`${post}`;
  // Select the whole block (fences included) so a second press toggles off.
  return {
    text: text.slice(0, start) + inserted + text.slice(end),
    selStart: start + pre.length,
    selEnd: start + inserted.length,
  };
}

/**
 * Apply a formatting action to `text` over the selection [selStart, selEnd)
 * and return the new text plus where the selection should land (so repeated
 * actions toggle, and typing continues naturally).
 */
export function applyAction(
  text: string,
  selStart: number,
  selEnd: number,
  action: FormatAction,
): FormatResult {
  const lo = Math.min(selStart, selEnd);
  const hi = Math.max(selStart, selEnd);

  const inlineMarker = INLINE_MARKERS[action];
  if (inlineMarker) {
    // Inline code on a multi-line selection becomes a fenced block instead.
    if (action === 'inlineCode' && text.slice(lo, hi).includes('\n')) {
      return toggleCodeBlock(text, lo, hi);
    }
    return toggleWrap(text, lo, hi, inlineMarker);
  }
  switch (action) {
    case 'link':
      return applyLink(text, lo, hi);
    case 'heading2':
      return applyHeading(text, lo, hi, 2);
    case 'heading3':
      return applyHeading(text, lo, hi, 3);
    case 'bulletList':
      return togglePrefix(text, lo, hi, BULLET_RE, (line) => `${indentOf(line)}- ${line.slice(indentOf(line).length)}`);
    case 'numberedList':
      return togglePrefix(text, lo, hi, NUMBERED_RE, (line, index) => `${indentOf(line)}${index + 1}. ${line.slice(indentOf(line).length)}`);
    case 'taskList':
      // An existing bullet becomes the task marker instead of stacking.
      return togglePrefix(text, lo, hi, TASK_RE, (line) => {
        const bullet = line.replace(BULLET_RE, '$1');
        const indent = indentOf(bullet);
        return `${indent}- [ ] ${bullet.slice(indent.length)}`;
      });
    case 'blockquote':
      return togglePrefix(text, lo, hi, QUOTE_RE, (line) => `${indentOf(line)}> ${line.slice(indentOf(line).length)}`);
    case 'codeBlock':
      return toggleCodeBlock(text, lo, hi);
    default:
      return { text, selStart: lo, selEnd: hi };
  }
}
