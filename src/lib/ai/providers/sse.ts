// Module: ai/providers/sse — Server-Sent-Events helpers shared by the
// fetch-based providers. parseSSEData is a pure, unit-testable core; the
// streaming wrapper only adds network-chunk line buffering. Legacy twin:
// legacy/src/ai/providers/sse.ts.

/**
 * Pure SSE parser: given a text block of complete lines, returns the payload
 * strings of all `data:` lines in order. A single leading space after
 * `data:` is stripped (per the SSE spec); `event:`/`id:`/`:comment` lines and
 * blank lines are ignored. The `[DONE]` sentinel is returned as-is so callers
 * decide how to treat it. Pure: no state, no mutation of the input.
 */
export function parseSSEData(block: string): string[] {
  return block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => {
      let payload = line.slice('data:'.length);
      if (payload.startsWith(' ')) payload = payload.slice(1);
      return payload;
    });
}

type DeltaExtractor = (payload: string) => string;

/** Yields the non-empty deltas the extractor pulls out of each payload. */
async function* yieldDeltas(payloads: string[], extract: DeltaExtractor): AsyncGenerator<string> {
  let i = 0;
  while (i < payloads.length) {
    const text = extract(payloads[i]);
    if (text) yield text;
    i += 1;
  }
}

/**
 * Reads an SSE response body and yields the deltas the extractor pulls out of
 * each complete `data:` payload. Handles the case where a line is split
 * across network chunks by buffering everything after the last newline
 * (parseSSEData itself only ever sees complete lines). Callers already
 * reject empty bodies, so the missing-body guard only ever fires on misuse.
 */
export async function* streamSSEDeltas(
  res: Response,
  extract: DeltaExtractor,
  opts?: { signal?: AbortSignal },
): AsyncGenerator<string> {
  if (!res.body) throw new Error('AI request failed: empty response body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      if (opts?.signal?.aborted) return;
      // eslint-disable-next-line no-await-in-loop -- sequential stream consumption
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const cut = buffer.lastIndexOf('\n');
      if (cut !== -1) {
        const block = buffer.slice(0, cut + 1);
        buffer = buffer.slice(cut + 1);
        yield* yieldDeltas(parseSSEData(block), extract);
      }
    }
    buffer += decoder.decode(); // flush any pending partial multi-byte sequence
    yield* yieldDeltas(parseSSEData(buffer), extract);
  } finally {
    reader.releaseLock();
  }
}
