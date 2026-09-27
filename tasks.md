# Task Board

Single source of truth for pending work. Update this file in the same commit that
delivers a task — the board must never drift from reality.

Status legend: `[ ]` pending · `[~]` in progress · `[x]` done (kept one milestone back, then pruned)

- [x] **Research: browser built-in AI APIs** — findings in
  `docs/ai-research.md` (Prompt API stable web Chrome 148; Summarizer/
  Detector/Translator stable 138; Writer/Rewriter/Proofreader origin-trial;
  Chromium-only; no certified `fa` — mitigations documented)

---

## P0 — Critical path (in flight)

- [x] **Modular refactor** — DONE, browser-verified. `app.js` → `js/{i18n,state,
  markdown,documents,workspace,ui,main}.js` (ES modules, `registerI18n()` for
  module-owned translations, ownership headers); `style.css` → `style/{base,
  markdown,ui}.css` (170/170 rules preserved); `updateCounts` lives in
  `state.js` (i18n→state is the only spine import — cycle/TDZ safety).
  Ownership contract: see each module's header + exports list in commit history.
- [~] **Parallel feature batch** — B1 (`js/share.js`) + C (`js/ai.js`) launched
  concurrently on the new layout; each owns exactly one new file.

## P1 — Next release: two features + integration

- [ ] **Share via URL (`js/share.js`)** — encode current editor content as a
  self-contained link: `#d=` fragment (never sent to any server), UTF-8-safe
  base64url, optional deflate via `CompressionStream` with format prefix,
  warn > 30k-char link, refuse > 300k. Pure-logic module + Node roundtrip
  tests. *(Agent B1, runs in parallel with C)*
- [ ] **AI assistant (`js/ai.js`)** — in-app assistant on browsers' built-in
  LLMs. Spec informed by `docs/ai-research.md` (read it first). Key decisions
  from research: Prompt API (`LanguageModel`) is the generator (stable web
  Chrome 148; streaming with cumulative-chunk guard); Summarizer for doc
  summary (Chrome 138); Rewriter is origin-trial-only → Prompt API fallback;
  Translator has no `fa` pair → honest unavailable state; never declare
  `expectedOutputs.languages: ['fa']`; mermaid output uses Latin node IDs with
  quoted labels; `downloadable` state gets a download button (user activation
  + progress UI); model output rendered in the panel must pass DOMPurify.
  Strict feature detection + graceful explainer when unavailable; on-device
  only — no network calls, no CSP change. *(Agent C, runs in parallel with B1)*
- [ ] **Integration pass** — share dialog + AI panel markup in `index.html`,
  `#d=` boot routing in `js/documents.js`, module wiring in `js/main.js`.
  *(Agent B2, after B1 + C land)*
- [ ] **Final acceptance pass** — encode Persian doc with Mermaid → open link in
  fresh tab → identical render; AI panel end-to-end where API available;
  regression matrix. Then commit + push.

## P2 — Blocked on stakeholder

- [ ] **Enable GitHub Pages** — Settings → Pages → Source: *Deploy from a
  branch* → Branch: `main`, path `/ (root)`. Site will go live at
  `https://amirkabiri.github.io/markdown-viewer/`
- [ ] **Repo metadata** — set description + website + topics
  (suggested description is in chat history; topics: `markdown`, `mermaid`,
  `rtl`, `persian`, `vazirmatn`, `github-pages`, `static-site`)

## P3 — Backlog (do not forget, no date)

- [ ] Optional host allow-list for `?url=` fetches (audit finding #6 — open
  client-side GET fetcher by design; document or restrict)
- [ ] Drag & drop file-type filter (currently only size-capped)
- [ ] CDN dependency bump cadence — re-verify pinned versions + regenerate SRI
  hashes quarterly (marked@12.0.2, dompurify@3.4.16, mermaid@11.17.2,
  highlight.js@11.9.0, vazirmatn@33.0.3)
- [ ] CSP `frame-ancestors` is unenforceable via meta tag on GitHub Pages —
  revisit if a supported host appears

## Working agreements

- Continuous delivery: every verified agent deliverable is committed and pushed
  immediately, one commit per deliverable, `tasks.md` updated in the same commit.
- `main` must always be deployable — no mid-refactor pushes.
- Parallel agents own disjoint files; ownership contracts live in each module's
  header comment after the refactor.
- `gh` CLI is not installed; Pages activation and repo settings are stakeholder actions.

---

## Done (recent)

- [x] Security hardening — SRI-pinned CDNs, CSP, `scrollToHash` boot fix,
  10 MB input cap, cached refs, pref enums, README Security section
  (commit `b4de880`, browser-verified: zero CSP violations, Mermaid/hljs/fonts OK)
- [x] Initial release — split-pane editor/viewer, Persian/RTL + Vazirmatn,
  Mermaid, TOC, recents, i18n (commit `194d155`)
