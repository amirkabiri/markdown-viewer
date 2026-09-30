// Module: features/editor/caretGeometry — the selection toolbar's caret
// measurement: the viewport of a <textarea> hides its text geometry, so the
// toolbar needs the pixel point of a text offset to anchor its floating menu
// (docs/selection-toolbar-research.md §2.1, §5). A hidden mirror replicates
// the textarea's border-box (width = clientWidth, padding copied) beside it,
// holds the document up to the offset, and a zero-width marker span reports
// the point via getBoundingClientRect — the same mirror-div TECHNIQUE as the
// gutter's lineMeasurer, answering the different question "where IS offset
// i" (a point) rather than "how tall is line j" (heights), with its own
// width model and lifecycle (selection-driven, not rAF-batched per text
// change). The shared base lives in textareaMirror.ts.
//
// Scroll contract: the mirror renders content from the top, so a measured
// point is content-space; the caller subtracts the textarea's scrollTop to
// place the anchor inside the (static) editor wrapper. Horizontal scrolling
// does not exist (the textarea soft-wraps).
//
// Cost contract: one synchronous measure per toolbar SHOW (after the 200 ms
// selection-settle debounce) — the mirror only ever holds text UP TO the
// offset, never the whole document per event.

import { createHiddenMirror, syncMirrorTypography } from './textareaMirror';

/** The anchor point for the floating menu, in editor-WRAPPER coordinates
 *  (scroll-corrected): position the hidden anchor div at exactly this. */
export interface CaretPoint {
  x: number;
  y: number;
}

/**
 * Selection-point measurement seam. Contract: synchronous, must not mutate
 * the textarea; returns null when no trustworthy point exists (e.g. the
 * textarea is detached). Tests inject scripted fakes instead (house style).
 */
export interface CaretMeasurer {
  /** Wrapper-relative point of text offset `index` (the caret position). */
  measurePoint(textarea: HTMLTextAreaElement, index: number): CaretPoint | null;
  /** Release the mirror node. Optional — fakes are stateless and skip it. */
  dispose?(): void;
}

/**
 * The real measurer: one persistent mirror per textarea, synced per measure
 * pass. The mirror's border-box overlays the textarea's (both start at the
 * wrapper's top-start corner and share clientWidth + physical padding), so
 * marker-rect − wrapper-rect is already the wrapper-relative point modulo
 * vertical scroll, which is subtracted explicitly.
 */
export function createDomCaretMeasurer(textarea: HTMLTextAreaElement): CaretMeasurer {
  const mirror = createHiddenMirror(textarea);
  const mirrorStyle = mirror.style;
  // Same box-sizing as the textarea (the global reset sets border-box) so
  // the copied padding is INSIDE the clientWidth below.
  mirrorStyle.boxSizing = 'border-box';

  return {
    measurePoint(el: HTMLTextAreaElement, index: number): CaretPoint | null {
      const wrapper = el.parentElement;
      if (!wrapper) return null;

      // Sync the wrap-critical box: the textarea's clientWidth (scrollbar
      // excluded) and its physical padding/typography. `direction` arrives
      // via the typography sync, so RTL text measures correctly by
      // construction — the mirror lays glyphs out exactly like the textarea.
      const cs = getComputedStyle(el);
      mirrorStyle.width = `${el.clientWidth}px`;
      mirrorStyle.paddingTop = cs.paddingTop;
      mirrorStyle.paddingLeft = cs.paddingLeft;
      mirrorStyle.paddingRight = cs.paddingRight;
      mirrorStyle.paddingBottom = cs.paddingBottom;
      syncMirrorTypography(mirror, cs);

      // Document up to the offset, then the zero-width marker: its rect is
      // the caret point. The marker carries a zero-width space — an EMPTY
      // inline gets parked at the physical line edge by WebKit regardless
      // of direction, while a zero-width GLYPH participates in the flow and
      // lands where the next glyph would go (correct visual row after a
      // trailing newline, correct side under RTL).
      const marker = document.createElement('span');
      marker.textContent = '\u200B';
      mirror.replaceChildren(document.createTextNode(el.value.slice(0, index)), marker);
      if (!(marker instanceof HTMLElement)) return null;
      const rect = marker.getBoundingClientRect();
      const wrapRect = wrapper.getBoundingClientRect();

      return {
        x: rect.left - wrapRect.left,
        y: rect.top - wrapRect.top - el.scrollTop,
      };
    },

    dispose() {
      mirror.remove();
    },
  };
}
