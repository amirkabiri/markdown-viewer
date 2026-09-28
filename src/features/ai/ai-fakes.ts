// House fakes for the AI panel component tests (TESTING.md: hand-rolled fakes
// at module boundaries). The boundaries faked here:
//   - EditorApi        → recording fake (edits + selection, real string doc)
//   - i18n translator  → dictionary-bound t (unknown keys pass through)
//   - ambient Prompt API (window.LanguageModel) → FakeLanguageModel with
//     queue-driven sessions and controllable create() (the builtin boundary)
//   - fetch + SSE      → stubFetch(): per-call queues of OpenAI-style delta
//     frames over a real ReadableStream Response (the external boundary)
// Shared src/test/fakes.ts covers Storage; this file stays feature-local.

import type { EditorApi } from '../editor/api';
import type { EditMode } from '../../lib/ai/edits';
import type { Lang } from '../../i18n';
import { dictionaries } from '../../i18n';

/* ---------------- translator ---------------- */

/** Dictionary-bound translator: legacy keys resolve exactly like the app t(). */
export function makeT(lang: Lang = 'en'): (key: string) => string {
  return (key: string) => dictionaries[lang][key] || key;
}

/* ---------------- editor ---------------- */

export interface RecordedEdit {
  mode: EditMode;
  text: string;
  pinnedRange?: [number, number];
}

export interface FakeEditorApi extends EditorApi {
  doc: string;
  selectionStart: number;
  selectionEnd: number;
  edits: RecordedEdit[];
  applyResult: boolean;
  setDoc(text: string): void;
  setSelection(range: [number, number]): void;
}

/** Recording EditorApi: applies edits to a real string so doc state asserts. */
export function createFakeEditor(
  doc = '',
  selection: [number, number] = [0, 0],
): FakeEditorApi {
  const fake: FakeEditorApi = {
    doc,
    edits: [],
    applyResult: true,
    selectionStart: selection[0],
    selectionEnd: selection[1],
    getText: () => fake.doc,
    getSelection: () => ({ start: fake.selectionStart, end: fake.selectionEnd }),
    hasSelection: () => fake.doc.slice(fake.selectionStart, fake.selectionEnd).trim() !== '',
    applyEdit: (mode, text, pinnedRange) => {
      fake.edits.push({ mode, text, pinnedRange });
      if (!fake.applyResult) return false;
      const [a, b] = pinnedRange ?? [fake.selectionStart, fake.selectionEnd];
      if (mode === 'replace-document') fake.doc = text;
      else if (mode === 'append') fake.doc += text;
      else fake.doc = fake.doc.slice(0, a) + text + fake.doc.slice(b);
      return true;
    },
    setDoc: (text) => {
      fake.doc = text;
    },
    setSelection: ([start, end]) => {
      fake.selectionStart = start;
      fake.selectionEnd = end;
    },
  };
  return fake;
}

/* ---------------- chunk queue (shared by both network fakes) ---------------- */

type QueueItem = { kind: 'chunk'; text: string } | { kind: 'end' } | { kind: 'error'; error: Error };

/** Text chunks delivered under test control; stream() consumes them. */
export interface ChunkQueue {
  push(text: string): void;
  end(): void;
  fail(error: Error): void;
  stream(): AsyncGenerator<string>;
}

export function makeChunkQueue(): ChunkQueue {
  const items: QueueItem[] = [];
  const waiters: ((item: QueueItem) => void)[] = [];
  const deliver = (item: QueueItem): void => {
    const waiter = waiters.shift();
    if (waiter) waiter(item);
    else items.push(item);
  };
  return {
    push: (text) => deliver({ kind: 'chunk', text }),
    end: () => deliver({ kind: 'end' }),
    fail: (error) => deliver({ kind: 'error', error }),
    async* stream() {
      for (;;) {
        let item = items.shift();
        if (item === undefined) {
          item = await new Promise<QueueItem>((resolve) => {
            waiters.push(resolve);
          });
        }
        if (item.kind === 'end') return;
        if (item.kind === 'error') throw item.error;
        yield item.text;
      }
    },
  };
}

/* ---------------- ambient Prompt API fake (builtin boundary) ---------------- */

export type FakeAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

type ProgressListener = (event: { loaded?: number }) => void;

/** One on-device session: queue-driven promptStreaming + a prompt() fallback. */
export interface FakeLmSession {
  queues: ChunkQueue[];
  prompts: string[];
  destroyed: boolean;
  destroy(): void;
  prompt(input: string): Promise<string>;
  promptStreaming(input: string): AsyncIterable<unknown>;
}

/** Builds a fake LanguageModel session (a factory keeps one class per file). */
export function makeFakeLmSession(): FakeLmSession {
  const session: FakeLmSession = {
    queues: [],
    prompts: [],
    destroyed: false,
    destroy(): void {
      session.destroyed = true;
    },
    async prompt(input: string): Promise<string> {
      session.prompts.push(input);
      return 'fallback reply';
    },
    promptStreaming(input: string): AsyncIterable<unknown> {
      session.prompts.push(input);
      const queue = makeChunkQueue();
      session.queues.push(queue);
      return queue.stream();
    },
  };
  return session;
}

/**
 * Fake `window.LanguageModel`: availability is scripted, create() stays
 * PENDING until the test resolves it (loading-state tests) or rejects, and
 * download progress fires only via emitProgress() (consent-flow tests).
 */
export class FakeLanguageModel {
  availabilityValue: FakeAvailability;

  availabilityCalls = 0;

  createCalls = 0;

  sessions: FakeLmSession[] = [];

  private progressListeners: ProgressListener[] = [];

  private pendingCreates: ((session: FakeLmSession) => void)[] = [];

  private pendingRejections: ((error: Error) => void)[] = [];

  constructor(availability: FakeAvailability = 'available') {
    this.availabilityValue = availability;
  }

  setAvailability(next: FakeAvailability): void {
    this.availabilityValue = next;
  }

  availability = async (): Promise<FakeAvailability | null> => {
    this.availabilityCalls += 1;
    return this.availabilityValue;
  };

  create = (options?: {
    monitor?(monitor: { addEventListener(type: 'downloadprogress', listener: ProgressListener): void }): void;
    initialPrompts?: unknown[];
  }): Promise<FakeLmSession> => {
    this.createCalls += 1;
    if (options?.monitor) {
      options.monitor({
        addEventListener: (_type, listener) => {
          this.progressListeners.push(listener);
        },
      });
    }
    return new Promise<FakeLmSession>((resolve, reject) => {
      this.pendingCreates.push(resolve);
      this.pendingRejections.push(reject);
    });
  };

  /** Fires the create() monitor's downloadprogress (loaded is a 0..1 fraction). */
  emitProgress(fraction: number): void {
    for (const listener of this.progressListeners) listener({ loaded: fraction });
  }

  /** Resolves the oldest pending create() with a fresh session. */
  openSession(): FakeLmSession {
    const session = makeFakeLmSession();
    this.sessions.push(session);
    const resolve = this.pendingCreates.shift();
    this.pendingRejections.shift();
    if (resolve) resolve(session);
    return session;
  }

  /** Rejects the oldest pending create() (download/session failure). */
  failCreate(error: Error): void {
    this.pendingCreates.shift();
    const reject = this.pendingRejections.shift();
    if (reject) reject(error);
  }

  install(): void {
    (window as unknown as { LanguageModel?: unknown }).LanguageModel = this;
  }
}

/** Removes the fake LanguageModel from the ambient globals. */
export function uninstallFakeLanguageModel(): void {
  delete (window as unknown as { LanguageModel?: unknown }).LanguageModel;
}

/* ---------------- fetch + SSE fake (external provider boundary) ---------------- */

export interface SseQueue {
  /** Pushes an OpenAI-style delta frame with `text` as the content delta. */
  delta(text: string): void;
  /** Pushes a raw SSE line (e.g. keepalives). */
  raw(text: string): void;
  /** Sends the [DONE] sentinel and closes the stream. */
  end(): void;
  /** Errors the stream mid-flight. */
  fail(error: Error): void;
}

export interface RecordedRequest {
  url: string;
  init?: RequestInit;
  /** init.body parsed as JSON (null when absent/unparseable). */
  body: unknown;
}

export interface FetchStub {
  fetch: typeof fetch;
  requests: RecordedRequest[];
  /** One queue per fetch call, in call order. */
  queues: SseQueue[];
}

/** Stubs global fetch with streaming SSE responses the test controls. */
export function stubFetch(): FetchStub {
  const requests: RecordedRequest[] = [];
  const queues: SseQueue[] = [];

  const fetchStub = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let body: unknown = null;
    try {
      body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    } catch {
      body = init?.body;
    }
    requests.push({ url: String(input), init, body });

    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const write = (text: string): void => {
      controller.enqueue(encoder.encode(text));
    };
    const queue: SseQueue = {
      delta: (text) => {
        write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
      },
      raw: write,
      end: () => {
        write('data: [DONE]\n\n');
        controller.close();
      },
      fail: (error) => {
        controller.error(error);
      },
    };
    queues.push(queue);
    const readable = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    return new Response(readable, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }) as typeof fetch;

  return { fetch: fetchStub, requests, queues };
}

/* ---------------- environment helpers ---------------- */

/** jsdom has no matchMedia; React Aria feature-detects media queries. */
export function installMatchMediaStub(): void {
  if (typeof window.matchMedia === 'function') return;
  const stub = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList;
  window.matchMedia = stub;
}
