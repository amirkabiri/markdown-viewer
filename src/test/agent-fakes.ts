// Shared agent-boundary fakes (house pattern from legacy/test/ai-agent.test.ts
// — see TESTING.md): a ChatProvider streaming scripted replies and a
// ToolExecutor recording calls. Reused by agent tests and, later, the AI
// panel component tests.

// eslint-disable-next-line max-classes-per-file -- agent fakes ship together for cross-file reuse
import type { ToolExecutor } from '../lib/ai/agent';
import type { EditMode } from '../lib/ai/edits';
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

/** Records tool executions; editDocument refuses when editResult is false. */
export class FakeExecutor implements ToolExecutor {
  reads = 0;

  edits: { mode: EditMode; text: string }[] = [];

  editResult = true;

  constructor(readonly doc = 'DOC CONTENT') {}

  readDocument(): string {
    this.reads += 1;
    return this.doc;
  }

  editDocument(mode: EditMode, text: string): boolean {
    this.edits.push({ mode, text });
    return this.editResult;
  }
}
