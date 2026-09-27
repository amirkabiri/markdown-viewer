// Unit tests for the AI provider layer: src/ai/providers/{openai,anthropic}.ts
// and src/ai/settings.ts. Node environment — global fetch is stubbed with
// Response objects whose bodies are ReadableStreams of hand-built SSE text.
// The settings module pulls in src/state.ts, which touches browser globals at
// module-eval time; stub only what Node lacks, then import dynamically
// (same pattern as test/ai-chunk.test.ts).

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { parseSSEData, extractOpenAIDelta, createOpenAIProvider } from '../src/ai/providers/openai.js';
import { parseSSEData as parseAnthropicSSEData, extractAnthropicDelta, createAnthropicProvider } from '../src/ai/providers/anthropic.js';
import { redactTokens } from '../src/ai/providers/http.js';
import type { ChatMessage, ProviderSettings } from '../src/ai/types.js';

function stubIfAbsent(name: string, value: unknown): void {
  if (name in globalThis) return;
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
stubIfAbsent('matchMedia', () => ({ matches: false }));
stubIfAbsent('localStorage', makeStorage());

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  } as Storage;
}

const { loadSettings, saveSettings, normalizeSettings, isExternalReady, DEFAULT_SETTINGS } =
  await import('../src/ai/settings.js');

/* ---------------- helpers ---------------- */

/** Builds a Response whose body streams the given text parts as chunks. */
function sseResponse(parts: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
}

async function collect(iter: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const delta of iter) out += delta;
  return out;
}

async function captureError(iter: AsyncIterable<string>): Promise<Error> {
  try {
    await collect(iter);
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected the stream to throw');
}

const OPENAI_SETTINGS: ProviderSettings = {
  provider: 'openai',
  baseUrl: 'https://api.example.com/v1/', // trailing slash on purpose: must be trimmed
  apiKey: 'sk-test-1234567890abcd',
  model: 'gpt-test',
};

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

/* ---------------- OpenAI-compatible provider ---------------- */

describe('OpenAI-compatible provider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('streams ordered deltas and terminates cleanly on [DONE]', async () => {
    const fetchMock = vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo, "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
      'data: [DONE]\n\n',
    ]));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createOpenAIProvider(OPENAI_SETTINGS);
    await expect(collect(provider.stream(CHAT))).resolves.toBe('Hello, world');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/chat/completions'); // trailing slash trimmed
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sk-test-1234567890abcd' });
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'gpt-test',
      stream: true,
      messages: CHAT, // system message stays inline for OpenAI-like APIs
    });
  });

  it('reassembles data lines split across network chunks', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'data: {"choices":[{"del',
      'ta":{"content":"He"}}]}\n\ndata:',
      ' {"choices":[{"delta":{"content":"y"}}]}\n\n',
      'data: [DONE]\n\n',
    ])));
    const provider = createOpenAIProvider(OPENAI_SETTINGS);
    await expect(collect(provider.stream(CHAT))).resolves.toBe('Hey');
  });

  it('omits the Authorization header when no token is configured (gateways)', async () => {
    const fetchMock = vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', 'data: [DONE]\n\n',
    ]));
    vi.stubGlobal('fetch', fetchMock);
    const provider = createOpenAIProvider({ ...OPENAI_SETTINGS, apiKey: '' });
    await expect(collect(provider.stream(CHAT))).resolves.toBe('ok');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('throws an error containing the status, with tokens redacted, on non-200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(
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
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(['x'.repeat(5000)], 500)));
    const provider = createOpenAIProvider(OPENAI_SETTINGS);
    const err = await captureError(provider.stream(CHAT));
    expect(err.message).toContain('500');
    expect(err.message.length).toBeLessThan(260);
  });
});

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

  it('extractOpenAIDelta maps payloads to text and swallows noise', () => {
    expect(extractOpenAIDelta('{"choices":[{"delta":{"content":"Hi"}}]}')).toBe('Hi');
    expect(extractOpenAIDelta('{"choices":[{"delta":{"role":"assistant"}}]}')).toBe('');
    expect(extractOpenAIDelta('[DONE]')).toBe('');
    expect(extractOpenAIDelta('not json')).toBe('');
  });
});

/* ---------------- Anthropic-compatible provider ---------------- */

describe('Anthropic-compatible provider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('extracts content_block_delta texts and sends system as a top-level field', async () => {
    const fetchMock = vi.fn(async () => sseResponse([
      'event: message_start\ndata: {"type":"message_start"}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"سلام "}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"دنیا"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createAnthropicProvider(ANTHROPIC_SETTINGS);
    await expect(collect(provider.stream(CHAT))).resolves.toBe('سلام دنیا');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/messages');
    expect(init.headers).toMatchObject({
      'x-api-key': 'sk-ant-test-1234567890',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    });
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ model: 'claude-test', stream: true });
    expect(body.system).toBe('Be terse.'); // top-level string, never a message
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(typeof body.max_tokens).toBe('number'); // Anthropic requires the field
  });

  it('throws an error containing the status, with tokens redacted, on non-200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(
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

describe('parseSSEData (pure, Anthropic shape) + extractAnthropicDelta', () => {
  it('returns the data: payloads in order, ignoring event:/comment lines', () => {
    const sse = [
      'event: content_block_delta\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"a"}}\n\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"b"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ].join('');
    const payloads = parseAnthropicSSEData(sse);
    expect(payloads).toHaveLength(3);
    expect(payloads[0]).toContain('"text":"a"');
    expect(payloads[1]).toContain('"text":"b"');
  });

  it('extractAnthropicDelta keeps only content_block_delta text', () => {
    expect(extractAnthropicDelta('{"type":"content_block_delta","delta":{"type":"text_delta","text":"m"}}')).toBe('m');
    expect(extractAnthropicDelta('{"type":"message_start"}')).toBe('');
    expect(extractAnthropicDelta('{"type":"content_block_delta","delta":{"type":"input_json_delta"}}')).toBe('');
    expect(extractAnthropicDelta('garbage')).toBe('');
  });
});

describe('redactTokens (pure)', () => {
  it('masks sk-like tokens wherever they appear', () => {
    expect(redactTokens('key sk-abc123 here')).toBe('key [redacted] here');
    expect(redactTokens('sk-proj-XyZ_123-456/tail')).toBe('[redacted]/tail');
    expect(redactTokens('no secrets')).toBe('no secrets');
  });
});

/* ---------------- settings (localStorage `mv:ai`) ---------------- */

describe('settings (mv:ai)', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = makeStorage();
    vi.stubGlobal('localStorage', storage);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('returns defaults when nothing is stored', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({ provider: 'builtin', baseUrl: '', apiKey: '', model: '' });
  });

  it('roundtrips a valid configuration under the mv:ai key', () => {
    const next: ProviderSettings = {
      provider: 'anthropic',
      baseUrl: 'https://gateway.internal/anthropic',
      apiKey: 'tok-۱۲۳',
      model: 'claude-test',
    };
    saveSettings(next);
    expect(loadSettings()).toEqual(next);
    expect(storage.getItem('mv:ai')).toBeTruthy();
    expect(JSON.parse(storage.getItem('mv:ai') as string)).toEqual(next);
  });

  it('repairs invalid stored values field by field', () => {
    storage.setItem('mv:ai', JSON.stringify({
      provider: 'not-a-provider',
      baseUrl: 42,
      apiKey: null,
      model: true,
      extra: 'dropped',
    }));
    expect(loadSettings()).toEqual({ provider: 'builtin', baseUrl: '', apiKey: '', model: '' });
  });

  it('repairs broken JSON and non-object payloads to defaults', () => {
    storage.setItem('mv:ai', '{not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    storage.setItem('mv:ai', '[1,2,3]');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    storage.setItem('mv:ai', '"openai"');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('trims baseUrl/model but preserves the apiKey verbatim', () => {
    const next: ProviderSettings = {
      provider: 'openai',
      baseUrl: '  https://api.example.com/v1/  ',
      apiKey: '  keep my spaces  ',
      model: ' gpt-test ',
    };
    saveSettings(next);
    expect(loadSettings()).toEqual({
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1/', // whitespace-trimmed; slash handling is the provider's job
      apiKey: '  keep my spaces  ',
      model: 'gpt-test',
    });
  });

  it('normalizes any raw value through normalizeSettings', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ provider: 'openai' })).toEqual({
      provider: 'openai', baseUrl: '', apiKey: '', model: '',
    });
  });

  it('isExternalReady requires baseUrl + model for external providers only', () => {
    expect(isExternalReady({ provider: 'builtin', baseUrl: '', apiKey: '', model: '' })).toBe(false);
    expect(isExternalReady({ provider: 'openai', baseUrl: 'https://x/v1', apiKey: '', model: 'm' })).toBe(true);
    expect(isExternalReady({ provider: 'openai', baseUrl: 'https://x/v1', apiKey: '', model: '' })).toBe(false);
    expect(isExternalReady({ provider: 'anthropic', baseUrl: '', apiKey: 'k', model: 'm' })).toBe(false);
  });
});
