// Module: ai/providers/anthropic — ChatProvider adapter for
// Anthropic-compatible Messages API services. POST {baseUrl}/v1/messages with
// `x-api-key` (token optional — proxies may inject it),
// `anthropic-version: 2023-06-01` and
// `anthropic-dangerous-direct-browser-access: true` (required for direct
// browser CORS). The system prompt is a TOP-LEVEL string, never a message;
// text deltas arrive in `content_block_delta` events as `delta.text`.

import { parseSSEData, streamSSEDeltas } from './sse.js';
import { responseError } from './http.js';
import type { ChatMessage, ChatProvider, ProviderSettings } from '../types.js';

/** Re-exported so tests (and future event: aware variants) can hit one place. */
export { parseSSEData };

/** Anthropic requires an explicit output budget; a sane fixed cap for inserts. */
const ANTHROPIC_MAX_TOKENS = 4096;

/** Pure: maps one `data:` payload to its text delta ('' for non-text events). */
export function extractAnthropicDelta(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as {
      type?: unknown;
      delta?: { text?: unknown };
    };
    if (parsed.type !== undefined && parsed.type !== 'content_block_delta') return '';
    const text = parsed.delta?.text;
    return typeof text === 'string' ? text : '';
  } catch {
    return ''; // keepalives and non-JSON payloads are silently skipped
  }
}

export function createAnthropicProvider(settings: ProviderSettings): ChatProvider {
  const base = settings.baseUrl.trim().replace(/\/+$/, ''); // tolerate a trailing slash
  return {
    id: 'anthropic',
    async *stream(messages: ChatMessage[], opts?: { signal?: AbortSignal }): AsyncGenerator<string> {
      const system = messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n');
      const turns = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const res = await fetch(base + '/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
          ...(settings.apiKey ? { 'x-api-key': settings.apiKey } : {}),
        },
        body: JSON.stringify({
          model: settings.model,
          max_tokens: ANTHROPIC_MAX_TOKENS,
          ...(system ? { system } : {}),
          messages: turns,
          stream: true,
        }),
        signal: opts?.signal,
      });
      if (!res.ok) throw await responseError(res);
      if (!res.body) throw new Error('AI request failed: empty response body');
      yield* streamSSEDeltas(res, extractAnthropicDelta, opts);
    },
  };
}
