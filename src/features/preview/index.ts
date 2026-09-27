// Feature entry — import the preview feature through this barrel from other
// features (STYLEGUIDE.md: no deep imports across feature boundaries).
export { default as Preview, previewDirFor } from './Preview';
export type { PreviewProps } from './Preview';
export { RENDER_DEBOUNCE_MS, useMarkdownPreview } from './useMarkdownPreview';
export type { MarkdownPreviewState } from './useMarkdownPreview';
export { currentHeadingIndex, SPY_THRESHOLD_PX } from './scrollSpy';
