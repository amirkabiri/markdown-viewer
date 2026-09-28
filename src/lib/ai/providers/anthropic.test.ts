// Unit tests for src/lib/ai/providers/anthropic.ts — ported from
// legacy/test/ai-providers.test.ts. Node environment; global fetch is faked
// with real Response objects streaming hand-built SSE text (house style per
// TESTING.md).

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createAnthropicProvider, extractAnthropicDelta } from './anthropic';
import type { ChatMessage, ProviderSettings } from '../types';
import { captureError, collectText, sseResponse } from '../../../test/streams';

const ANTHROPIC_SETTINGS: ProviderSettings = {
  provider: 'anthropic',
  baseUrl: 'https://api.example.com',
  apiKey: 'sk-ant-test-1234567890',
  model: 'claude-test',
};

const CHAT: ChatMessage[] = [
  { role: 'system', content: 'Be terse.' },
  { role: 'user', content: 'hi' },
];

describe('Anthropic-compatible provider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('extracts content_block_delta texts and sends system as a top-level field', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => sseResponse([
      'event: message_start\ndata: {"type":"message_start"}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"سلام "}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"دنیا"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createAnthropicProvider(ANTHROPIC_SETTINGS);
    await expect(collectText(provider.stream(CHAT))).resolves.toBe('سلام دنیا');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/messages');
    expect(init?.headers).toMatchObject({
      'x-api-key': 'sk-ant-test-1234567890',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ model: 'claude-test', stream: true });
    expect(body.system).toBe('Be terse.'); // top-level string, never a message
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(typeof body.max_tokens).toBe('number'); // Anthropic requires the field
  });

  it('throws an error containing the status, with tokens redacted, on non-200', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => sseResponse(
      ['{"type":"error","error":{"message":"invalid x-api-key sk-ant-admin-9876543210"}}'],
      403,
    )));
    const provider = createAnthropicProvider(ANTHROPIC_SETTINGS);
    const err = await captureError(provider.stream(CHAT));
    expect(err.message).toContain('403');
    expect(err.message).toContain('[redacted]');
    expect(err.message).not.toContain('sk-ant-admin-9876543210');
  });
});

describe('extractAnthropicDelta', () => {
  it('keeps only content_block_delta text', () => {
    expect(extractAnthropicDelta('{"type":"content_block_delta","delta":{"type":"text_delta","text":"m"}}')).toBe('m');
    expect(extractAnthropicDelta('{"type":"message_start"}')).toBe('');
    expect(extractAnthropicDelta('{"type":"content_block_delta","delta":{"type":"input_json_delta"}}')).toBe('');
    expect(extractAnthropicDelta('garbage')).toBe('');
  });
});
