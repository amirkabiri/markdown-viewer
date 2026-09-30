// Module: features/preview/selectionExcerpt — the DOM half of the
// preview-selection→AI handoff: reads a live jsdom/browser Range inside the
// rendered article and maps it to { excerpt, sourceRange, headingPath } via
// the pure sourceAnchor module. No React, no state — Preview calls this from
// its selection/activation handlers.
//
// Design notes:
//   - Excerpts join BLOCK boundaries with \n by walking the range's cloned
//     fragment's top-level children (a Range's plain toString() concatenates
//     text nodes with no separation, which mangles multi-block selections).
//   - Selection boundaries are mapped to top-level article children (the
//     "block units") by climbing the ancestor chain; boundaries on the
//     article element itself (e.g. select-all) index its children directly.
//   - App-injected decoration (.heading-anchor '#', .copy-btn labels) is
//     stripped from unit text so source-anchor verification stays exact.

import {
  alignUnitsToSpans,
  buildSourceBlockSpans,
  headingPathForUnits,
  sourceRangeForUnits,
  type BlockUnit,
} from './sourceAnchor';
import type { PreviewExcerptPayload } from '../ai';

/** Block elements whose textContent starts a new excerpt line. */
const DECORATION_SEL = '.heading-anchor, .copy-btn';

/** Text of one rendered block with app-injected decoration removed. */
function blockText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll(DECORATION_SEL).forEach((decoration) => decoration.remove());
  return clone.textContent ?? '';
}

/** The article's top-level rendered blocks, as the pure mapper sees them. */
export function readBlockUnits(article: HTMLElement): BlockUnit[] {
  return [...article.children].map((el) => {
    let kind: BlockUnit['kind'] = 'text';
    if (el.tagName === 'HR') kind = 'hr';
    else if (el.classList.contains('mermaid-block')) kind = 'mermaid';
    return {
      text: blockText(el),
      kind,
      headingLevel: /^H[1-6]$/.test(el.tagName) ? Number(el.tagName[1]) : null,
    };
  });
}

/** The range's visible text: per-block trimmed, blocks joined with \n.
 *  App-injected decoration (heading '#' anchors, copy buttons) never counts
 *  as excerpt content — it is not the user's text. Exported for the
 *  affordance's cheap has-text check on every selectionchange (the full
 *  source-anchored mapping only runs on activation). */
export function rangeExcerptText(range: Range): string {
  const fragment = range.cloneContents();
  const parts: string[] = [];
  fragment.childNodes.forEach((node) => {
    let text: string;
    if (node instanceof Element) {
      const clone = node.cloneNode(true) as Element;
      // The fragment child may BE the decoration (not just contain it).
      if (clone.matches(DECORATION_SEL)) {
        text = '';
      } else {
        clone.querySelectorAll(DECORATION_SEL).forEach((decoration) => decoration.remove());
        text = (clone.textContent ?? '').trim();
      }
    } else {
      text = (node.textContent ?? '').trim();
    }
    if (text !== '') parts.push(text);
  });
  return parts.join('\n');
}

/** Number of element children before a child-NODE index (article boundaries
 *  are reported in child-node coordinates, which include the whitespace text
 *  nodes the render HTML carries between blocks). */
function elementsBefore(article: HTMLElement, childIndex: number): number {
  const { childNodes } = article;
  let count = 0;
  const stop = Math.min(childIndex, childNodes.length);
  for (let i = 0; i < stop; i += 1) {
    if (childNodes[i] instanceof Element) count += 1;
  }
  return count;
}

/** Index of the article child a selection boundary lives in (null: outside). */
function boundaryUnitIndex(
  article: HTMLElement,
  node: Node,
  offset: number,
  isEnd: boolean,
): number | null {
  const unitCount = article.children.length;
  if (unitCount === 0) return null;
  if (node === article) {
    // The boundary indexes the article's child NODES; translate to units.
    if (isEnd) {
      return Math.min(Math.max(elementsBefore(article, offset) - 1, 0), unitCount - 1);
    }
    return Math.min(elementsBefore(article, offset), unitCount - 1);
  }
  let current: Node | null = node;
  while (current && current.parentNode !== article) {
    current = current.parentNode;
  }
  if (!current) return null;
  const index = [...article.children].indexOf(current as Element);
  return index >= 0 ? index : null;
}

/**
 * Reads the user's preview selection: excerpt text, source anchoring (when
 * `source` corresponds to the rendered article) and the nearest-heading path.
 * Returns null when the selection carries no text (collapsed/whitespace) —
 * the caller suppresses the affordance.
 */
export function readPreviewSelection(
  article: HTMLElement,
  range: Range,
  source: string,
): PreviewExcerptPayload | null {
  const excerpt = rangeExcerptText(range);
  if (excerpt.trim() === '') return null;

  const units = readBlockUnits(article);
  const startUnit = boundaryUnitIndex(article, range.startContainer, range.startOffset, false);
  const endUnit = boundaryUnitIndex(article, range.endContainer, range.endOffset, true);

  let sourceRange: PreviewExcerptPayload['sourceRange'] = null;
  if (startUnit !== null && endUnit !== null && source !== '') {
    const spans = buildSourceBlockSpans(source);
    if (spans) {
      const alignment = alignUnitsToSpans(units, spans);
      if (alignment) {
        sourceRange = sourceRangeForUnits(
          spans,
          alignment,
          Math.min(startUnit, endUnit),
          Math.max(startUnit, endUnit),
        );
      }
    }
  }

  return {
    excerpt,
    sourceRange,
    headingPath: startUnit !== null ? headingPathForUnits(units, startUnit) : [],
  };
}
