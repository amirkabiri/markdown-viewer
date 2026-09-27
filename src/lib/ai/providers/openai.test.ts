// Unit tests for src/lib/ai/providers/openai.ts — ported from
// legacy/test/ai-providers.test.ts. Node environment; global fetch is faked
// with real Response objects whose bodies are ReadableStreams of hand-built
// SSE text (house style per TESTING.md).

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createOpenAIProvider, extractOpenAIDelta } from './openai';
import type { ChatMessage, ProviderSettings } from '../types';
import { captureError, collectText, sseResponse } from '../../../test/streams';

const OPENAI_SETTINGS: ProviderSettings = {
  provider: 'openai',
  baseUrl: 'https://api.example.com/v1/', // trailing slash on purpose: must be trimmed
  apiKey: 'sk-test-1234567890abcd',
  model: 'gpt-test',
};

const CHAT: ChatMessage[] = [
  { role: 'system', content: 'Be terse.' },
  { role: 'user', content: 'hi' },
];

describe('OpenAI-compatible provider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('streams ordered deltas and terminates cleanly on [DONE]', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => sseResponse([
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo, "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
      'data: [DONE]\n\n',
    ]));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createOpenAIProvider(OPENAI_SETTINGS);
    await expect(collectText(provider.stream(CHAT))).resolves.toBe('Hello, world');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/chat/completions'); // trailing slash trimmed
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer sk-test-1234567890abcd' });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'gpt-test',
      stream: true,
      messages: CHAT, // system message stays inline for OpenAI-like APIs
    });
  });

  it('reassembles data lines split across network chunks', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => sseResponse([
      'data: {"choices":[{"del',
      'ta":{"content":"He"}}]}\n\ndata:',
      ' {"choices":[{"delta":{"content":"y"}}]}\n\n',
      'data: [DONE]\n\n',
    ])));
    const provider = createOpenAIProvider(OPENAI_SETTINGS);
    await expect(collectText(provider.stream(CHAT))).resolves.toBe('Hey');
  });

  it('omits the Authorization header when no token is configured (gateways)', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => sseResponse([
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', 'data: [DONE]\n\n',
    ]));
    vi.stubGlobal('fetch', fetchMock);
    const provider = createOpenAIProvider({ ...OPENAI_SETTINGS, apiKey: '' });
    await expect(collectText(provider.stream(CHAT))).resolves.toBe('ok');
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).not.toHaveProperty('Authorization');
  });

  it('throws an error containing the status, with tokens redacted, on non-200', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => sseResponse(
      ['{"error":{"message":"Incorrect API key provided: sk-live-abcdef1234567890"}}'],
      401,
    )));
    const provider = createOpenAIProvider(OPENAI_SETTINGS);
    const err = await captureError(provider.stream(CHAT));
    expect(err.message).toContain('401');
    expect(err.message).toContain('Incorrect API key provided:');
    expect(err.message).toContain('[redacted]');
    expect(err.message).not.toContain('sk-live-abcdef1234567890');
  });

  it('caps the body snippet in the error message (~200 chars)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => sseResponse(['x'.repeat(5000)], 500)));
    const provider = createOpenAIProvider(OPENAI_SETTINGS);
    const err = await captureError(provider.stream(CHAT));
    expect(err.message).toContain('500');
    expect(err.message.length).toBeLessThan(260);
  });
});

describe('extractOpenAIDelta', () => {
  it('maps payloads to text and swallows noise', () => {
    expect(extractOpenAIDelta('{"choices":[{"delta":{"content":"Hi"}}]}')).toBe('Hi');
    expect(extractOpenAIDelta('{"choices":[{"delta":{"role":"assistant"}}]}')).toBe('');
    expect(extractOpenAIDelta('[DONE]')).toBe('');
    expect(extractOpenAIDelta('not json')).toBe('');
  });
});
