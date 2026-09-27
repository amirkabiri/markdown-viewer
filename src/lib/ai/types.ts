// Module: ai/types — shared provider contracts. Pure types only, no runtime
// code. Legacy twin: legacy/src/ai/types.ts.

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
  /**
   * Direct editing: when true the assistant writes into the document itself
   * (stream-inserts/replaces + the per-message edit buttons). Absent/false =
   * off. Kept optional-and-omitted-when-off so stored payloads from before
   * this field existed stay exactly compatible (see normalizeSettings).
   */
  directEdit?: boolean;
}
