// Module: features/ai/chat-provider — maps the persisted provider settings to
// a ChatProvider instance for the external (HTTP) backends. The builtin
// on-device provider is NOT built here: its session lifecycle (lazily created,
// download consent, destroy on close) is owned by the panel's availability
// machine via a single BuiltinProvider instance. Legacy twin:
// legacy/src/ai/index.ts ensureProvider() external branch.

import { createAnthropicProvider } from '../../lib/ai/providers/anthropic';
import { createOpenAIProvider } from '../../lib/ai/providers/openai';
import type { ChatProvider, ProviderSettings } from '../../lib/ai/types';

/** Builds the configured external provider (`settings.provider !== 'builtin'`). */
export default function createExternalProvider(settings: ProviderSettings): ChatProvider {
  if (settings.provider === 'anthropic') return createAnthropicProvider(settings);
  return createOpenAIProvider(settings);
}
