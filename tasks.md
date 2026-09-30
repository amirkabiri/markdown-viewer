# Qalam (formerly markdown-viewer)

Single source of truth for pending work. Update this file in the same commit that
delivers a task — the board must never drift from reality.

Status legend: `[ ]` pending · `[~]` in progress · `[x]` done (kept one milestone back, then pruned)

---

## P0 — Critical path

### Milestone: TypeScript + Vite + CI migration (current)

- [x] **Agent T2 — GitHub Actions** (`.github/workflows/ci.yml` + `deploy.yml`)
  — DONE; quality + gated e2e jobs and Pages deploy. Activate the e2e job via
  Agent P, and flip Pages source once T1's build lands.
- [x] **Agent B1 — `js/share.js`** — DONE, browser-verified (live deflate roundtrip
  on the Persian doc; decode accepts full URLs too)
- [x] **Agent C — `js/ai.js`** — DONE, browser-verified (panel opens; honest
  unavailable explainer on non-capable browsers; chunk-normalizer unit tests)
- [x] **Agent T1 — TypeScript + Vite migration** — DONE, browser-verified on the
  production build (`pnpm` 11.3 pinned, strict tsconfig, 9 modules in `src/`,
  mermaid code-split, hljs themes vendored w/ style-swap, boot.js in `public/`,
  site docs copied to dist, 35 vitest tests green)
  - [x] **Agent P — Playwright e2e** — DONE, 12 tests green on
    chromium/firefox/webkit (3 consecutive runs): boot/render/Mermaid smoke,
    theme persistence, live typing; e2e CI job auto-activates now
- [x] **Commit T2's workflows** — DONE (Node 22 hotfix `4169f32`; quality +
  e2e jobs green, Pages deploy green)

### Milestone: AI direct document editing

- [x] **Agent C3 — direct-edit access + selection-aware chat** — DONE,
  browser-verified end-to-end through a mock OpenAI provider: select →
  instruct → streamed replacement of the selection in the textarea; 22 new
  tests (77 total green); `directEdit` toggle persisted
- [x] **Verify C3** — DONE: gates green, browser pass on the production build,
  committed as `0e9116e`.

### Milestone: React rewrite + product hardening (current) — branch `react-rewrite`

Stakeholder direction: rewrite the UI in **React** (the vanilla DOM code is the
ceiling now), enforce a famous style convention (**Airbnb**), adopt
Google-inspired automated-testing practices, add **a11y + keyboard shortcuts**
via a famous a11y-first React UI kit (research → decide), and three AI UX
requirements: (1) visible loading feedback while the first message warms the
LLM, (2) explicit user consent before downloading the built-in model (~4 GB,
never auto-download), (3) tool calls the agent made must be visible in chat.

- [x] **Agent R1 — toolchain scaffold** — DONE, verified by the lead: React 19
  + Vite + strict TS; Airbnb via `eslint-config-airbnb-extended` (flat-native,
  ESLint pinned ^9); vitest node+jsdom projects; RTL component test + 3-engine
  e2e baseline; `STYLEGUIDE.md` + `TESTING.md`; vanilla app frozen in
  `legacy/` (gates-excluded); CSP: `script-src 'self'` kept, narrow
  `style-src-attr` added for React/mermaid (documented in-file). Gates green
  on pushed HEAD; shell boots clean in browser.
- [x] **Agent R2 — UI kit research** — DONE (`docs/uikit-research.md`):
  **React Aria Components** `^1.21.1` — wins a11y AND RTL outright (derives
  direction from locale/`<html lang>`; Radix/Base UI need a manual
  DirectionProvider); unstyled; Radix = fallback, Base UI = watchlist.
  Bundle budget check + consequences section for consuming agents.
- [x] **Agent R3 — domain ports** — DONE, verified: `src/lib/` (store, share,
  documents, ai/{chunk,agent,settings,edits,providers}, pure markdown
  pipeline with mermaid hook point) + `src/i18n/` (pure `t(lang,key)`);
  169 tests green (96 ported + 70 added + 3 App). DOM-coupled halves stay in
  `legacy/` for UI agents. Lead lint-delta decisions (applied by R4):
  allow for-of/await-in-loop in ai streaming code; drop
  `@stylistic/operator-linebreak`; exempt test fakes from
  `max-classes-per-file`; allow console.warn/error in ai modules.
- [x] **Agent R4 — shell UI** — DONE, verified by the lead at wave HEAD:
  all five gates green (typecheck, lint 0 errors, 333 tests, build,
  18 e2e runs × 3 engines). Full parity: theme (pre-paint contract intact),
  EN⇄FA with RTL mirroring (RAC I18nProvider), editor + frozen `EditorApi`
  (undo-preserving applyEdit, localized replace-document confirm, pinned
  ranges clamped), preview (debounce, TOC + scroll-spy, mermaid re-theming,
  copy buttons, bidirectional scroll sync), documents (boot precedence
  `?url=`→`?file=`→`#d=`→welcome; share hash never rewritten), one-click
  share with capacity guardrails, pane modes with persisted split fraction.
  Deliberate deviations: toasts queue instead of replacing; document switch
  renders immediately (no debounce). AI panel integration point prepared in
  Shell (providers ready; topbar button intentionally absent for R8).
- [x] **Agent R5 — AI parity + UX requirements** — DONE, scope-verified by
  the lead (107 tests green in `src/features/ai` + `src/lib/ai`). Mounted at
  integration as `<AiPanel editor={editorApi} t={t} lang={lang}/>` (frozen
  props; panel is open-while-mounted — trigger wiring needs conditional
  mount or a controlled `open`/`onOpenChange`). All 3 UX requirements
  delivered + tested: (1) labeled loading state from send → first streamed
  event (builtin create() cold start covered; external SSE connect covered),
  input disabled while loading; (2) ~4 GB download consent — non-dismissable
  alert dialog on send while `downloadable`, `create()` never called before
  explicit Download (user activation), live progress, queued message
  proceeds on success, draft preserved + honest explainer on "Not now";
  (3) per-message persistent tool-activity list (tool, mode label,
  running → OK/Refused via the new `ok` event field, `aria-live`).
  Deviations (requirement-driven): RAC 1.21.1 has no `AlertDialog` export —
  `ModalOverlay(isDismissable=false)` + `Dialog role="alertdialog"` used
  instead (identical semantics; R2's doc corrected here); feature-local
  i18n labels in `src/features/ai/labels.ts`; in-panel RAC ToastRegion +
  react-stately ToastQueue until app-root toast plumbing exists (then point
  app ToastRegion at `aiToastQueue`).

### Milestone: persistence + multi-document management (current, on `react-rewrite`)

Stakeholder request: every document change persisted; IndexedDB for now;
architecture flexible for a future File System Access driver (browser disk
write permission); sidebar document management — create, select, remove,
sort. Implemented in the React rewrite only (the vanilla app is frozen).

- [~] **Agent R7 — persistence architecture (`src/lib/persistence/`)** —
  driver interface `PersistenceDriver` (init/list/get/put/delete/reorder)
  with `DocumentRecord` (id, name, content, createdAt, updatedAt, sortIndex,
  optional source metadata); `createIndexedDbDriver` (raw IndexedDB, no
  runtime deps, injectable factory for tests) + `createMemoryDriver` (fakes
  + graceful fallback when IDB is unavailable) + documented (not implemented)
  File System Access driver plan behind the same interface; repository layer
  with autosave (per-change trailing debounce + flush on pagehide/visibility)
  and onChange subscriptions for live sidebar updates; one-time migration
  from legacy `mv:doc`/`mv:recent` localStorage. Tests with fake-indexeddb.
  **v2 amendment (multi-tab, stakeholder edge case):** `revision` field
  (driver-owned monotonic bump on every put); `sync.ts` tab hub
  (BroadcastChannel + clientId echo suppression + focus/visibility
  reconciliation backstop); per-document session locks via Web Locks
  (`openDocument` → `edit` | `readonly` + `takeover()`; readonly sessions
  cannot save; saves serialized under the lock); stolen-session policy =
  auto-save dirty buffer as a copy record (never lose text); lock adapter
  injectable for node tests; graceful no-locks fallback. Two-tab integration
  tests over one fake-indexeddb + real BroadcastChannel.
  **DONE, verified by the lead (333/333 repo-wide at HEAD):** v2 contract
  landed with documented additive deviations (steal returns the acquisition;
  stolen event carries `copyId: null` when the buffer was clean;
  `saveContent` returns `false` for readonly/unknown; sessionless saves are
  the v1 single-tab path). Migration finding: the vanilla app never
  persisted the current document (runtime memo) and `mv:recent` holds no
  content — migration carries recents as URL-sourced placeholders only
  (documented limitation, no silent re-fetch). `FILE_SYSTEM_ACCESS.md`
  specifies the future disk driver behind the same interface. R8 integration:
  barrel import → `createDefaultDriver()` + `createDocumentRepository` with
  one `TabSyncHub` + lock adapter per tab; `openDocument(id)` →
  edit/readonly session + `takeover()`; run migration once after `init()`.
- [x] **Agent R8 — document management UI** — DONE, verified by the lead
  (359/359 unit, 39/39 e2e × 3 engines; lint 0/0). Sidebar = the repository:
  live list (incl. remote changes), create, select via edit/readonly
  sessions, rename (inline + pane head), remove (localized confirm), drag
  reorder + keyboard move (persisted), active-doc restore, `?url=`/`?file=`
  dedupe by source, `#d=`/upload/paste become records. Multi-tab UX:
  readonly banner + Take over, stolen → "Saved a copy" toast, live lists.
  **Finding:** pagehide flush alone loses the last debounce window on
  instant reload (browsers discard in-flight IDB transactions) — fixed with
  a synchronous `mv:doc-draft` localStorage snapshot + revision-guarded
  re-adoption at boot. AiPanel mounted from the topbar toggle; toasts
  bridged to the app region; labels promoted into the dictionaries.
  **Open item → R6:** the boot smoke e2e flapped once in full 3-engine runs
  (zero-console-error assertion; passed on three subsequent runs incl.
  chromium-only) — reproduce, capture the error, fix deterministically.
- [x] **Agent R6 — a11y + keyboard shortcuts** — DONE, verified by the lead
  (395/395 unit, 54/54 e2e, **3 consecutive full gate cycles clean**).
  Flake root cause: third-party content in the rendered doc (GitHub badge,
  font CSS) logs engine-specific network errors — not app code; the boot
  smoke now attributes console errors by origin (app-attributable still
  fails; uncaught exceptions via pageerror), 15/15 boot runs clean.
  Shortcuts: `?` cheat-sheet dialog + full map (⌘/Ctrl+O, ⌘+Alt+N,
  ⌘+I, ⌘+\, Alt+1/2/3, ⌘+Shift+C, ⌘+Alt+D, ?) from one source of truth,
  README EN/FA sections test-enforced in sync, Esc layering fixed
  (dialogs > AI panel > sidebar). A11y: dark-theme contrast tokens fixed
  (solid buttons now near-black text — intentional look change),
  scrollable-region keyboard access, skip link, list roving focus,
  reduced-motion, axe scans zero serious/critical across 5 states.

### Acceptance (EN+FA browser pass) — lead — DONE

- [x] Persistence: create → type → reload keeps content byte-for-byte ✓;
  AI-appended edit also persisted across reload (draft/revision guard) ✓.
- [x] Duplicates from migration: found (README ×2, sample-fa ×2 — two-tab
  boot race in legacy migration) → Agent R9 fixed (skip-if-exists + Web
  Locks serialization + self-healing `dropDuplicatePlaceholders` on boot) →
  verified self-healed live in the damaged browser.
- [x] README logo in preview: broken (pre-existing on the vanilla deploy
  too — 404) → R9 mirrors doc assets (`dist/public/logo.svg`) → renders
  (naturalWidth 150).
- [x] Multi-tab: covered by the two-tab e2e spec (readonly → takeover →
  stolen-copy, live sidebar sync in both tabs).
- [x] AI UX: loading → stream → visible tool activity (`edit_document` →
  done) → tool-executed edit lands in the document (direct-edit on).
- [x] Shortcuts + cheat sheet (⌘ glyphs, EN/FA), dark/light, RTL mirroring
  (Persian digits), skip link, contrast-fixed solid dark buttons.
- Final gates at merge HEAD: **402 unit / 60 e2e × 3 engines, lint clean,
  3 consecutive full cycles green.** Merging to main.
- [x] **Acceptance addition** — DONE: multi-document persistence + multi-tab
  scenarios verified in browser and via the two-tab e2e spec (autosave,
  order, migration-once, remove confirm, readonly/takeover/stolen-copy,
  live cross-tab sync — no data loss paths).
- [x] **Agent R6 — a11y + shortcuts pass** — DONE (see R6 entry above).
- [x] **Acceptance — merge to main** — DONE (`28d9a6f` React rewrite on
  `main`; CI + deploy green).

### Milestone: editor UX batch + AI capability (current, on `main`)

Stakeholder direction batch: line numbers in the editor, conflict-free
shortcuts (macOS/Windows/browser), selection-to-AI from the preview, an
adopt-vs-own decision on agent frameworks, and an editor selection toolbar
(build-vs-library).

- [x] **Agent W1 — editor line-number gutter** — DONE, verified by the
  lead (429/429 unit at final HEAD; all 15 gutter e2e specs green across
  engines in the lead's own run — the sole webkit failure was the
  pre-fix deep-link product bug, resolved on main by W8; live browser
  pass: wrap alignment pixel-exact, virtualized ~12 nodes at top, scroll
  round-trip, screenshot reviewed). Design: hidden mirror div as the wrap
  oracle (textarea = wrap authority; sub-pixel `getBoundingClientRect`
  heights), pure math in `lineNumbers.ts` (first-visual-row offsets,
  binary-search visible window +8px overscan, ch-based digit width),
  one measure per animation frame (rAF text changes + ResizeObserver width
  + font settle), `translateY(-scrollTop)` scroll lockstep, virtualized
  window so a 5k-line doc renders ~20 nodes per frame. Display-only
  contract proven: `aria-hidden`, `pointer-events: none` (wheel passes
  through, e2e-asserted), textarea remains THE scroll container with
  original semantics (scroll specs unchanged and green), `EditorApi`
  untouched, measurer injected for tests. Two measured finds fixed:
  Vite down-levels logical CSS insets to `:lang()` rules (a dir flip
  never moved the gutter) → `[dir]`-keyed physical insets; Firefox
  delivers the old document's scroll event before the replacing input →
  scrollTop reconciliation + clamp in the measure pass.
- [x] **Agent W2 — shortcut conflict audit + redesign** — DONE, verified by
  the lead (full gates green at rework HEAD: typecheck/lint/409 unit/build +
  78 e2e with only the known pre-existing webkit scroll flake; live browser
  pass: cheat sheet ⌘⌥O/⌘⌥⇧N/⌘⌥⇧K/⌘\/⌘⌥A/⌥1-3/⌘⌥X, ⌘⌥O opens the Open
  dialog, ⌘O inert, ⌘⌥A toggles the AI panel, ⌘I inert, ⌘⌥⇧K copies the
  link, ⌘⌥X cycles direction). Audited matrix with sources in
  `docs/SHORTCUTS.md`; reserved set test-encoded (`RESERVED_COMBOS`
  invariant, failing-first). Final map — every action stays reachable:
  Open ⌘⌥O, New ⌘⌥⇧N, Copy link ⌘⌥⇧K, Panel ⌘\, AI ⌘⌥A, Panes ⌥1/2/3,
  Direction ⌘⌥X, `?`/Esc unchanged. Moved off browser/OS-reserved combos:
  ⌘O (Open File), ⌘⌥N (Chrome split view + Finder Smart Folder), ⌘⇧C
  (DevTools Inspect), ⌘I (italic + Firefox Page Info), ⌘⌥D (macOS Dock).
  Lead validation catches: first rework pick ⌘⌥U = mac Chrome/Safari View
  Source → returned; plain K also disqualified (⌘⌥K = Firefox Web Console)
  → shipped ⌘⌥⇧K. Documented trade-off: Ctrl+Alt = AltGr on Windows
  international layouts (inherited from pre-existing ⌘⌥N/Alt+digit).
- [x] **Agent W3 — preview-selection → AI** — DONE, verified by the lead
  (435/435 unit at final HEAD; e2e green on all 3 engines in the lead's
  independent run; feature live-verified in browser). Select text in the
  preview → floating "Ask AI about this" pill (RTL-safe, mousedown-safe,
  keyboard operable, Escape-dismiss with foreign-layer yield) → AI panel
  opens with a visible removable excerpt chip (localized line range with FA
  digits + heading path) → send delivers ONE message = prompt +
  `<document_excerpt>` delimited as untrusted data with an explicit
  ignore-instructions rule (matching the agent protocol). Source anchoring
  without a renderer swap: `sourceAnchor.ts` recovers each top-level
  token's exact source span from marked's `raw` slices and pairs them to
  rendered blocks order-based + VERIFIED (disagreement ⇒ null, never a
  guess); selection range = union of touched blocks (block-level
  granularity; char-precise needs renderer support — proposal documented);
  fallback = nearest-heading path. Handoff via module queue (frozen
  AiPanel props), latest-payload-wins. **Lead validation catches:** (1)
  the spec's programmatic `addRange` selection is headless-unreliable →
  reworked to a real trusted-input mouse drag with per-engine repeat
  evidence; (2) third stale-server incident confirmed (foreign worktree's
  preview on 4173 served a build without the feature) — structural fix
  (`E2E_PORT` override) lands with the deep-link product fix.
- [x] **Agent W4 — agent-framework R&D** (branch `research/agent-frameworks`)
  — DONE (`ff76fca`, doc merged to `docs/agent-framework-research.md`):
  **Decision — KEEP our own agent loop; implement the v2 toolset.** No
  evaluated framework offers a pluggable text-protocol tool-calling strategy
  (all pass through native function calling), so adoption would regress the
  user-configured arbitrary-endpoint support or force re-implementing our
  parser inside the framework (+150–220 kB gzip). Runner-up: Vercel AI SDK
  v7 (isomorphic, Apache-2.0; adopt triggers documented). v2 toolset spec
  (§5): 7 tools — ranged/line-numbered `read_document`, `search_document`,
  `document_outline`, content-anchored `replace_text` (SEARCH/REPLACE raw
  bodies, whitespace-tolerant fallback, retryable errors), `insert_at_cursor`,
  staleness-validated `replace_range`, confirm-gated `replace_document`;
  step cap 3→8; pending-diff Apply/Discard cards; preview-selection exposed
  by prompt injection with line/heading anchors.
- [x] **Agent W5 — editor selection-toolbar R&D** — DONE
  (`docs/selection-toolbar-research.md`, merged): **Option B — keep the
  plain textarea; ZERO new dependencies.** RAC `Popover`+`Menu` anchored
  to a hidden 0×0 element at the selection (full APG menu semantics + RTL
  flipping free, verified in installed 1.21.1); caret/selection pixels
  from an owned mirror-div module shared with W1's gutter
  (`textareaGeometry.ts`); formatting as an owned pure
  `(text, sel, action) → {text, sel}` module (~150 lines; GitHub's MIT
  `@github/markdown-toolbar-element` + EasyMDE `_toggleBlock` as reference
  specs) written back through the controller's execCommand→setRangeText
  path — native undo + autosave preserved, frozen `EditorApi` untouched.
  Rich-text frameworks rejected on evidence: lossy markdown round-trip
  (TipTap #8134/#8314), multi-MB doc degradation, native-undo replacement,
  full-rewrite migration cost vs ~0 KB. Runner-up B′: `@floating-ui/
  react-dom` (+9.1 KB) only if the RAC standalone spike shows focus/
  Escape quirks; WYSIWYG escape hatch = CodeMirror 6. Default action set
  and dismissal/interaction spec in the doc (§ menu order 1–11).
- [x] **Agent W6 — v2 AI toolset implementation** — DONE, verified by the
  lead (own gates: unit suite green at final HEAD, build clean, 104 e2e +
  webkit axe flake isolated-green; LIVE browser pass with a v2-speaking
  mock provider: search_document → OK, replace_text raw-body → auto-applied
  → the edit LANDED in the document → one native undo step reverts; board
  note: the lead's first mock had a turn-detection bug — the v2 system
  prompt itself mentions every tool name, so turn detection must key off
  `TOOL RESULT (<tool>)` markers). Shipped: 7 tools (ranged line-numbered
  reads, search, ATX outline, content-anchored `replace_text` with raw
  SEARCH/REPLACE bodies + whitespace-tolerant fallback + nearest-line
  error anchors, insert-at-cursor, staleness-validated `replace_range`,
  confirm-gated `replace_document`); fence grammar = JSON header line +
  verbatim raw body (no \n escaping; forgiving parser, truncation
  tolerated); step cap 3→8; pending-diff cards with Apply/Discard,
  aria-live resolution, >200-line collapse; auto-apply ≤20 changed lines
  with direct-edit on; prompt +332 tokens (test-guarded < +400);
  DELETED: `append`, the 4-mode `edit_document` enum, the 12k head+tail
  clip. Bundle +5.7 kB gzip (≈half model-facing strings). **Big find —
  pre-existing product bug fixed (`3042347`): every agent write through
  the open panel silently no-op'd (React Aria modal marks outside content
  inert → focus() fails → execCommand reports success writing nothing);
  fixed with a withEditorAccess bridge (flushSync close → write → reopen
  in one task); platform caveat: Firefox's native undo cannot fully
  revert a multi-line execCommand splice (Chromium/WebKit revert in one
  press), e2e undo leg scoped accordingly.**
- [x] **Agent W8 — deep-link jump product fix + e2e hardening** — DONE,
  verified by the lead (own full gates green: 439/439 unit, 85/85 e2e on an
  isolated port; live browser check: deep link lands ~16px off — the
  heading's own margin — and stays; agent evidence: 20/20 webkit repeats,
  tolerance unchanged, broken-jump regression 6/6 red). Finding: the
  "webkit flake" was a REAL product bug — the hash jump landed correctly,
  then the README logo (no reserved layout box) reflowed the article ~73px
  after landing and nothing re-anchored (webkit's native anchoring
  unreliable); plus a rarer race scrolling a DETACHED subtree with the
  once-guard consumed (jump lost). Fix: effect B re-queries the live
  target and consumes the guard only on a real landing, with a bounded
  re-anchor window (100ms ticks, 3s cap, quiescence-closed, never
  re-opened by typing — R12 intact); README logo gets `height="96"`;
  the spec asserts the SETTLED end state + a deterministic drift repro
  (route-held logo released post-jump); a document-fetch hold makes the
  app jump load-bearing (browsers' deferred fragment scrolling masked a
  broken jump on fast boots). `E2E_PORT` overrides the Playwright port —
  third stale-server incident closed structurally (P3 entry resolved).
  Watch: one unreproducible unit-test failure in the agent's first
  post-merge run (not reproduced in 3+ full runs; lead's run green).
- [x] **Agent W7 — editor selection toolbar implementation** — DONE,
  verified by the lead (own gates 520/520 unit + 109 e2e ×3 engines with
  27/27 repeat evidence; post-merge main: 597/597 unit + 114 e2e green;
  live browser pass: drag-select floats the full 12-action menu at the
  selection, Bold wraps EXACTLY the pinned range (`br**own**` on a short
  drag — range fidelity proven), one native undo restores byte-for-byte,
  screenshot reviewed). Implementation per research Option B, zero new
  deps: `markdownActions.ts` pure toggle engine (43-case matrix:
  wrap/unwrap, intraword italic, link variants, per-line heading/list/
  quote toggles, fenced code blocks), sibling `caretGeometry.ts` over a
  shared extracted mirror base (`textareaMirror.ts` — gutter specs stayed
  green), RAC `Popover`+`Menu` anchored at a hidden element with
  document-direction RTL, 200ms settle with the range pinned at show,
  write-echo suppression, IME/scroll/blur/readOnly dismissal,
  `pointer: fine` phase 1. Controller gained additive `applyFormat`
  (frozen `EditorApi` untouched); every action = one native undo step
  (e2e + live-verified). Real-engine find fixed: WebKit parks an empty
  inline marker at the line edge → RTL anchors measured on the wrong
  side; zero-width-space marker participates in the flow. Bundle
  +6.8 kB gzip.

### Milestone: AI agent loop (done)

- [x] **Agent C4 — tool-agent loop (`src/ai/agent.ts`)** — DONE, verified by
  the lead. Provider-agnostic ```qalam fenced-JSON tool protocol
  (`read_document` / `edit_document`, max 3 executions per run), executor
  gates writes on the direct-edit toggle (OFF → read-only, agent suggests
  text in chat), replace-selection pinned to the range captured at send
  time. Removed the 5 per-message footer buttons, the quick-action chips and
  the dead `clip()`/`makeStreamSink`/`streamViaProvider` plumbing. Gates
  green (typecheck/lint/build, 96 unit tests incl. 19 new agent tests).
  Browser pass against a mock OpenAI SSE provider on the production build:
  direct-edit ON → tool-executed append landed in the textarea (+87 chars,
  no fence leakage in the chat bubble), OFF → document byte-identical.
  Panel visually clean — no removed-UI debris.
- [x] **Docs refresh (delegate)** — DONE: README agent-loop refresh
  (tool-editing UX, 96 unit tests, `ai/agent.ts` in the project structure)
  + `.idea/` .gitignore rider.
- [x] **Agent H1 — CI hotfix** — DONE (`53e7208`): the e2e job's transitional
  `if: hashFiles(...)` was invalid in a job-level condition, so GitHub
  rejected the whole workflow file at parse — every ci.yml run in history
  had failed with zero jobs, hidden behind the always-green deploy workflow.
  Gate removed; first real CI execution: quality + e2e jobs green alongside
  the Pages deploy.

### Milestone: collaborative AI writing (after migration)

- [~] Parallel batch on the TS codebase — file-disjoint ownership:
  - [x] **Agent C2 — `src/ai/` providers + settings** — DONE: `ChatProvider`
    over built-in / OpenAI-compatible / Anthropic-compatible (SSE parsers,
    token redaction, CORS header), settings persisted in `mv:ai`, 20 new
    vitest tests (55 total green)
  - [x] **Agent B2′ — integration in TS** — DONE, browser-verified: share
    dialog (content/source links, capacity toasts), `#d=` boot routing
    (query params take precedence, hash survives refresh), `#ai-btn` +
    `initAi()` wiring; vitest scoped to unit tests
- [x] **Final acceptance** — DONE on the production build: share dialog →
  copied `#d=` link → opened fresh → Persian doc + Mermaid render identically
  (doc titled "Shared document"); AI panel verified against a mocked
  OpenAI-compatible SSE server (stream → insert-at-cursor); builtin
  unavailable-explainer verified on non-capable browsers; e2e suite green
  post-integration. Site live, deployed by Actions from `main`.

## P2 — Stakeholder actions

- [x] **Flip Pages source to "GitHub Actions"** — DONE (deploy workflow ran
  green after the Node 22 fix; site live at
  `https://amirkabiri.github.io/markdown-viewer/`)
- [ ] **Repo metadata** — description + website + topics (suggestions in chat
  history).

## P3 — Backlog (do not forget, no date)

- [ ] e2e hygiene: a stale local `vite preview` squatting on the Playwright
  port (4173, `reuseExistingServer` outside CI) silently poisons gated runs
  with an old build — kill orphaned previews before gated e2e (lead
  finding, 2026-09-30; bit during W2 validation)

- [ ] Optional host allow-list for `?url=` fetches (audit finding #6)
- [ ] Drag & drop file-type filter (currently only size-capped)
- [ ] Dependency update cadence — `pnpm outdated` review quarterly
  (npm lockfile replaces the old CDN SRI re-hash chore)
- [ ] CSP `frame-ancestors` unenforceable via meta on Pages — revisit if host changes
- [ ] AI: document "collaboration mode" ideas (inline suggestions, diff-apply)
  as a future enhancement after provider layer proves out

## Working agreements

- **Division of labor (binding):** the lead plans, briefs, prioritizes, decides,
  verifies, integrates and communicates. **All implementation is done by
  subagents — including small fixes, brand assets and hotfixes.** No task is
  too small to delegate. The lead touches the tree only to integrate verified
  deliverables or to unblock a stuck agent, and discloses it when that happens.
- Package manager: **pnpm** (lockfile: `pnpm-lock.yaml`; CI uses
  `pnpm install --frozen-lockfile`; version pinned via package.json
  `packageManager` field).
- Continuous delivery: verified deliverable → immediate commit + push, one
  commit per deliverable, `tasks.md` updated in the same commit.
- `main` must always be deployable — no mid-refactor pushes to the live path.
- Parallel agents own disjoint files; ownership contracts live in module
  headers + frozen interface contracts issued by the lead.
- External LLM tokens are user-side secrets: never committed, never sent
  anywhere except the user-configured base URL.

---

## Done (recent)

- [x] Modular refactor — `js/*` ES modules + split CSS, browser-verified (e774bb5)
- [x] Built-in AI research — `docs/ai-research.md` (b87bd51)
- [x] Task board (f901a14)
- [x] Security hardening — SRI/CSP/boot-fix/size-cap (b4de880)
- [x] Initial release — split-pane viewer, Persian/RTL + Vazirmatn, Mermaid (194d155)
