// Module: features/editor/textareaMirror — the shared mirror-div plumbing for
// the editor's two measurements that need REAL text layout: the line-number
// gutter's per-line heights (lineMeasurer.ts) and the selection toolbar's
// caret/selection point (caretGeometry.ts). A <textarea> exposes no geometry
// for its text, so both hide a div that replicates the textarea's wrapping
// typography and read rects off it (docs/selection-toolbar-research.md §2.1).
// Only the shared base lives here — each measurer owns its own width model
// and read-out, because they answer different questions.

/**
 * Typography and wrapping properties copied from the textarea's computed
 * style onto a mirror — everything that can change line breaking or the
 * physical position of glyphs.
 */
export const MIRROR_STYLE_PROPS = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
  'lineHeight', 'letterSpacing', 'wordSpacing', 'tabSize', 'direction',
] as const;

/**
 * Create the hidden mirror and attach it beside `textarea`: visually hidden,
 * pointer-transparent, aria-hidden, and pre-wrapped like the textarea's UA
 * wrapping rules (everything typographic is synced per measure pass).
 */
export function createHiddenMirror(textarea: HTMLTextAreaElement): HTMLDivElement {
  const mirror = document.createElement('div');
  mirror.setAttribute('aria-hidden', 'true');
  const mirrorStyle = mirror.style;
  mirrorStyle.position = 'absolute';
  mirrorStyle.top = '0';
  mirrorStyle.insetInlineStart = '0';
  mirrorStyle.visibility = 'hidden';
  mirrorStyle.pointerEvents = 'none';
  // The textarea's UA wrapping rules; white-space/overflow-wrap replicate
  // soft wrap, everything typographic is copied per measure pass below.
  mirrorStyle.whiteSpace = 'pre-wrap';
  mirrorStyle.overflowWrap = 'break-word';
  (textarea.parentElement ?? document.body).appendChild(mirror);
  return mirror;
}

/** Copy the wrap-critical typography from `textarea`'s computed style onto a
 *  mirror (call once per measure pass — the first read settles the single
 *  layout flush, the rest are struct reads). */
export function syncMirrorTypography(
  mirror: HTMLDivElement,
  computed: CSSStyleDeclaration,
): void {
  const mirrorStyle = mirror.style;
  for (let i = 0; i < MIRROR_STYLE_PROPS.length; i += 1) {
    const prop = MIRROR_STYLE_PROPS[i];
    mirrorStyle[prop] = computed[prop];
  }
}
