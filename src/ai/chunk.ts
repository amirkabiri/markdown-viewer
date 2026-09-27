// Module: ai/chunk — pure streaming text helpers. No imports, no DOM.

/**
 * Guard against promptStreaming() builds that emit cumulative text instead of
 * deltas. Pure: given the previous chunk and the new chunk, returns only the
 * text that should be appended. Frozen public export (re-exported by
 * src/ai/index.ts and src/ai.ts).
 */
export function normalizeStreamChunk(prev: unknown, chunk: string): string {
  if (typeof prev === 'string' && prev.length > 0 &&
      typeof chunk === 'string' && chunk.startsWith(prev)) {
    return chunk.slice(prev.length);
  }
  return chunk;
}
