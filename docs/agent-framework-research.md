# AI Agent Frameworks — Adopt or Keep Our Own? (Decision Doc)

> Research date: 2026-09-30. Scope: should Qalam keep maintaining its own
> in-browser agent loop (src/lib/ai/agent.ts) or adopt an open-source JS/TS
> agent framework; plus a v2 toolset design. All bundle numbers were measured
> in this worktree (methodology in §6). Statistics (stars, downloads,
> last-push) were captured on 2026-09-30 and drift — re-verify before
> relying on them.

## 1. Executive summary

**Recommendation: KEEP OUR OWN loop, and spend the effort on a v2 toolset.**
The agent loop is not the part that underperforms — the toolset is. Our loop
is ~230 dependency-free, unit-tested lines whose fenced-JSON protocol works
with every user-configurable endpoint because it needs **no native function
calling**. Every credible framework we evaluated implements tool calling as a
pass-through of the provider's **native** `tools` parameter; none offers a
pluggable text/JSON-protocol tool-calling strategy. Adopting one would either
(a) regress the agent on the LM Studio / Ollama / llama.cpp-class endpoints
Qalam explicitly supports, or (b) force us to re-implement our own protocol
parsing *inside* the framework's provider interface — strictly more code than
we maintain today, plus bundle weight. Concretely, adopting the runner-up
(Vercel AI SDK, the only credible adopt path) adds ~150–250 kB gzip to a main
bundle that is currently 244 kB gzip, to replace code we already have working
and tested.

**Runner-up: Vercel AI SDK v7 (`ai` + `@ai-sdk/openai-compatible`).** It is
the only framework that is simultaneously isomorphic (verified: zero
`node:` runtime imports, single ESM entry, bundles cleanly for the browser),
permissively licensed (Apache-2.0), massively maintained (31.6M weekly
downloads, 27k stars, daily activity), flexible on providers (custom
`baseURL`/`headers`/`fetch`), and has client-side tool execution with a
streaming tool-UI state machine (`ToolUIPart.state`:
`input-streaming → input-available → output-available → output-error`) that
maps well onto our tool-activity display. If Qalam ever **requires native
function calling** (drops or gates pre-native endpoints) or grows the agent
into multi-agent / persistent-workflow territory, the AI SDK — or LangGraph.js
(checkpoints, interrupts, human-in-the-loop) — becomes the right call.

**What would change the decision (triggers to re-run this research):**

1. We decide to require native function calling (e.g. "modern endpoints
   only") → adopt Vercel AI SDK; the loop + tool-UI come free.
2. The agent needs persistence/resume, sub-graphs, or interrupt-style
   human-in-the-loop workflows → evaluate LangGraph.js (its browser build is
   now clean; the cost is bundle weight + the same native-tool-calling
   constraint).
3. The static-site constraint is dropped (we get a server) → re-evaluate
   Mastra / CopilotKit / Cloudflare Agents, which are all server-bound.

**The actual performance fix (independent of adopt/keep): the v2 toolset in
§5** — granular reads with line numbers, search, an outline tool,
content-anchored search/replace editing, range edits, and a diff-preview
confirmation UX, designed from evidence in Claude Code, Aider, Cline, and
OpenAI's apply_patch. Estimated effort: 2–4 engineer-days, all inside
`src/lib/ai/` + `src/features/ai/` + the editor controller.

---

## 2. Hard constraints recap (the filter every candidate must pass)

| Constraint | Consequence for framework choice |
|---|---|
| Static site on GitHub Pages; **no backend** | Anything requiring a server runtime (CopilotKit runtime, Mastra server, Cloudflare Durable Objects, LangGraph Platform) is disqualified as-is |
| **User-configured provider**: arbitrary OpenAI-compatible base URL + key in localStorage | Framework must accept a custom `baseURL` + `fetch`; native function-calling support on such endpoints is **unreliable** — a framework that hard-depends on it is a regression |
| Bundle size matters; CSP `script-src 'self'`; documents up to 10 MB | Candidate cost measured in kB gzip added to the main chunk; no eval/polyfill dramas tolerated |
| License must be permissive (MIT/Apache-2/BSD) | Flag copyleft / source-available |
| React 19 | UI-layer frameworks must be React-19-compatible |

---

## 3. Evaluated frameworks

Adoption/maintenance data measured 2026-09-30 (npm = downloads **last week**;
GitHub = stars / last push). Bundle column = our measurements (§6),
minified + gzip(-9), browser platform, tree-shaken, full dep tree.

### 3.1 Vercel AI SDK v7 — `ai`, `@ai-sdk/openai(-compatible)`, `@ai-sdk/react`

- **Data**: `ai` 7.0.123, Apache-2.0, 31.6M dl/wk; `@ai-sdk/react` 10.1M;
  27,051 stars; pushed 2026-09-30 (daily). https://github.com/vercel/ai
- **Architecture**: `ToolLoopAgent` class (v6/v7) + `generateText`/`streamText`
  with `stopWhen` (default `isStepCount(20)`), `prepareStep` (per-step
  model/tool/message mutation), tools = `tool({ description, inputSchema (zod),
  execute })`; a tool without `execute` stops the loop (documented
  `done`-tool pattern with `toolChoice: 'required'`).
  https://ai-sdk.dev/docs/agents/loop-control
- **Browser-only**: YES. Verified by construction: bundled `ai@7.0.122` +
  `@ai-sdk/openai@4.0.81` for the browser with rolldown — the `ai` dist has a
  single isomorphic ESM entry, zero `node:` runtime imports (the only
  `node:http`/`node:async_hooks` occurrences are in `.d.ts` and source maps).
  Vercel's docs *recommend* server-side key handling, but nothing requires a
  server; tools with `execute` run in-process (i.e., in the page).
- **Provider flexibility**: excellent. `createOpenAICompatible({ baseURL,
  headers, fetch })` is purpose-built for arbitrary OpenAI-compatible
  endpoints (dedicated LM Studio page; `transformRequestBody` for picky
  proxies). https://ai-sdk.dev/providers/openai-compatible-providers —
  Qalam's builtin Gemini Nano provider would need a hand-written custom
  `LanguageModelV3` provider adapter (non-trivial but documented).
- **Protocol flexibility**: **the deal-breaker.** Tool calling goes through
  the provider's native `tools` parameter. There is no text/prompt-based
  tool-calling mode (only `generateObject` has non-tool modes). Mitigations
  exist for flaky native support — `repairToolCall` callback for invalid
  calls — but they still presuppose native tool calls. Docs:
  https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling
- **Streaming UX fit**: excellent — `ToolUIPart` state machine
  (`input-streaming`, `input-available`, `output-available`, `output-error`;
  verified in `ai` v7 types) is exactly our tool-activity display; `useChat`
  (10M dl/wk) could replace our panel plumbing but ours already works.
- **Bundle**: `ai` core **148 kB min+gzip**; `@ai-sdk/openai` 98 kB
  (shared `provider-utils` chunk; combined realistic ~180–220 kB).
- **Migration cost (if adopted)**: 1–2 weeks — custom Gemini Nano provider
  adapter, provider swap, tool re-registration with zod schemas, streaming
  event remap, and the protocol change (native tool calls) requiring new
  prompt/testing on weak endpoints.

### 3.2 LangChain.js / LangGraph.js

- **Data**: `langchain` 3.4M dl/wk, `@langchain/langgraph` 1.4.18, 4.0M dl/wk;
  langchainjs 18,242 stars, langgraphjs 3,327 stars; both MIT; daily activity.
  https://github.com/langchain-ai/langgraphjs
- **Architecture**: LangGraph = state-graph runtime (Pregel-style) with
  checkpoints, interrupts, `Command`, sub-graphs; prebuilt React/Tool agents.
  Much heavier abstraction than needed for a single-document copilot.
- **Browser-only**: NOW VIABLE, recently. v1.4 ships a dedicated
  **`"browser": "./dist/web.js"` export condition** (verified in the
  published package.json), and `dist/web.js` greps **clean of Node
  builtins** — a big change from the long-standing `node:async_hooks`
  failures (https://github.com/langchain-ai/langgraphjs/issues/81). The full
  API surface (95 exports) is in the web build. You still need a chat-model
  package (`@langchain/openai` supports `configuration.baseURL`) on top.
- **Provider flexibility**: good (`ChatOpenAI({ configuration: { baseURL }})`).
- **Protocol flexibility**: `bindTools` → native function calling per model
  class. No text-protocol strategy.
- **Streaming UX fit**: good (stream events v2/v3), but event shapes are
  graph-oriented; mapping to a chat bubble + tool-activity list is work.
- **Bundle**: web entry **394 kB min+gzip** measured *without* a model
  package — realistically 450 kB+.
- **Verdict**: impressive runtime, wrong weight class for Qalam; and the
  native-tool-calling constraint applies.

### 3.3 OpenAI Agents SDK for JS (`@openai/agents`)

- **Data**: 0.18.0, MIT, 2.2M dl/wk; 3,881 stars; pushed 2026-09-25.
  https://github.com/openai/openai-agents-js
- **Architecture**: Agent/handoff/guardrail loop over OpenAI's Responses API
  (chat-completions fallback via `setOpenAIAPI`), streaming run events;
  `applyPatchTool`, `shellTool`, hosted tools, MCP.
- **Browser-only**: PARTIAL. Ships real multi-runtime shims (verified in the
  tarball: `shims-browser.js`, `shims-workerd.js`, `shims-react-native.js`
  with a browser `EventEmitter` + `AsyncLocalStorage` stand-in), but tracing
  context is `AsyncLocalStorage`-based — the docs themselves say traces rely
  on Node `AsyncLocalStorage` "or the respective environment polyfills" and
  can be inaccurate outside Node (tracing guide + troubleshooting guide).
- **Provider flexibility**: `setDefaultOpenAIClient` allows arbitrary base
  URLs; provider-agnostic claim in README; still OpenAI-shaped.
- **Protocol flexibility**: native function/tool calling only.
- **Bundle**: **487 kB min+gzip** measured — the heaviest viable option.
- **Verdict**: best-in-class ergonomics if you are an OpenAI shop; wrong
  defaults for an arbitrary-endpoint, bundle-sensitive, browser-only app.

### 3.4 Mastra (`@mastra/core`)

- **Data**: 1.72.0, Apache-2.0 for the main tree (verified LICENSE.md; only
  `ee/` directories are separately licensed — GitHub shows NOASSERTION due
  to the custom LICENSE.md layout), 2.1M dl/wk, 28,450 stars, daily activity.
- **Browser-only**: NO. Verified in the tarball: dist has 250+ direct
  `node:` imports (`node:fs` 26, `node:child_process` 6, `node:stream/web`
  51, …) and server deps (`hono`, `execa`, `posthog-node`, `ws`, `dotenv`).
  Mastra is a server framework (its dev/production server is the product).
- **Verdict**: disqualified by the no-backend constraint. License is fine
  (correct the common claim that it is Elastic License 2.0 — it relicensed;
  some third-party pages still say ELv2).

### 3.5 CopilotKit

- **Data**: MIT, 37,613 stars (largest here), 579k dl/wk, daily activity.
- **Browser-only**: NO. The architecture requires a **CopilotKit runtime**
  (Node/Bun/Deno/edge service) between browser and agents — the React
  provider takes `runtimeUrl` and the runtime speaks AG-UI to agent backends.
  https://docs.copilotkit.ai
- **Verdict**: disqualified as-is (server required). Would also drag in its
  own chat UI, which Qalam does not need.

### 3.6 assistant-ui (`@assistant-ui/react`)

- **Data**: MIT, 12,357 stars, 2.2M dl/wk, daily activity.
- **Browser-only**: YES — `LocalRuntime` + a custom `ChatModelAdapter` runs
  fully in-browser (their own discussion #2123 is exactly this use case).
  **But read the fine print**: the adapter's `run()` IS the agent loop — you
  still write model calls, tool-call emission, and tool-result feeding
  yourself. assistant-ui replaces/hosts your **chat UI and message state**,
  not your loop. Adopting it would swap Qalam's working AiPanel/ToolActivity
  UI for their component system while leaving the loop problem untouched.
- **Verdict**: a UI-layer option, not an agent-loop option; low value for
  Qalam, which already has the UI.

### 3.7 VoltAgent (`@voltagent/core`)

- **Data**: 2.11.0, MIT, 10,707 stars, but only **34.6k dl/wk**.
- **Browser-only**: POSSIBLE — dist greps clean of `node:` builtins, and the
  server/observability parts are separate packages. UNCERTAIN: no first-class
  browser documentation found; treat as untested for our purposes.
- **Protocol flexibility**: native tool calling.
- **Verdict**: low adoption + unproven browser story + same protocol
  constraint → no reason over the AI SDK as a runner-up.

### 3.8 LlamaIndex.TS (`llamaindex`)

- **Data**: 0.12.1, MIT, 150.5k dl/wk. Agent/workflow modules exist, but the
  library is RAG/server-first (many cloud-service integrations). No credible
  browser-only agent-loop story found. UNCERTAIN: browser capability may
  exist per-package; not load-bearing for this decision.

### 3.9 KaibanJS

- **Data**: MIT, 1,480 stars, **199 dl/wk**, last push 2026-05-15 (4.5 months
  stale). Kanban-style multi-agent metaphor, server-flavored.
- **Verdict**: effectively dormant; excluded from scoring.

### 3.10 Cloudflare Agents (`agents`)

- **Data**: MIT, 5,681 stars, active. Built on **Durable Objects** — a server
  runtime by definition.
- **Verdict**: disqualified as-is (no backend). Noted because its
  "agents-with-tools-on-the-client" pattern (client tools called from a
  server loop over WebSocket) is the inverse of Qalam's constraint.

### 3.11 Others considered

- **Microsoft TypeChat**: archived/stale (last meaningful activity years ago);
  its "schema-in-prompt, validate-JSON-output" idea is nonetheless the
  closest published relative of our qalam protocol — worth citing as prior
  art that our approach is sound.
- **web-llm (MLC)**: not an agent framework — an in-browser WebGPU inference
  engine; adjacent to our builtin-provider story, not to the loop question.

---

## 4. Scored comparison

Scores 1–5 (5 best). Bundle = measured cost of adopting (5 = ~0 kB added).

| Framework | Browser-only fit | Provider flexibility (custom baseURL/fetch) | Protocol flexibility (non-native tool calling) | Streaming UX fit | Bundle (added gzip) | License | Maturity / maintenance | Migration cost | Total /40 |
|---|---|---|---|---|---|---|---|---|---|
| **Our own loop (status quo + v2 tools)** | 5 | 5 | 5 (qalam fence) | 4 | 5 (0 kB) | n/a | 3 (we maintain it; ~230 lines, tested) | 5 (toolset work only) | **32** |
| **Vercel AI SDK v7** — runner-up | 5 | 5 | 1 (native only) | 5 | 2 (~150–220 kB) | Apache-2.0 | 5 | 2 | **25** |
| LangGraph.js v1.4 (web build) | 4 | 4 | 1 | 3 | 1 (~400+ kB) | MIT | 5 | 1 | **19** |
| OpenAI Agents SDK JS | 3 (shims; tracing caveats) | 3 | 1 | 4 | 1 (~487 kB) | MIT | 4 | 1 | **17** |
| assistant-ui (LocalRuntime) | 5 | 4 | 2 (you write the loop) | 5 (UI-level) | 3 | MIT | 4 | 2 (UI swap, loop stays ours) | **25** (but solves a problem we don't have) |
| Mastra | 1 (server-bound) | 4 | 1 | 3 | 0 (moot) | Apache-2.0 (ee/ excluded) | 4 | 0 | **13** |
| CopilotKit | 1 (runtime server) | 3 | 2 | 4 | 0 (moot) | MIT | 5 | 0 | **15** |
| VoltAgent | 3 (UNCERTAIN) | 3 | 1 | 2 | 2 | MIT | 2 (34k dl/wk) | 1 | **14** |
| LlamaIndex.TS | 2 (UNCERTAIN) | 3 | 1 | 2 | 1 | MIT | 3 | 1 | **13** |
| KaibanJS | 2 | 2 | 1 | 1 | 1 | MIT | 1 (dormant) | 1 | **9** |
| Cloudflare Agents | 1 (Durable Objects) | 3 | 2 | 3 | 0 (moot) | MIT | 4 | 0 | **13** |

Reading: no framework scores above ours on the weighted reality of Qalam's
constraints, because **protocol flexibility is a hard gate** (score 1 there
means "would regress supported endpoints") and bundle cost is paid by every
visitor. The AI SDK's 25 is a genuine second place; note assistant-ui's 25 is
not comparable — it competes with our UI, not our loop.

---

## 5. The actual fix — Qalam v2 toolset (proposal)

### 5.1 Why the current toolset underperforms

Current state (src/lib/ai/agent.ts, src/lib/ai/edits.ts): two tools —
`read_document` (whole document, head+tail clip at 12,000 chars) and
`edit_document` (4 blunt modes: `cursor`, `replace-selection`, `append`,
`replace-document`), 3 tool calls per run, TOOL RESULT fed back as one
user-role message. Problems, in order of impact:

1. **No navigation.** On any document over the clip size the model sees head
   + tail and must guess about the middle. There is no search and no way to
   read a range. (Qalam allows 10 MB documents.)
2. **No content-anchored editing.** `replace-selection` only works on the
   *user's* selection; the model's own edits are limited to whole-document
   rewrites (`replace-document` — expensive, risky, confirm-gated) or blind
   inserts. The single most reliable editing primitive in the industry —
   exact-match search/replace — is absent.
3. **Multi-line text via JSON strings.** Our fenced-JSON args require
   `\n`-escaping every newline — a known weak-model failure mode (Aider and
   Cline both moved to raw-text block formats for exactly this reason).
4. **Cap too low, feedback too thin.** 3 executions per run and no structured
   error feedback (a refused edit returns prose, not a retryable error).

### 5.2 Evidence base (established agents' tool design)

- **Anthropic / Claude Code**: consolidate into **a few high-granularity
  tools** with parameters like `offset`/`limit` rather than many narrow ones;
  Claude Code does navigation with Read(offset, limit), Grep, Glob and edits
  with exact-match Edit (`old_string`/`new_string`, `replace_all`) —
  content-anchored, not line-number-anchored.
  https://www.anthropic.com/engineering/writing-tools-for-agents
- **Aider**: edit-format choice is model-dependent; SEARCH/REPLACE blocks
  ("diff" format) are the reliable default because only changed hunks are
  returned and the format is structurally simple; whole-file rewrite ("whole")
  is the low-skills fallback; Gemini needed a fencing variant (`diff-fenced`)
  because it failed at conforming to the standard fence — direct evidence
  that fence conformance is a real failure mode for the exact model class
  Qalam serves. https://aider.chat/docs/more/edit-formats.html
- **Cline**: `replace_in_file` SEARCH/REPLACE blocks; line-number-based edits
  fail because models cannot reliably count lines, and exact matching is
  brittle (whitespace drift, out-of-order blocks — issues #4384, #4067);
  Cline invested in forgiving/fuzzy application to raise success rates.
  https://github.com/cline/cline/issues/4384 ,
  https://cline.bot/blog/improving-diff-edits-by-10
- **OpenAI apply_patch (Codex)**: hunks located by context markers + context
  lines with exact removal-line verification; models are *trained* on the
  format, which is why it wins for OpenAI models — for Qalam's arbitrary
  models, prefer the simplest content-anchored format (SEARCH/REPLACE), not a
  bespoke diff grammar. https://developers.openai.com/api/docs/guides/tools-apply-patch
- **Human-in-the-loop confirmation**: Anthropic's agent guidance places an
  approval gate around side-effecting actions; the AI SDK's loop has the same
  concept ("a tool call needs approval" is a first-class stop condition).
  https://www.anthropic.com/engineering/building-effective-agents ,
  https://ai-sdk.dev/docs/agents/loop-control

### 5.3 Proposed v2 toolset (7 tools)

Protocol unchanged in kind: fenced ` ```qalam ` blocks. Two payload shapes:
JSON args for scalar ops, and **raw-text SEARCH/REPLACE bodies for text-heavy
edits** (no JSON escaping — the Cline/Aider lesson). Keep the fence-label
mechanism and the parser; extend the grammar. Keep a per-run cap, raised to
**8 steps** (navigation costs steps: search → read → edit is already 3).

| # | Tool | Args | Why it earns its place |
|---|---|---|---|
| 1 | `read_document` | `{ "offset": <line>, "limit": <lines> }` (defaults: start, ~400 lines) | Ranged, **line-numbered** reads (cat -n style) replace the 12k-char head+tail clip; makes 10 MB documents navigable. Response header carries `totalLines` + `clipped` flag. (Anthropic offset/limit pattern.) |
| 2 | `search_document` | `{ "pattern": <string>, "regex": <bool, default false>, "maxResults": <int, default 20> }` | Returns `[lineNumber, line text]` hits. The single biggest capability gap today: the model cannot find anything in a large doc without it (Claude Code's Grep analog). |
| 3 | `document_outline` | `{}` | Headings with line numbers (Qalam is Markdown — cheap: reuse lib/markdown's heading parse). Lets the model plan edits structurally instead of scanning. |
| 4 | `replace_text` | SEARCH/REPLACE body: `<<<<<<< SEARCH` / `=======` / `>>>>>>> REPLACE`, plus JSON flags `{ "occurrence": "first"|"all" }` | The workhorse. Exact-match (whitespace-tolerant fallback) content-anchored replace; failure returns a retryable TOOL RESULT with the nearest matching line numbers (Cline's lesson: structured error feedback). Replaces today's `replace-selection`-for-the-model gap and most `replace-document` uses. |
| 5 | `insert_at_cursor` | `{ "text": <string> }` | Keeps the human-in-the-loop feel of today's `cursor` mode (agent writes where the user is looking). Cheap, reliable. |
| 6 | `replace_range` | `{ "startLine": <int>, "endLine": <int> }` + raw body text | Structural/range rewrite for large spans found via outline/search — far cheaper than whole-doc or long SEARCH blocks. Guard: range re-validated against the current document at apply time; stale ranges return an error, not a corrupt edit (line-number staleness is a known failure mode — hence it is *second* choice behind `replace_text`). |
| 7 | `replace_document` | `{ "text": <string> }` (raw body) | Kept as the Aider "whole"-format fallback for models that cannot do search/replace, and for genuine full rewrites. Stays behind the existing confirm dialog. |

Dropped: `append` (use `replace_range` at the end or `insert_at_cursor` at
doc end — one fewer tool), `edit_document`'s mode enum (replaced by the above
— 4 blunt modes → 4 precise tools). Total: **7 tools**, within the
"few, high-granularity" budget Anthropic recommends; tool descriptions ride
in the system prompt as today.

### 5.4 Diff-preview / confirmation UX

Every write op lands as a **pending diff** rather than an immediate write:
a card in the chat thread (and, optionally, ghost-highlight in the editor)
showing removed/added lines with Apply / Apply-all / Discard controls;
`TOOL RESULT` reports `pending` (not `OK`) until applied, or auto-apply when
the user has write-assist enabled and the op is small (<N lines). This
reuses the existing write-permission gate (`directEdit` setting + the
`aiReplaceDocConfirm` confirm) and matches the human-in-the-loop pattern
used across the industry (Anthropic approval gates; AI SDK
needs-approval stop condition; Cline's diff-view-before-apply UX).

### 5.5 Exposing the preview-selection context (feature in flight)

Recommend **context injection, not a tool**: at send time, pin the current
selection into the conversation (already done by
`buildSelectionMessages` in src/lib/ai/chat.ts / edits.ts) *extended* with
structural anchors the v2 tools can act on:

```
<selection lines="42-58" heading="## Results">
…selection text…
</selection>
```

so the model can immediately use `replace_range(startLine=42, endLine=58)` or
`replace_text` with the selection's first/last lines as anchors — no wasted
tool call to discover what the user selected. Optional (defer): a
`read_selection` tool for mid-conversation reselection; inject-at-send covers
the dominant case and keeps the tool count down. UNCERTAIN (needs product
decision): whether auto-apply of selection-scoped edits should bypass the
confirm card.

---

## 6. Migration assessment

### 6.1 Recommended: KEEP + v2 toolset

- **Touch**: `src/lib/ai/agent.ts` (grammar: SEARCH/REPLACE bodies; new tool
  registry; step cap 3→8; structured error TOOL RESULTs),
  `src/lib/ai/edits.ts` (planner additions: whitespace-tolerant exact match,
  range replace with staleness check, pending-diff plan type — all pure,
  matching the existing computeEdit test surface),
  `src/features/ai/chat.ts` (protocol prompt: new tool docs + examples),
  `src/features/ai/ToolActivity.tsx` (per-op labels),
  editor controller (executor impl: search/outline services from
  `src/lib/markdown.ts`; pending-diff state), i18n strings.
- **Delete**: nothing. `edit_document`'s 4-mode enum dies; the fence
  mechanism, loop, provider layer, and tests stay.
- **Bundle**: ~+2–3 kB (no new deps). CSP unchanged. Streaming event shapes
  unchanged (`text`/`tool`/`tool-result`/`done` with richer `args`).
- **Effort**: 2–4 engineer-days including tests (the pure planners are the
  bulk; the loop change is small).
- **Risks**: (a) protocol conformance on weak models — mitigate by keeping
  the fence mechanism, per-tool examples, and the forgiving matcher +
  retryable errors; (b) prompt growth raises per-send tokens — mitigate with
  compact tool docs (measure; the current TOOL_PROTOCOL is ~200 tokens);
  (c) line-number staleness — mitigated by content-anchored `replace_text`
  being the primary op and range re-validation.

### 6.2 Runner-up: adopt Vercel AI SDK (for the record)

- **Add**: `ai` + `@ai-sdk/openai-compatible` (~150–220 kB gzip realistic),
  zod. **Rewrite**: provider layer (`createOpenAICompatible({ baseURL,
  apiKey, fetch })`; hand-written custom provider for the builtin Gemini
  Nano path — the expensive part), tools as `tool({ inputSchema, execute })`,
  panel to `useChat` UIMessage parts. **Delete**: providers/sse.ts,
  openai.ts, our loop (~230 lines) — replaced by ToolLoopAgent.
- **Blocking regression**: native function calling becomes a requirement for
  agentic editing; text-protocol fallback would have to be re-implemented as
  a fake `LanguageModelV3` provider — i.e., our current parser lives on
  *inside* the SDK, plus SDK weight. This is the argument that settles it.
- **Risks**: bundle (+60–90% of today's main chunk gzip), streaming event
  remap, Gemini Nano adapter cost, and per-endpoint behavior variance now
  hidden inside SDK request shaping.

---

## 7. Sources

Load-bearing claims and where they come from. Measured numbers (bundle sizes,
grep results, stats) were produced 2026-09-30 in this research pass; methods
noted inline.

**Qalam internals (this worktree)**
- Agent loop + qalam protocol: `src/lib/ai/agent.ts`; edit modes + selection
  prompts: `src/lib/ai/edits.ts`; prompt assembly:
  `src/features/ai/chat.ts`; provider abstraction: `src/lib/ai/types.ts`,
  `src/lib/ai/providers/openai.ts`. Baseline bundle (built in worktree):
  main chunk 760.70 kB raw / 244.20 kB gzip (Vite 8 / rolldown output).

**Vercel AI SDK**
- Loop control / ToolLoopAgent / stopWhen / prepareStep / approval stop:
  https://ai-sdk.dev/docs/agents/loop-control
- Tool calling, native `tools` param, repairToolCall, no text-mode for tools:
  https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling
- OpenAI-compatible provider: baseURL/headers/fetch/transformRequestBody,
  LM Studio page: https://ai-sdk.dev/providers/openai-compatible-providers
- Repo/license/activity: https://github.com/vercel/ai (Apache-2.0 per
  package.json of `ai@7.0.123`; 31.6M dl/wk npm, 2026-09-30)
- Browser isomorphism: **verified directly** — `ai@7.0.122` tarball dist has
  no `node:` runtime imports (only `.d.ts`/sourcemap mentions), single ESM
  entry, no `browser` export split; bundled under rolldown platform=browser.
- ToolUIPart state machine: verified in `ai@7.0.122` types
  (`state: 'input-streaming'` et al.); documented in
  https://ai-sdk.dev/docs/foundations/tools

**LangGraph.js**
- Historical browser failure (`node:async_hooks`):
  https://github.com/langchain-ai/langgraphjs/issues/81
- Current browser viability: **verified directly** — `@langchain/langgraph`
  1.4.18 package.json ships `"browser": "./dist/web.js"`; `dist/web.js`
  greps clean of Node builtins; same 95 exports as the node entry.
  https://www.npmjs.com/package/@langchain/langgraph
- Ecosystem stats: https://github.com/langchain-ai/langchainjs (MIT),
  https://github.com/langchain-ai/langgraphjs (MIT)

**OpenAI Agents SDK JS**
- Docs root / config surface (`setDefaultOpenAIClient`, `setOpenAIAPI`):
  https://openai.github.io/openai-agents-js/ (guides/config)
- Tracing via Node `AsyncLocalStorage` "or the respective environment
  polyfills": https://openai.github.io/openai-agents-js/guides/tracing/
- Browser shims: **verified directly** in `@openai/agents-core@0.18.0`
  tarball (`dist/shims/shims-browser.js` etc.).

**Mastra**
- License (Apache-2.0 main tree, `ee/` excluded): LICENSE.md at
  https://github.com/mastra-ai/mastra — verified directly (not ELv2, contrary
  to some third-party pages, e.g. https://www.linkstartai.com/en/github-picks/mastra)
- Server-bound: **verified directly** in `@mastra/core@1.72.0` tarball —
  250+ `node:` builtin imports; deps include hono, execa, posthog-node, ws.

**CopilotKit**
- Runtime-server architecture (`runtimeUrl`; runtime on Node/Bun/Deno/edge):
  https://docs.copilotkit.ai ; repo: https://github.com/CopilotKit/CopilotKit

**assistant-ui**
- LocalRuntime + ChatModelAdapter (you implement `run()`):
  https://www.assistant-ui.com/docs/runtimes/custom/local-runtime
- Browser-only tool-call discussion:
  https://github.com/assistant-ui/assistant-ui/discussions/2123

**Others**
- VoltAgent: https://github.com/VoltAgent/voltagent (MIT; 34.6k dl/wk)
- LlamaIndex.TS: https://github.com/run-llama/LlamaIndex.TS (MIT)
- KaibanJS: https://github.com/kaiban-ai/KaibanJS (MIT; 199 dl/wk; last push
  2026-05-15 — dormancy measured via GitHub API)
- Cloudflare Agents (Durable Objects):
  https://github.com/cloudflare/agents

**Toolset design evidence**
- Anthropic, "Writing effective tools for AI agents" (few high-granularity
  tools; offset/limit; namespacing):
  https://www.anthropic.com/engineering/writing-tools-for-agents
- Anthropic, "Building effective agents" (approval gates):
  https://www.anthropic.com/engineering/building-effective-agents
- Aider edit formats (whole / diff SEARCH-REPLACE / udiff / diff-fenced;
  model-format matching; Gemini fencing failures):
  https://aider.chat/docs/more/edit-formats.html
- Cline SEARCH/REPLACE brittleness and fuzzy application:
  https://github.com/cline/cline/issues/4384 ,
  https://github.com/cline/cline/issues/4067 ,
  https://cline.bot/blog/improving-diff-edits-by-10
- OpenAI apply_patch / V4A (context-anchored hunks, trained format):
  https://developers.openai.com/api/docs/guides/tools-apply-patch
- Diff-format benchmarking context (V4A vs others, model-training effects):
  https://arxiv.org/html/2510.12487v1

**Methodology for our measurements**
- npm downloads: api.npmjs.org `downloads/point/last-week`, 2026-09-30.
- GitHub stars/push/license: api.github.com, 2026-09-30.
- Tarballs: registry.npmjs.org `/latest`; grep for `node:` builtins over
  published `dist` (ESM entries).
- Bundles: rolldown 1.2.11 (same version as this repo's Vite 8), platform
  `browser`, tree-shaking on, `minify: true`, gzip level 9, entries resolved
  from the installed packages with full dependency trees. Numbers are
  single-run approximations (±10%); relative magnitudes are the signal.
