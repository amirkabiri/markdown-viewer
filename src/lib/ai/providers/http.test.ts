// Unit tests for src/lib/ai/providers/http.ts — the token redaction test is
// ported from legacy/test/ai-providers.test.ts; the responseError contract
// (status + redacted + truncated snippet, unreadable-body fallback) was only
// indirectly covered there and is pinned directly here.

import { describe, expect, it } from 'vitest';
import { redactTokens, responseError } from './http';

describe('redactTokens (pure)', () => {
  it('masks sk-like tokens wherever they appear', () => {
    expect(redactTokens('key sk-abc123 here')).toBe('key [redacted] here');
    expect(redactTokens('sk-proj-XyZ_123-456/tail')).toBe('[redacted]/tail');
    expect(redactTokens('no secrets')).toBe('no secrets');
  });
});

describe('responseError', () => {
  it('reports the HTTP status with the body redacted', async () => {
    const res = new Response('{"error":"bad key sk-live-abcdef1234567890"}', { status: 401 });
    const err = await responseError(res);
    expect(err.message).toContain('HTTP status 401');
    expect(err.message).toContain('[redacted]');
    expect(err.message).not.toContain('sk-live-abcdef1234567890');
  });

  it('truncates the snippet after redacting (token cannot be cut back into view)', async () => {
    const body = 'sk-abcdef1234567890'.padEnd(200, 'x');
    const res = new Response(`prefix ${body}${'y'.repeat(5000)}`, { status: 500 });
    const err = await responseError(res);
    expect(err.message.length).toBeLessThan(260); // status text + ~200-char snippet
  });

  it('reports the status alone when the body is unreadable', async () => {
    const res = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('stream blew up'));
      },
    }), { status: 502 });
    const err = await responseError(res);
    expect(err.message).toBe('AI request failed with HTTP status 502: ');
  });
});
