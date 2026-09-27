# Built-in Browser AI — Research Findings

> Research date: September 2026. Compiled from developer.chrome.com, MDN, and
> W3C WebML CG drafts (source URLs inline). Feeds the `js/ai.js` implementation —
> re-verify version numbers when the API set moves.

## Executive summary

The Prompt API (`LanguageModel`) is **stable on the web in Chrome 148** (stable
for extensions since Chrome 138). **Summarizer, Language Detector, and
Translator shipped stable in Chrome 138 (June 2025).** **Writer, Rewriter, and
Proofreader are still gated** behind origin trials (Writer/Rewriter OT Chrome
137–148; Proofreader OT Chrome 141–145). Everything runs on Gemini Nano,
requires a secure context (HTTPS), a capable desktop, and a ~4 GB on-device
model Chrome downloads on first use. Edge implements the same surfaces (mostly
developer previews; Summarizer default-on since Edge 138). Firefox and Safari
have no equivalent — Chromium-only.

## 1. Prompt API / `LanguageModel` — stable web: Chrome 148

https://developer.chrome.com/docs/ai/prompt-api · spec:
https://webmachinelearning.github.io/prompt-api/

```js
// Feature detection — the global is `LanguageModel` (window.ai was a 2024
// Canary preview and is gone)
if (!('LanguageModel' in self)) { /* hide AI UI / show explainer */ }

// 'available' | 'downloadable' | 'downloading' | 'unavailable' (null = treat as unavailable)
const av = await LanguageModel.availability();

const session = await LanguageModel.create({
  initialPrompts: [{ role: 'system', content: 'You are a markdown assistant.' }],
  expectedInputs:  [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
  monitor(m) { m.addEventListener('downloadprogress', e => console.log(e.loaded)); },
  signal: controller.signal, // optional AbortSignal
});

const answer = await session.prompt('Explain this doc');
const stream = session.promptStreaming('Explain this doc');
for await (const chunk of stream) append(chunk); // strings; some builds emit
                                                 // cumulative text — guard the
                                                 // appender (track last length)

console.log(session.contextWindow, session.contextUsage);          // current names
const tokens = await session.measureContextUsage('long text');
session.oncontextoverflow = () => {}; // or QuotaExceededError {requested, contextWindow}
const fork = await session.clone();
session.destroy();                    // free resources; later prompts throw
```

Gotchas: `[Exposed=Window, SecureContext]` (HTTPS; localhost OK for dev); not
available in workers; no documented per-page rate limit — the cap is the session
context window (read `contextWindow` at runtime). `temperature`/`topK` are
deprecated/extension-only; `samplingMode` is origin-trial — don't rely on them.

## 2. Summarizer — stable web: Chrome 138

https://developer.chrome.com/docs/ai/summarizer-api

```js
if (!('Summarizer' in self)) return;
if ((await Summarizer.availability()) === 'unavailable') return;
const summarizer = await Summarizer.create({
  type: 'key-points',   // 'key-points' | 'tldr' | 'teaser' | 'headline'
  format: 'markdown',   // 'markdown' | 'plain-text'
  length: 'short',      // 'short' | 'medium' | 'long'
  sharedContext: 'Documentation page',
  expectedInputLanguages: ['en'], outputLanguage: 'en',
});
const summary = await summarizer.summarize(docText);   // or summarizeStreaming()
```

Options are fixed per instance (recreate to change); user activation required to
trigger download; input token limit exists (chunk long docs).

## 3. Writer / Rewriter — NOT stable (origin trial 137–148)

https://developer.chrome.com/docs/ai/writer-api · /rewriter-api

```js
if ('Writer' in self && (await Writer.availability()) !== 'unavailable') {
  const writer = await Writer.create({ tone: 'formal', format: 'markdown', length: 'medium' });
  const text = await writer.write('Draft an intro for: ' + topic);
}
if ('Rewriter' in self && (await Rewriter.availability()) !== 'unavailable') {
  const rewriter = await Rewriter.create({ tone: 'more-formal', format: 'as-is', length: 'as-is' });
  const better = await rewriter.rewrite(selection, { context: 'Keep markdown syntax intact' });
}
```

Origin trial token required per page — awkward on GitHub Pages. Flags
(`chrome://flags/#writer-api`, `#rewriter-api`) work for local dev only.
**Fallback to the Prompt API with an editing system prompt is mandatory.**

## 4. Language Detector / Translator — stable web: Chrome 138

https://developer.chrome.com/docs/ai/language-detector-api · /translator-api

```js
const detector = await LanguageDetector.create();
const results = await detector.detect('Bonjour'); // [{detectedLanguage:'fr', confidence:0.9}]

const av = await Translator.availability({ sourceLanguage: 'en', targetLanguage: 'es' });
const translator = await Translator.create({ sourceLanguage: 'en', targetLanguage: 'es' });
const out = await translator.translate('Hello');
```

Language pairs are pair-specific (each combo downloads its own model).

## 5. Proofreader — origin trial 141–145, not stable

https://developer.chrome.com/docs/ai/proofreader-api — no streaming.

## Requirements + enablement (all Gemini Nano APIs)

- **OS:** Windows 10/11, macOS 13+, Linux; ChromeOS only on Chromebook Plus.
  **Not Android/iOS.**
- **Hardware:** ≥22 GB free disk (model ~4 GB); GPU >4 GB VRAM, or CPU-only
  with 16 GB RAM + 4 cores; unmetered network for the download.
- **Download:** triggered on first `create()`/`availability()` of any built-in
  AI API, **requires user activation**; progress via `monitor(...)`.
  Inspect at `chrome://on-device-internals`; manage at `chrome://components`
  ("Optimization Guide On Device Model").
- **Enterprise policy** (`BuiltInAIApisEnabled` on Edge) can disable everything —
  never assume presence.

## Outside Chrome

Edge: same Chromium surfaces (Prompt API, Writer/Rewriter, Proofreader in
developer preview; Summarizer default-on since Edge 138). Firefox/Safari: none;
MDN marks LanguageModel "not Baseline".

## Persian / Farsi — key risk

- Certified generation languages: **en, ja, es, de, fr** — **no `fa`**
  (summarizer/writer/prompt docs). Translator's language table also has no `fa`.
- Prompt API won't hard-fail on Persian unless we declare
  `expectedOutputs.languages: ['fa']` (which returns `unavailable`) — so don't
  declare it. Persian generation quality is unofficial and likely weak for an
  English-centric 4 GB model (UNCONFIRMED — test on real hardware).
- Mermaid + Persian labels: no public data. Mitigation: instruct the model to
  use Latin node IDs with quoted labels (`A["متن"]`), which is the pattern our
  samples already use.

## Recommendations for this app

1. **Freeform markdown/chart generation → Prompt API** (only API with system
   prompt + chat context + streaming). Model output inserted into the editor is
   plain textarea text (safe); anything rendered in the assistant panel must go
   through DOMPurify like the preview does. Treat document content as
   prompt-injection surface: the system prompt should tell the model to ignore
   embedded instructions and only follow the user's request.
2. **Summarize current doc → Summarizer** (stable, purpose-built,
   `format: 'markdown'`, `type: 'key-points'`); fall back to Prompt API.
3. **Rewrite selection → Rewriter when available, else Prompt API fallback**
   (OT gating makes Rewriter best-effort).
4. **Translate → Translator**, but `fa` is unavailable — for Persian the
   action falls back to the Prompt API or shows an honest unavailable state.
5. **Feature-detection order:** per feature `'X' in self` → `await X.availability()`;
   `unavailable` ⇒ disable that action (don't render a broken state);
   `downloadable` ⇒ one-time "Download AI model (~4 GB)" button whose click
   provides the required user activation, with `downloadprogress` UI;
   re-check availability on `visibilitychange`; cache the session per tab,
   `destroy()` on `pagehide`.
