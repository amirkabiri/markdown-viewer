// Module: ai/types — shared provider contracts. Pure types only, no runtime code.

/** Which backend the assistant panel routes requests to. */
export type ProviderId = 'builtin' | 'openai' | 'anthropic';

/** A single chat turn. System messages must always come first. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * A stateless-per-request chat backend. stream() yields text deltas in order;
 * destroy() frees any backing resources (on-device sessions hold a model
 * instance and MUST be called on pagehide).
 */
export interface ChatProvider {
  readonly id: ProviderId;
  stream(messages: ChatMessage[], opts?: { signal?: AbortSignal }): AsyncIterable<string>;
  destroy?(): void | Promise<void>;
}

/** User-editable provider configuration, persisted in localStorage (`mv:ai`). */
export interface ProviderSettings {
  provider: ProviderId;
  baseUrl: string;
  apiKey: string;
  model: string;
}
