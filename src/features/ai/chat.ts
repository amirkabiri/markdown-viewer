// Module: features/ai/chat — the PURE prompt assembly for a chat send: whole-
// document chat vs selection-aware chat, each augmented with the agent tool
// protocol (+ the read-only note when direct editing is off). No DOM, no
// React — the panel hands this straight to createAgent().run(). Ported from
// legacy/src/ai/index.ts send() (the prompt half).

import { agentSystemPrompt } from '../../lib/ai/agent';
import { BUILTIN_SYSTEM_PROMPT } from '../../lib/ai/providers/builtin';
import { buildSelectionMessages } from '../../lib/ai/edits';
import type { ChatMessage } from '../../lib/ai/types';

export interface ChatPromptInput {
  question: string;
  /** A non-empty selection was captured at send time (selection-aware chat). */
  hasSelection: boolean;
  /** The captured selection text (verbatim — buildSelectionMessages needs it). */
  selected: string;
  /** The captured document text (context for selection-aware chat). */
  docText: string;
  /** Direct editing is off → the agent is told to suggest text in its reply. */
  readOnly: boolean;
}

/** Appends the agent tool protocol to the system message of a prompt. */
function withAgentPrompt(messages: ChatMessage[], agentPrompt: string): ChatMessage[] {
  const [first, ...rest] = messages;
  if (first?.role !== 'system') return messages; // nothing to augment (defensive)
  return [{ role: 'system', content: `${first.content}\n\n${agentPrompt}` }, ...rest];
}

/**
 * Pure: the messages for one send. Selection-aware sends pin the captured
 * selection + document via buildSelectionMessages; plain sends use the
 * markdown-assistant persona. The agent protocol (and read-only note when
 * applicable) rides on the system message either way.
 */
export function buildChatMessages(input: ChatPromptInput): ChatMessage[] {
  const agentPrompt = agentSystemPrompt({ readOnly: input.readOnly });
  if (input.hasSelection) {
    let prompt = agentPrompt;
    if (!input.readOnly) {
      prompt += '\n\nApply the edited selection with edit_document in "replace-selection" mode.';
    }
    return withAgentPrompt(
      buildSelectionMessages(input.question, input.selected, input.docText),
      prompt,
    );
  }
  return [
    { role: 'system', content: `${BUILTIN_SYSTEM_PROMPT}\n\n${agentPrompt}` },
    { role: 'user', content: input.question },
  ];
}
