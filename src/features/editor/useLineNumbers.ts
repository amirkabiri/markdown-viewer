// Module: features/editor/useLineNumbers — React wiring for the editor's
// line-number gutter. Derives logical lines from the controller's text
// mirror (never from extra per-keystroke DOM value reads), measures wrapped
// row heights through the injected measurer, tracks the textarea's
// scrollTop for the lockstep transform and its clientHeight via
// ResizeObserver for the visible window.
//
// Cost contract: at most ONE measurement pass per animation frame, batched
// from three triggers (text change, width change, font settle) — no
// geometry work on the render path, and scroll handling is a rAF-batched
// state update that re-renders only the ~dozen visible numbers.

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { createDomLineMeasurer } from './lineMeasurer';
import type { LineMeasurer } from './lineMeasurer';
import { lineTopOffsets, splitLines } from './lineNumbers';

export interface UseLineNumbersOptions {
  /** The editor textarea — the scroll container and the wrap oracle. */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** The controller's text mirror; line metrics derive from it. */
  text: string;
  /** Measurement seam — tests inject a scripted fake. */
  createMeasurer?: (textarea: HTMLTextAreaElement) => LineMeasurer;
}

export interface LineNumbersState {
  /** Y offset (px, content space — the textarea's top padding included) of
   *  each logical line's first visual row. */
  tops: number[];
  /** Number of logical lines (the gutter's digit width derives from it). */
  lineCount: number;
  /** Rendered px height of one text row (0 while unknown). */
  lineHeight: number;
  /** The textarea's visible height (0 when unavailable — no RO in jsdom). */
  viewportHeight: number;
  /** The textarea's current scrollTop, rAF-batched per scroll event. */
  scrollTop: number;
}

/** Module-level so the default doesn't re-create the measurer every render. */
const defaultCreateMeasurer = createDomLineMeasurer;

export function useLineNumbers({
  textareaRef, text, createMeasurer = defaultCreateMeasurer,
}: UseLineNumbersOptions): LineNumbersState {
  const [tops, setTops] = useState<number[]>([0]);
  const [lineCount, setLineCount] = useState(1);
  const [lineHeight, setLineHeight] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  const measurerRef = useRef<LineMeasurer | null>(null);
  // The latest measure closure, so the ResizeObserver and font-settle
  // triggers (which live for the textarea's lifetime) always re-measure the
  // newest text without being re-created themselves.
  const measureRef = useRef<(() => void) | null>(null);
  // The scroll-state reconciler (defined in the listener effect below), so
  // the measure pass can re-sync after a text change — see the comment there.
  const reconcileScrollRef = useRef<(() => void) | null>(null);

  // Measurer + scroll/resize listeners: mounted once per textarea identity.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return undefined;
    const measurer = createMeasurer(el);
    measurerRef.current = measurer;

    let resizeRaf = 0;
    const ro = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
        if (resizeRaf) return;
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = 0;
          setViewportHeight(el.clientHeight);
          measureRef.current?.();
        });
      });
    ro?.observe(el);

    // Reading scrollHeight settles layout before scrollTop is read: an
    // engine may report a scrollTop of content that is no longer there (see
    // reconcileScrollRef below).
    const reconcileScroll = () => {
      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      setScrollTop(Math.min(el.scrollTop, maxScroll));
    };
    reconcileScrollRef.current = reconcileScroll;

    let scrollRaf = 0;
    const onScroll = () => {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        reconcileScroll();
      });
    };
    el.addEventListener('scroll', onScroll);

    // Web fonts settling after first paint change row heights; RO cannot
    // see that (width is unchanged), so re-measure once when fonts finish.
    document.fonts?.ready.then(() => measureRef.current?.()).catch(() => {});

    return () => {
      ro?.disconnect();
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      el.removeEventListener('scroll', onScroll);
      measurerRef.current = null;
      reconcileScrollRef.current = null;
      measurer.dispose?.();
    };
  }, [textareaRef, createMeasurer]);

  // One rAF-batched measure per committed text change: a burst of edits in
  // a single frame cancels the previous frame's pending measure, so typing
  // a 5,000-line document measures once per frame, on the final text.
  useEffect(() => {
    const measure = () => {
      const el = textareaRef.current;
      const measurer = measurerRef.current;
      if (!el || !measurer) return;
      const cs = getComputedStyle(el);
      const rowHeight = parseFloat(cs.lineHeight); // NaN under line-height: normal
      const lines = splitLines(text);
      setLineCount(lines.length);
      setLineHeight(Number.isFinite(rowHeight) ? rowHeight : 0);
      setTops(lineTopOffsets(measurer.measureHeights(lines), parseFloat(cs.paddingTop) || 0));
      // A text change can shrink (or grow) the scrollable range without the
      // engine emitting a further scroll event — e.g. Firefox delivers the
      // scroll of the OLD document before the input that replaces it, then
      // clamps scrollTop silently. Reconcile so the visible window can never
      // point past the last line.
      reconcileScrollRef.current?.();
    };
    measureRef.current = measure;

    const raf = requestAnimationFrame(measure);
    return () => {
      cancelAnimationFrame(raf);
      measureRef.current = null;
    };
  }, [text, textareaRef]);

  return {
    tops, lineCount, lineHeight, viewportHeight, scrollTop,
  };
}
