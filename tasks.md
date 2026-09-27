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
- [ ] **Agent P — Playwright e2e** — config + cross-engine smoke spec
  (chromium/firefox/webkit: app boots, markdown renders, Mermaid svg, no console
  errors), unblocks the gated CI e2e job.
- [ ] **Commit T2's workflows** (verify YAML; they activate once T1's scripts exist)

### Milestone: collaborative AI writing (after migration)

- [~] Parallel batch on the TS codebase — file-disjoint ownership:
  - [ ] **Agent C2 — `src/ai/` providers + settings** — `ChatProvider`
    interface; `BuiltInProvider` (Prompt API), `OpenAIProvider`
    (`{base}/chat/completions`, Bearer, SSE), `AnthropicProvider`
    (`{base}/v1/messages`, `x-api-key` + `anthropic-version` +
    `anthropic-dangerous-direct-browser-access`, SSE deltas); settings dialog
    (provider / baseUrl / model / token — token stored ONLY in visitor's
    localStorage with visible warning); vitest tests for SSE parsers +
    message mapping with mocked fetch.
  - [ ] **Agent B2′ — integration in TS** — share dialog + `#d=` boot routing,
    `#ai-btn` topbar button, panel wiring, `main.ts` hookup of `initAi()`/share.
- [ ] **Final acceptance** — e2e: share roundtrip (Persian + Mermaid → open link
  → identical render); AI panel with built-in provider where available +
  external provider against a mocked Anthropic/OpenAI endpoint; regression
  matrix; board update; push.

## P2 — Stakeholder actions

- [ ] **Flip Pages source to "GitHub Actions"** once `deploy.yml` lands
  (Settings → Pages → Build and deployment → Source: GitHub Actions). Replaces
  the earlier "deploy from branch" instruction — the workflow then publishes
  `dist/` on every push to `main`.
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
