// Module: ai/providers/sse — Server-Sent-Events helpers shared by the
// fetch-based providers. parseSSEData is a pure, unit-testable core; the
// streaming wrapper only adds network-chunk line buffering.

/**
 * Pure SSE parser: given a text block of complete lines, returns the payload
 * strings of all `data:` lines in order. A single leading space after
 * `data:` is stripped (per the SSE spec); `event:`/`id:`/`:comment` lines and
 * blank lines are ignored. The `[DONE]` sentinel is returned as-is so callers
 * decide how to treat it. Pure: no state, no mutation of the input.
 */
export function parseSSEData(block: string): string[] {
  const payloads: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    let payload = line.slice('data:'.length);
    if (payload.startsWith(' ')) payload = payload.slice(1);
    payloads.push(payload);
  }
  return payloads;
}

type DeltaExtractor = (payload: string) => string;

/**
 * Reads an SSE response body and yields the deltas the extractor pulls out of
 * each complete `data:` payload. Handles the case where a line is split
 * across network chunks by buffering everything after the last newline
 * (parseSSEData itself only ever sees complete lines).
 */
export async function* streamSSEDeltas(
  res: Response,
  extract: DeltaExtractor,
  opts?: { signal?: AbortSignal },
): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      if (opts?.signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const cut = buffer.lastIndexOf('\n');
      if (cut === -1) continue;
      const block = buffer.slice(0, cut + 1);
      buffer = buffer.slice(cut + 1);
      for (const payload of parseSSEData(block)) {
        const text = extract(payload);
        if (text) yield text;
      }
    }
    buffer += decoder.decode(); // flush any pending partial multi-byte sequence
    for (const payload of parseSSEData(buffer)) {
      const text = extract(payload);
      if (text) yield text;
    }
  } finally {
    reader.releaseLock();
  }
}
