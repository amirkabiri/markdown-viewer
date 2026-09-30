// Shared agent-boundary fakes (house pattern from legacy/test/ai-agent.test.ts
// — see TESTING.md): a ChatProvider streaming scripted replies and a
// ToolExecutor recording calls. Reused by agent tests and the AI panel tests.
// v2 toolset: the executor takes WHOLE tool calls (args + raw body) and
// answers with a structured ToolOutcome; outcomes can be queued per test.

import type { AgentToolCall, ToolExecutor } from '../lib/ai/agent';
import type { ToolOutcome } from '../lib/ai/tool-results';
import type { ChatMessage, ChatProvider, ProviderId } from '../lib/ai/types';

/** Streams one scripted reply per stream() call, chunked, recording inputs. */
export class FakeProvider implements ChatProvider {
  readonly id: ProviderId = 'builtin';

  calls: ChatMessage[][] = [];

  private script: string[];

  constructor(...replies: string[]) {
    this.script = [...replies];
  }

  async* stream(messages: ChatMessage[]): AsyncGenerator<string> {
    this.calls.push(messages.map((m) => ({ ...m })));
    const reply = this.script.shift() ?? '';
    const pieces = reply.match(/[\s\S]{1,6}/g) ?? [];
    let i = 0;
    while (i < pieces.length) {
      yield pieces[i];
      i += 1;
    }
  }
}

/** Always streams the same tool-call turn (cap testing). */
export class AlwaysReadProvider implements ChatProvider {
  readonly id: ProviderId = 'builtin';

  calls = 0;

  async* stream(_messages: ChatMessage[]): AsyncGenerator<string> {
    this.calls += 1;
    yield 'Checking the document.\n\n```qalam\n{"tool": "read_document", "args": {}}\n```';
  }
}

/** Records executed tool calls; queued outcomes are consumed in order. */
export class FakeExecutor implements ToolExecutor {
  calls: AgentToolCall[] = [];

  outcomes: ToolOutcome[] = [];

  /** The outcome returned for the next call with nothing queued. */
  defaultOutcome: ToolOutcome = { status: 'ok', message: 'done' };

  execute(call: AgentToolCall): ToolOutcome {
    this.calls.push(call);
    return this.outcomes.shift() ?? this.defaultOutcome;
  }
}
