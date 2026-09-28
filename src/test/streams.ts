// Shared streaming test helpers (house style: hand-rolled fakes at module
// boundaries — see TESTING.md). sseResponse builds REAL Response objects
// whose bodies stream hand-built SSE text; collectAll drains async iterables.

/** Builds a Response whose body streams the given text parts as chunks. */
export function sseResponse(parts: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      parts.forEach((part) => controller.enqueue(encoder.encode(part)));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
}

/** Drains an async iterable (a stream boundary is inherently sequential). */
export async function collectAll<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  const iterator = iter[Symbol.asyncIterator]();
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- consuming a stream is sequential by nature
    const { done, value } = await iterator.next();
    if (done === true) break;
    out.push(value);
  }
  return out;
}

/** Collects a text-delta stream into the full text. */
export async function collectText(iter: AsyncIterable<string>): Promise<string> {
  return (await collectAll(iter)).join('');
}

/** Returns the error a stream throws, or fails the test when it resolves. */
export async function captureError(iter: AsyncIterable<unknown>): Promise<Error> {
  try {
    await collectAll(iter);
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected the stream to throw');
}
