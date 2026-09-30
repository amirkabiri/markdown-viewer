// Module: features/ai/previewExcerpt — the handoff contract between the
// PREVIEW pane (which reads the user's text selection) and the AI panel
// (which consumes it as composer context). The panel's props are frozen at
// { editor, t, lang }, so the payload travels through this module-level
// queue instead — the same pattern as toast-queue.ts (one shared instance,
// published from anywhere, bridged by whoever renders the panel).
//
// Lifecycle: Preview publishes when the user activates the "Ask AI about
// this" affordance; the App's subscription mounts/opens the panel, and the
// panel's subscription adopts the payload into its composer chip and
// consumes it. Whoever adopts last is the one that renders it — publishing
// is idempotent from the sender's point of view.

/** The selected excerpt plus everything the model needs to anchor it. */
export interface PreviewExcerptPayload {
  /** The selected rendered text (multi-block, block boundaries as \n). */
  excerpt: string;
  /** Source anchoring: the 1-based inclusive line range in the raw markdown,
   *  when the pipeline mapping succeeded (null → heading path only). */
  sourceRange: { startLine: number; endLine: number } | null;
  /** The heading outline enclosing the selection start (fallback anchor). */
  headingPath: string[];
}

type Listener = (payload: PreviewExcerptPayload) => void;

let current: PreviewExcerptPayload | null = null;
const listeners = new Set<Listener>();

/**
 * The latest preview-selection excerpt, waiting for the AI panel. `current`
 * survives until a consumer adopts it (consume()), so the panel can pick it
 * up on mount even when it was published before the panel existed.
 */
export const previewExcerptQueue = {
  /** Publishes a new excerpt (replaces any waiting one) and notifies listeners. */
  publish(payload: PreviewExcerptPayload): void {
    current = payload;
    for (const listener of listeners) listener(payload);
  },
  /** Clears the waiting payload (the panel calls this once it has adopted it). */
  consume(): void {
    current = null;
  },
  /** The payload waiting for adoption, if any. */
  get current(): PreviewExcerptPayload | null {
    return current;
  },
  /** Subscribes to publications; returns the unsubscribe function. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
