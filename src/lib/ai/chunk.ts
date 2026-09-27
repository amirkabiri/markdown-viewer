// Module: ai/chunk — pure streaming text helpers. No imports, no DOM.
// Legacy twin: legacy/src/ai/chunk.ts. Single-helper module → default export
// (STYLEGUIDE "Exports", per import-x/prefer-default-export).

/**
 * Guard against promptStreaming() builds that emit cumulative text instead of
 * deltas. Pure: given the previous chunk and the new chunk, returns only the
 * text that should be appended.
 */
export default function normalizeStreamChunk(prev: unknown, chunk: string): string {
  if (typeof prev === 'string' && prev.length > 0
    && typeof chunk === 'string' && chunk.startsWith(prev)) {
    return chunk.slice(prev.length);
  }
  return chunk;
}
