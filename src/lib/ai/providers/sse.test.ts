// Unit tests for src/lib/ai/providers/sse.ts — the pure parseSSEData core
// (tests ported from legacy/test/ai-providers.test.ts, both the OpenAI- and
// Anthropic-shaped describes) plus streamSSEDeltas behavior legacy left
// untested (trailing-line flush and abort).

import { describe, expect, it } from 'vitest';
import { parseSSEData, streamSSEDeltas } from './sse';
import { collectAll, sseResponse } from '../../../test/streams';

describe('parseSSEData (pure, OpenAI shape)', () => {
  it('extracts ordered payloads from data: lines and keeps [DONE]', () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    expect(parseSSEData(sse)).toEqual([
      '{"choices":[{"delta":{"content":"Hel"}}]}',
      '{"choices":[{"delta":{"content":"lo"}}]}',
      '[DONE]',
    ]);
  });

  it('accepts data: without a space, CRLF endings, and ignores non-data lines', () => {
    expect(parseSSEData('data:x\r\ndata: y\r\n')).toEqual(['x', 'y']);
    expect(parseSSEData('event: message_start\ndata: {"a":1}\n: keep-alive\nid: 7\n\n')).toEqual(['{"a":1}']);
    expect(parseSSEData('')).toEqual([]);
  });
});

describe('parseSSEData (pure, Anthropic shape)', () => {
  it('returns the data: payloads in order, ignoring event:/comment lines', () => {
    const sse = [
      'event: content_block_delta\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"a"}}\n\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"b"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ].join('');
    const payloads = parseSSEData(sse);
    expect(payloads).toHaveLength(3);
    expect(payloads[0]).toContain('"text":"a"');
    expect(payloads[1]).toContain('"text":"b"');
  });
});

describe('streamSSEDeltas', () => {
  it('flushes a trailing data line that has no newline', async () => {
    const res = sseResponse(['data: {"x":1}']); // no trailing newline at all
    await expect(collectAll(streamSSEDeltas(res, (p) => p))).resolves.toEqual(['{"x":1}']);
  });

  it('skips empty extractions and keeps deltas in order', async () => {
    const res = sseResponse([
      'event: ping\n\n',
      'data: one\n\n',
      'data: \n\n', // empty payload → extraction yields nothing
      'data: two\n\n',
    ]);
    await expect(collectAll(streamSSEDeltas(res, (p) => p))).resolves.toEqual(['one', 'two']);
  });

  it('yields nothing once the signal is already aborted', async () => {
    const res = sseResponse(['data: one\n\ndata: two\n\n']);
    const controller = new AbortController();
    controller.abort();
    await expect(collectAll(streamSSEDeltas(res, (p) => p, { signal: controller.signal })))
      .resolves.toEqual([]);
  });
});
