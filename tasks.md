# Task Board

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
- [ ] **Commit T2's workflows** (verify YAML; they activate once T1's scripts exist)

### Milestone: AI direct document editing (current)

- [~] **Agent C3 — direct-edit access + selection-aware chat** (`src/ai/**`):
  direct-edit toggle (AI writes into the textarea as it streams), pure
  `computeEdit` helper + unit tests, per-response buttons (insert / append /
  replace selection / replace document with confirm), native-undo-preserving
  edits via execCommand fallback chain, and **selection-aware chat**: select a
  section, type an instruction, the agent streams the edited section back into
  the same range (pure `buildSelectionMessages` prompt builder + tests).
- [ ] **Verify C3** — typecheck/lint/tests/build + browser pass (stream into
  textarea in FA, replace selection, undo behavior), commit + push.

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

- [ ] Optional host allow-list for `?url=` fetches (audit finding #6)
- [ ] Drag & drop file-type filter (currently only size-capped)
- [ ] Dependency update cadence — `pnpm outdated` review quarterly
  (npm lockfile replaces the old CDN SRI re-hash chore)
- [ ] CSP `frame-ancestors` unenforceable via meta on Pages — revisit if host changes
- [ ] AI: document "collaboration mode" ideas (inline suggestions, diff-apply)
  as a future enhancement after provider layer proves out

## Working agreements

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
