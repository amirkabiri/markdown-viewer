// Module: ai/providers/openai — ChatProvider adapter for OpenAI-compatible
// chat services (api.openai.com, OpenRouter, llama.cpp server, vLLM, …).
// POST {baseUrl}/chat/completions with `Authorization: Bearer <token>` (token
// optional — some gateways don't need one) and `stream: true`; deltas come as
// SSE `data:` lines terminated by `data: [DONE]`. Legacy twin:
// legacy/src/ai/providers/openai.ts (the parseSSEData re-export is gone —
// tests hit providers/sse directly).

import { streamSSEDeltas } from './sse';
import { responseError } from './http';
import type { ChatMessage, ChatProvider, ProviderSettings } from '../types';

/** Pure: maps one `data:` payload to its text delta ('' for [DONE]/noise). */
export function extractOpenAIDelta(payload: string): string {
  if (payload === '[DONE]') return '';
  try {
    const parsed = JSON.parse(payload) as { choices?: { delta?: { content?: unknown } }[] };
    const content = parsed.choices?.[0]?.delta?.content;
    return typeof content === 'string' ? content : '';
  } catch {
    return ''; // keepalives and non-JSON payloads are silently skipped
  }
}

export function createOpenAIProvider(settings: ProviderSettings): ChatProvider {
  const base = settings.baseUrl.trim().replace(/\/+$/, ''); // tolerate a trailing slash
  return {
    id: 'openai',
    async* stream(
      messages: ChatMessage[],
      opts?: { signal?: AbortSignal },
    ): AsyncGenerator<string> {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: settings.model, messages, stream: true }),
        signal: opts?.signal,
      });
      if (!res.ok) throw await responseError(res);
      yield* streamSSEDeltas(res, extractOpenAIDelta, opts);
    },
  };
}
