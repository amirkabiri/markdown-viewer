// Module: ai/providers/ambient — minimal ambient types for the Chrome
// built-in AI APIs (Prompt API, Summarizer, Rewriter, Translator). They are
// not in lib.dom yet. Verified against docs/ai-research.md (Chrome 138/148
// surfaces). Legacy twin: legacy/src/ai/ambient.ts.

interface AiDownloadProgressEvent {
  loaded?: number;
}

type AiMonitor = EventTarget & {
  addEventListener(type: 'downloadprogress', listener: (e: AiDownloadProgressEvent) => void): void;
};

interface AiLmSession {
  prompt(input: string): Promise<string>;
  promptStreaming(input: string): AsyncIterable<unknown>;
  destroy(): void;
}

interface AiLanguageModel {
  availability(): Promise<'available' | 'downloadable' | 'downloading' | 'unavailable' | null>;
  create(options?: {
    initialPrompts?: { role: 'system' | 'user' | 'assistant'; content: string }[];
    monitor?(monitor: AiMonitor): void;
  }): Promise<AiLmSession>;
}

interface AiSummarizer {
  summarize(input: string): Promise<string>;
  destroy(): void;
}

interface AiSummarizerStatic {
  availability(): Promise<string>;
  create(options: { type: string; format: string; length: string }): Promise<AiSummarizer>;
}

interface AiRewriter {
  rewrite(input: string, options?: { context?: string }): Promise<string>;
  destroy(): void;
}

interface AiRewriterStatic {
  availability(): Promise<string>;
  create(options: {
    tone: string;
    format: string;
    length: string;
    sharedContext?: string;
  }): Promise<AiRewriter>;
}

interface AiLangPair {
  sourceLanguage: string;
  targetLanguage: string;
}

interface AiTranslator {
  translate(input: string): Promise<string>;
  destroy(): void;
}

interface AiTranslatorStatic {
  availability(pair: AiLangPair): Promise<string>;
  create(pair: AiLangPair): Promise<AiTranslator>;
}

/** `self` augmented with the optional, origin-trial-gated AI built-ins. */
type AiSelf = typeof self & {
  LanguageModel?: AiLanguageModel;
  Summarizer?: AiSummarizerStatic;
  Rewriter?: AiRewriterStatic;
  Translator?: AiTranslatorStatic;
};

/**
 * The browser `self` with the AI built-ins. Deliberately a function, not a
 * module-level constant: merely importing the builtin provider (e.g. for
 * messagesToPrompt in node unit tests) must not touch browser globals.
 */
export function selfAi(): AiSelf {
  return window.self;
}

export type { AiLangPair, AiLmSession };
