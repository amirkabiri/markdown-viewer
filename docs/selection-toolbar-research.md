# Selection Toolbar in the Editor — Research Findings

> Research date: 2026-09-30. Compiled from vendor docs, GitHub source/issues, npm registry
> metadata, @mdn/browser-compat-data, and **local esbuild bundle measurements** (esbuild
> 0.28.2, `--bundle --minify`, gzip -9; react+react-dom baseline measured at 67.3 KB gzip).
> Qalam baseline build on this branch: main app chunk 760.7 KB min / 244.2 KB gzip
> (`pnpm build`). Feeds the selection-toolbar implementation — re-verify versions before
> adding any dependency.

## Decision

**Option B — keep the plain `<textarea>`, anchor a React Aria Components `Popover`+`Menu`
to a hidden zero-size element positioned at the selection, and implement formatting as an
owned ~150-line pure module** (`lib/markdownActions.ts`). **Zero new dependencies.**

- The popup reuses the app's existing a11y layer (`react-aria-components`, already used for
  menus/popovers app-wide) — full APG menu semantics (arrows, Home/End, typeahead, Escape)
  for free, plus automatic RTL placement flipping.
- The caret/selection pixel position comes from a **small mirror-div measurer we own**
  (`lib/textareaGeometry.ts`) — the in-flight line-number gutter needs the *same primitive*,
  so one shared module serves both. The npm caret libraries are stale (2018–2020) and
  single-purpose.
- Formatting logic is a pure function `(text, selStart, selEnd, action) → {text, selStart,
  selEnd}` written by us (GitHub's MIT `@github/markdown-toolbar-element` and EasyMDE's
  `_toggleBlock` are the reference specs), because the libraries either lack toggle/unwrap
  behavior, ship a parallel web-component UI that fights our RAC menu, or are anchored to a
  different editor architecture.
- Writes go through the controller's existing `execCommand('insertText')` →
  `setRangeText` mechanism, so **every toolbar action preserves the native undo stack**,
  fires `onDocChange` (autosave), and leaves the frozen `EditorApi` untouched.

**Runner-up:** Option B′ — same textarea, but position with `@floating-ui/react-dom`
(9.1 KB gzip, virtual-element API is purpose-built for caret anchoring). Adopt it only if
the RAC standalone-`Popover`+`Menu` spike reveals focus/Escape quirks (see risk note). We
would then own dismissal + keyboard wiring that RAC gives us today.

**Rejected:** Option A (rich-text framework). Disqualifying: markdown source round-trip is
lossy in the markdown-native frameworks (TipTap #8134/#8314; normalization of list spacing
and escapes), ProseMirror-based editors degrade on multi-megabyte documents (our ceiling is
10 MB), all of them replace the browser-native undo stack our AI-edit path is built to
preserve, and the migration rewrites editor + controller + AI panel + autosave for a feature
that needs none of it. See §1 for the full scoring.

**What would change the decision:** if stakeholders want *WYSIWYG editing of rendered
output* (live tables, syntax-highlighted code blocks, images) rather than a formatting
popup over source markdown, the right migration is **CodeMirror 6** (a source editor: text
stays the single source of truth, `coordsAtPos` is built in, large-document rendering is
viewport-based) — not a rich-text framework. That is a separate, larger initiative; this
document's Option B does not block it (the geometry + formatting modules are reusable).

---

## 1. Replace-the-editor frameworks — REJECTED

### 1.1 Scored comparison

Scores: 5 = fits Qalam as-is, 1 = actively hostile. Bundle figures measured locally
(includes the react+react-dom baseline the app already ships, except CodeMirror which needs
no React).

| Criterion | TipTap 3.31.4 / ProseMirror | Lexical 0.52.0 | Slate 0.126/0.127 | Milkdown 7.22 (PM+remark) | BlockNote 0.55 | CodeMirror 6 (source editor) | Plain textarea (status quo) |
|---|---|---|---|---|---|---|---|
| Bundle (gzip, measured) | 129.9 KB (core+react+starter-kit+pm) | 139.2 KB (lexical+react+markdown) | 62.4 KB (slate+slate-react) | 138.8 KB (core+commonmark+gfm+history; +React wrapper & slash/tooltip/block plugins on top) | 418.3 KB (core+react) | 160.5 KB (cm+lang-markdown) | 0 |
| Frozen `EditorApi` + imperative AI edits | 1 — AI must go through editor commands/transactions | 1 — AI must use `editor.update()` | 2 — transforms, but custom | 1 — PM transaction model | 1 — block-model commands | 4 — text paradigm survives; `dispatch` maps 1:1 | 5 |
| Native undo preserved | 1 — own history plugin; browser undo replaced | 1 — `@lexical/history` own stack | 2 — own `withHistory` | 1 — prosemirror-history | 1 | 3 — own history, but programmatic changes fold in via `userEvent` annotations; concept survives | 5 |
| Autosave integration | 3 — `onUpdate` gives JSON/HTML/markdown, not raw source | 3 | 3 | 3 — markdown out | 3 | 5 — `doc.toString()` is the source | 5 |
| 10 MB documents | 2 — PM degrades badly on multi-MB docs; author recommends per-chapter instances | 2 — degradation reports | 2 — DOM-bound, worse | 2 — inherits PM | 1 — block UI over huge docs | 5 — viewport-based rendering | 5 (browser-native textarea) |
| Markdown source fidelity | 2 — official markdown support (v3, Oct 2025) but round-trip is lossy (escaped syntax, marks on atoms, normalized list spacing) | 2 — `@lexical/markdown` converts through the model | 1 — serialization DIY | 4 — markdown-first (remark), best of class here | 3 — markdown import/export | 5 — text is text | 5 |
| RTL + IME | 3 — PM handles IME composition, but documented desync bugs (iOS/Android); RTL leaf-node bugs fixed over years | 3 — UNCERTAIN, no first-class RTL docs found | 2 — composition issues chronic | 3 — inherits PM | 3 | 4 — strong IME support; RTL has historical rough edges | 5 — browser-native |
| A11y | 3 | 3 (stated core focus) | 2 — mostly on you | 3 | 3 | 4 | 5 (native) + RAC around it |
| Migration risk | 5/5 — rewrites editor, controller, AI panel, autosave, e2e | 5/5 | 5/5 | 5/5 | 5/5 | 3/5 — contained swap behind controller | 0 |
| What we'd gain | real toolbar, tables, syntax highlighting, collaborative model | same, Node keys | low-level control | markdown-native editing | Notion-like blocks | same-source paradigm + real editing UX | — |

### 1.2 Load-bearing evidence

- **Lossy markdown round-trip (TipTap, the markdown story is its headline feature):**
  [tiptap#8134](https://github.com/ueberdosis/tiptap/issues/8134) — "Markdown serialization
  does not preserve escaped block syntax"; [tiptap#8314](https://github.com/ueberdosis/tiptap/issues/8314)
  — marks dropped on inline atom nodes during parse/serialize. Qalam's stored artifact IS
  the markdown source (autosave persists textarea text); any model-based editor normalizes
  the user's file on load/save. [TipTap markdown docs](https://tiptap.dev/docs/editor/markdown).
- **Large documents (ProseMirror, the substrate of TipTap/Milkdown/BlockNote):**
  [discuss.prosemirror.net 2498](https://discuss.prosemirror.net/t/performance-issues-with-prosemirror-and-chrome/2498)
  (Chrome degradation on large docs),
  [3679](https://discuss.prosemirror.net/t/very-long-delay-between-textinput-and-input-events/3679)
  (input lag in very large docs),
  [1017](https://discuss.prosemirror.net/t/different-parsing-strategy-for-large-documents/1017)
  (Marijn: structure UI so each chapter is its own PM instance),
  [1486](https://discuss.prosemirror.net/t/lazy-rendering-for-prosemirror/1486) (lazy
  rendering request). Qalam allows 10 MB documents.
- **Undo ownership:** prosemirror-history, `@lexical/history`
  ([docs](https://lexical.dev/docs/packages/lexical-history)), Slate `withHistory` all
  replace the browser stack; the AI panel's `execCommand('insertText')` strategy
  (`useEditorController.applyEdit`) exists *specifically* to merge AI edits into the
  **native** stack. Migrating means re-plumbing every AI write path for parity we already
  have.
- **Slate maintenance:** pre-1.0 since 2016 with "breaking changes … as minor version
  bumps" ([changelog policy](https://docs.slatejs.org/general/changelog)); React-version
  friction (e.g. [slate#5211](https://github.com/ianstormtaylor/slate/issues/5211)).
  UNCERTAIN: no single authoritative "maintenance status" statement found; the signal is
  the release pattern itself.
- **Lexical is still 0.x** (0.52.0, npm, 2026-09-28) — Meta-backed and production-proven,
  but our measured "hello markdown editor" is 139 KB gzip, i.e. **+57% on the main chunk**.
- **Milkdown** is the most honest markdown-native option (remark-based; 138.8 KB gzip
  measured for core+commonmark+gfm+history) but inherits PM's document-size behavior and
  adds a plugin system on top.
- **BlockNote** (418 KB gzip measured) is a block/Notion paradigm — wrong shape for a
  source-markdown document app.

**Verdict:** reject the class for this feature and for Qalam's editor pane generally. The
benefit (a real formatting toolbar) is achievable on the textarea at ~0 KB; the costs
(fidelity, size, undo, migration) are structural.

---

## 2. Keep-the-textarea path — positioning primitives

### 2.1 Caret/selection pixel coordinates inside a textarea

A `<textarea>` exposes no geometry for its text; the standard technique is a hidden
"mirror" div carrying the textarea's computed font/padding/width/`dir`/`white-space`, with
the text up to the offset plus a marker span whose `getBoundingClientRect()` gives the
point. The line-numbers feature (`feat/editor-line-numbers`) needs per-line tops from the
same mirror — **one shared module** (`lib/textareaGeometry.ts`) serves both: e.g.
`measureOffset(el, index) → {x, y}` and `measureLines(el) → lineTops[]`.

| Option | Last publish | TS types | Deps | Assessment |
|---|---|---|---|---|
| `textarea-caret` (component/textarea-caret-position) 3.1.0 | 2018-02-20 | via `@types/textarea-caret` | 0 | The classic (~100 LOC). Repo maintenance questions unanswered since ~2020 ([#28](https://github.com/component/textarea-caret-position/issues/28), [#57](https://github.com/component/textarea-caret-position/issues/57)) |
| `caret-pos` 2.0.0 | 2020-06-02 | yes | 0 | Maintained-ish; broader API (caret + offset within contenteditable) |
| `text-caret-pos` 1.0.1 | 2020-07-15 | no | 0 | Fork of the above family |
| **Own mirror-div module (~60 LOC)** | — | n/a | 0 | Recommended. We already must build line-level measurement for the gutter; caret point is the degenerate case. No third-party risk, trivially testable with jsdom + a font-mock |

Even the maintained packages would only give us the caret *point*; the gutter needs line
rects regardless, so the shared module is on the critical path anyway.

### 2.2 Anchoring the popup — React Aria (recommended) vs Floating UI

| | **RAC `Popover` + hidden anchor (recommended)** | `@floating-ui/react-dom` 2.1.9 / `@floating-ui/dom` 1.8.0 |
|---|---|---|
| Anchoring to an arbitrary point | Supported on our installed version: `Popover.triggerRef` ("only required when used standalone") + `isOpen` — the documented **Custom anchor** pattern ([Popover docs](https://react-aria.adobe.com/Popover)). Anchor = real 0×0 `<div>` positioned at the caret inside the editor wrapper (verified: RAC 1.21.1 `PopoverProps.triggerRef?: RefObject<Element \| null>`; positioning calls `triggerRef.current.getBoundingClientRect()`) | First-class **virtual element**: a plain `{ getBoundingClientRect(): DOMRect }` object ([virtual elements docs](https://floating-ui.com/docs/virtual-elements)) — no hidden div needed |
| Menu keyboard semantics (arrows/Escape/typeahead) | Free — render RAC `Menu` inside the `Popover`. Verified in 1.21.1 dist: `Menu` closes via `props.onClose \|\| triggerState?.close` (optional chaining — no `MenuTrigger` required), `FocusScope` + `useMenu` provide APG behavior. RAC 1.21.1 even ships context-menu groundwork (`trigger === 'contextMenu'` → offset 0 in `MenuTrigger`; [PR #10237](https://github.com/adobe/react-spectrum/pull/10237)) | You build it (headless `Menu` from RAC can still be dropped into the floating div — but then why Floating UI) |
| Reposition on scroll/resize | Free — `useOverlayPosition` repositions on resize/scroll ([hook docs](https://react-spectrum.blob.core.windows.net/reactspectrum/3facf8482ae0c546f85801571cede8fdc1659172/docs/react-aria/useOverlayPosition.html)) | Free — `autoUpdate` |
| RTL | Automatic (RAC derives direction from locale/`dir`; placement flips) | Manual (`placement: 'bottom-start'` vs `'bottom-end'` per dir) |
| Dismissal | `shouldCloseOnInteractOutside`, focus-scope Escape handling | Own `onDismiss` wiring (RAC overlays still available) |
| Cost | 0 KB — already in the bundle | +9.1 KB gzip (`@floating-ui/react-dom`) |

**Forward-compat note (verified, slightly odd):** the RAC docs today document
`Popover.getTargetRect(target: Element) => DOMRect | null | undefined` — "Useful for
positioning relative to a specific point such as the mouse cursor (e.g. context menus) or
text selection" — and the [react-aria-components@1.19.0 release notes](https://github.com/adobe/react-spectrum/releases/tag/react-aria-components%401.19.0)
mention it. However, the string is **absent from the published 1.19.0 and 1.21.1 tarballs
and from GitHub `main` `Popover.tsx`** (grep-verified 2026-09-30; npm `latest` = 1.21.1,
3.0 nightlies in flight). UNCERTAIN which release will ship it. Impact: none for the
recommendation — when it lands, the hidden anchor div is replaced by one function; the
integration below is unchanged otherwise.

### 2.3 Detecting selection changes (gating input)

Per [@mdn/browser-compat-data](https://github.com/mdn/browser-compat-data):
`selectionchange` fires **on the textarea itself** in Chrome/Edge 127+ (2024), Firefox 92+
(2021), Safari/iOS 18+ (2024). Document-level `selectionchange` is universal (Chrome 11+,
Firefox 52+, Safari 5.1+) and reaches text controls — the robust pattern is a document-level
listener that checks `document.activeElement === textarea`, optionally upgraded to the
element-level event when available. (`keyup`/`mouseup` listeners are the belt-and-braces
fallback.)

---

## 3. Markdown formatting actions — owned pure module (recommended)

### 3.1 Library scan

| Candidate | Status | Fit |
|---|---|---|
| `@github/markdown-toolbar-element` 2.2.3 | MIT, 0 deps, TS types, last publish 2024-03-01 ([npm](https://registry.npmjs.org/@github/markdown-toolbar-element), [repo](https://github.com/github/markdown-toolbar-element)) | Best reference. Web-component toolbar (842 LOC) bound via `for="textarea_id"`; writes via `execCommand('insertText')` with full-value fallback (source lines 440–498) — same undo-preserving mechanism as ours. **No toggle/unwrap** (applies style only), and it ships its own Toolbar UI/focus system (WAI-ARIA toolbar pattern) that would fight our RAC `Menu`. Use as spec, not dependency |
| EasyMDE 2.21.0 (2026-05-03, MIT) | Actively published | Wrong architecture (full CodeMirror-5 editor pane). Its `_toggleBlock` (`src/js/easymde.js:1324`) is the best **toggle-semantics** reference: detect active style via cursor context → unwrap with regex; else wrap and strip stray markers from the selection |
| CodeMirror 6 `@codemirror/lang-markdown` | Maintained | Language support only — no formatting commands; commands are trivial to write ourselves against the pure module |
| `markdown-it`/`marked` ecosystems | — | Parsers, not editors — out of scope |

### 3.2 Recommendation

`src/lib/markdownActions.ts` — pure module, ~150 lines + tests:
`applyAction(text: string, selStart: number, selEnd: number, action: FormatAction, opts?: {numberedSeed?: number}): {text: string; selStart: number; selEnd: number}`.
No DOM access → trivially unit-testable (vitest) incl. RTL text, CRLF-free guarantees, and
edge cases (empty selection, selection mid-marker, nested markers).

The controller applies the result through one shared write primitive
(`writeRange(el, start, end, newText, selStart, selEnd)` = `setSelectionRange` →
`execCommand('insertText')` → `setRangeText` fallback — extracted from the existing
`applyEdit` so **native undo and autosave behavior are byte-identical** for AI edits and
toolbar actions).

### 3.3 Behavior specs per action (concrete)

Common wrap algorithm (bold `**`, italic `*`, strikethrough `~~`, inline code `` ` ``):

1. **Unwrap-in-place:** if `text` immediately before/after the selection is the marker
   (`text.slice(s-n, s) === m && text.slice(e, e+n) === m`) → remove both markers; select
   the inner text. (Pressing the action again = toggle off.)
2. **Strip-from-selection:** else if the selected text *starts and ends* with the marker
   (and `selection.length ≥ 2n`) → remove the markers from the selection.
3. **Wrap:** else insert `m + selected + m`. Trim leading/trailing whitespace out of the
   wrap (`trimFirst` in GitHub's spec). On empty selection, insert `mm` and place the
   cursor inside. Use `*` for italic (not GitHub's `_`): CommonMark intraword `_` does not
   emphasize; `*` does ([CommonMark emphasis](https://spec.commonmark.org/0.31.2/#emphasis-and-strong-emphasis)).
4. Multi-line selection of an inline marker: wrap the whole selection once (one undo step).

- **Bold** `**`; **Italic** `*`; **Strikethrough** `~~`; **Inline code** `` ` `` — as above.
  Inline code with a multi-line selection becomes a **fenced block** instead: ensure blank
  line before/after (`surroundWithNewlines`, GitHub spec), wrap in ```` ``` ````.
- **Link** — not a toggle, three cases:
  - plain text selected → `[text](url)`; select the `url` placeholder so typing replaces it;
  - selection looks like a URL (`^https?://`, GitHub's `scanFor`) → `[](selected-url)` with
    the cursor on the empty label;
  - empty selection → `[](url)` with `url` selected.
  Unwrap case: if the selection sits inside an existing `[…](…)` (scan back for `[`, forward
  for matching `)`), strip the syntax → plain text.
- **Heading (H2/H3)** — per-line, multiline-aware: expand selection to whole lines; if every
  line already has exactly `## ` (resp. `### `) → remove; if lines carry another ATX level →
  replace with the target level; else add. Keep existing leading indentation
  (`^(\s*)` preserved).
- **Bullet list** `- ` — per-line toggle: if every non-empty line already prefixed → remove
  all; else add to each line. Nested markers: strip one level per toggle-off
  (match `^(\s*)- ` → remove just the `- `).
- **Ordered list** `1. ` — same as bullets; on add, number lines sequentially (`1.` `2.` …
  within the selection); on remove, strip `\d+[.)] `.
- **Task list** `- [ ] ` — per-line toggle like bullets; toggle-off strips `- [ ]` and
  `- [x]` alike.
- **Blockquote** `> ` — per-line toggle; toggle-off removes one `>` level
  (`^(\s*)>` + optional space).
- **Code block** — fence selection: blank-line padding + ```` ``` ```` above/below.

Selection preservation after the action (so repeated action toggles, and typing continues
naturally) is part of the returned `{selStart, selEnd}` — the spec above defines it per
case; EasyMDE's cursor bookkeeping (start/end adjusted by marker length) is the model.

These same pure functions can later back keyboard shortcuts (⌘B/⌘I) — `src/app/shortcuts.ts`
currently has no conflicts (⌘B/⌘I unbound; Alt+1/2/3 are taken, so avoid those for
headings).

---

## 4. Interaction design precedents & pitfalls

Gates (established product behavior — Medium-style bubble toolbars; documented dismissal
conditions in [assistant-ui's SelectionToolbar](https://www.assistant-ui.com) and
[Material Design menus](https://m3.material.io/components/menus/overview)):

| Event | Behavior |
|---|---|
| Selection becomes non-empty | Wait ~150–300 ms after the last selection change, then show (debounce prevents flicker during drag-select). Exact product timings are not published — UNCERTAIN; treat 200 ms as the default |
| Selection collapses (`selectionchange`) | Hide |
| Textarea or editor pane scrolls | Hide (simplest, Medium-like). RAC would reposition on scroll if asked — but repositioning under a moving finger feels worse than dismissal |
| Press/click anywhere in the textarea | Hide (interacting = new selection intent) |
| `Escape` | Hide (RAC `Menu`/overlay handles it) |
| Window blur / readOnly document | Hide / never show |
| **IME composition start** | Hide, and suppress showing until `compositionend` (+ trailing `keyup`) — guard every `selectionchange` with the composition flag. Sources: [MDN `isComposing`](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/isComposing), [Square: composition browser events](https://developer.squareup.com/blog/understanding-composition-browser-events/), [stum.de IME pitfalls](https://www.stum.de/2016/06/24/handling-ime-events-in-javascript/); real-world breakage: [foundryvtt#2685](https://github.com/foundryvtt/foundryvtt/issues/2685) |
| Resize / zoom | RAC repositions the open popover automatically |

Pitfalls specific to a textarea:

1. **Focus vs selection:** opening an RAC `Menu` moves focus out of the textarea (FocusScope).
   The selection *value* survives (`selectionStart/End` persist), but the write primitive
   needs focus — so on `onAction`: `el.focus()` → `el.setSelectionRange(start, end)` →
   `writeRange(...)`. Never rely on `preventDefault`-on-pointerdown tricks; they fight RAC's
   focus management. (The menu, once focused, reading a *stale* selection is the actual bug
   to avoid — capture the range at menu-open and reuse it, mirroring `pinnedRange` in
   `applyEdit`.)
2. **Selection highlight dimming:** unfocused textareas dim their selection in some engines;
   a `::selection` rule scoped to the editor keeps it legible while the menu is open
   (`:has(:focus-within)`-free, plain CSS).
3. **Menu overlapping the caret/selection:** only show on non-empty selections; `offset` 8–12
   px, placement above the selection-start anchor, RAC `shouldFlip` handles edges.
4. **Mobile:** iOS/Android native selection handles + callout occupy the same pixels; a
   floating bar near mid-selection collides with them. Precedent: defer on coarse pointers —
   phase 1 gate the feature to `matchMedia('(pointer: fine)')`; phase 2 places the menu below
   the selection or as a bottom sheet. Also note element-level `selectionchange` only landed
   in Safari 18 — the document-level fallback (§2.3) is required on mobile.
5. **RTL:** the anchor is computed in pixel space from the mirror div (dir-agnostic); RAC
   flips menu placement/arrow-key order from the app direction automatically — consistent
   with the app-wide RAC choice recorded in `docs/uikit-research.md`.

---

## 5. Integration sketch (Option B)

No changes to `EditorApi` (`src/features/editor/api.ts` stays frozen). All changes are
additive inside `src/features/editor/` plus two pure modules in `src/lib/`.

```
src/lib/textareaGeometry.ts        NEW  shared mirror-div measurer
                                        measureOffset(el, index) → {x, y}      (toolbar anchor)
                                        measureLineTops(el) → number[]          (line-number gutter)
                                        (recompute on: input, resize, dir/lang change, fonts.ready)

src/lib/markdownActions.ts         NEW  pure formatting (spec in §3.3) + vitest suite

src/features/editor/useEditorController.ts
                                   +    extract writeRange(el, start, end, text, selStart, selEnd)
                                        from applyEdit's body (execCommand insertText →
                                        setRangeText fallback — identical to today);
                                        applyEdit refactored to call it (no behavior change);
                                        new applyFormat(action): reads el selection, calls
                                        markdownActions.applyAction, writeRange, then the existing
                                        textRef/setText/notifyDocChange block → autosave + preview
                                        stay live; native undo gains one entry per action.

src/features/editor/useSelectionToolbar.ts   NEW   gating state machine:
                                        document-level 'selectionchange' (+ activeElement check;
                                        element-level when available), keyup/mouseup;
                                        200 ms debounce; hide on collapse/scroll/press/Escape/
                                        compositionstart/blur-outside/readOnly;
                                        exposes {open, range, anchorRect} — anchorRect from
                                        textareaGeometry at selection START.

src/features/editor/SelectionToolbar.tsx     NEW   <div class=anchor> (0×0, absolutely
                                        positioned at anchorRect inside the editor wrapper)
                                        + <Popover triggerRef={anchorRef} isOpen=… shouldCloseOnInteractOutside>
                                        + <Menu onAction=key → controller.applyFormat(key)>
                                        MenuItems from a declarative list (i18n labels via t(),
                                        <Keyboard> hints for future ⌘B/⌘I).

src/features/editor/Editor.tsx     +    render <SelectionToolbar controller=… dir=…/> next to
                                        the textarea (wrapper div becomes position:relative).
```

Sequencing with the line-numbers feature: land `textareaGeometry.ts` with (or before) the
gutter — the toolbar consumes it read-only. Bundle cost: **0 new dependencies**; one small
chunk. CSP: no change (no new origins; RAC renders existing in-app DOM).

Spike-first risks (1 day): (a) standalone `Popover`+`Menu` without `MenuTrigger` — verified
plausible in the 1.21.1 dist (optional-chained trigger state), but confirm Escape/outside
close + focus restore in a spike; fallback = drive RAC's headless hooks
(`useMenuTriggerState` — `react-stately` is already a direct dependency) or switch
positioning to `@floating-ui/react-dom` (Option B′). (b) 10 MB document: debounce
measurement, measure only the selection-start line (mirror text up to that offset), never
the whole document per event.

---

## 6. Proposed default action set (menu order)

| # | Action | Markdown behavior (spec §3.3) |
|---|---|---|
| 1 | Bold | toggle `**…**` |
| 2 | Italic | toggle `*…*` (intraword-safe) |
| 3 | Strikethrough | toggle `~~…~~` |
| 4 | Inline code | toggle `` `…` ``; multi-line selection → fenced block |
| 5 | Link | `[text](url)` with `url` placeholder selected; URL-in-selection and unwrap cases per §3.3 |
| 6 | Heading | submenu or cycle H2 → H3 → none (per-line, multiline-aware; H1 discouraged in docs) |
| 7 | Bullet list | toggle `- ` per line |
| 8 | Numbered list | toggle, renumber `1.`–`n.` per line |
| 9 | Task list | toggle `- [ ] ` per line |
| 10 | Blockquote | toggle `> ` per line |
| 11 | Code block | fence selection with blank-line padding |

Phase 1 shows items 1–5 (inline set, the stakeholder's examples); 6–11 land with the
line-numbers release since they share the geometry module. Phase 1 desktop-only
(`pointer: fine`).

---

## 7. Sources

**Qalam code (worktree):** `src/features/editor/Editor.tsx`, `api.ts`,
`useEditorController.ts`, `src/app/shortcuts.ts`, `package.json`
(`react-aria-components ^1.21.1`, `react-stately ^3.50.0`), `docs/uikit-research.md`.

Frameworks:
- https://tiptap.dev/docs/editor/markdown · https://github.com/ueberdosis/tiptap/issues/8134 · /issues/8314 · https://github.com/ueberdosis/tiptap/discussions/5793
- https://discuss.prosemirror.net/t/performance-issues-with-prosemirror-and-chrome/2498 · /t/very-long-delay-between-textinput-and-input-events/3679 · /t/different-parsing-strategy-for-large-documents/1017 · /t/lazy-rendering-for-prosemirror/1486
- https://lexical.dev/docs/packages/lexical-history · https://www.npmjs.com/package/@lexical/markdown · https://github.com/facebook/lexical/tree/main/examples/markdown-editor · https://emergence-engineering.com/blog/lexical-stress-test
- https://docs.slatejs.org/general/changelog · https://github.com/ianstormtaylor/slate/issues/5211
- npm registry metadata (versions/publish dates) for `@tiptap/*`, `lexical`, `slate`,
  `@milkdown/core`, `@blocknote/*`, `codemirror`, `@codemirror/lang-markdown`,
  `textarea-caret`, `caret-pos`, `text-caret-pos`, `@github/markdown-toolbar-element`,
  `easymde`, `react-aria-components` (fetched 2026-09-30).
- Bundle sizes: local esbuild 0.28.2 measurements, `/tmp/sizecheck` (method in header);
  `@milkdown/core` via bundlephobia.

Positioning:
- https://react-aria.adobe.com/Popover (Custom anchor pattern; `triggerRef`; `getTargetRect` doc-vs-dist discrepancy)
- https://react-spectrum.blob.core.windows.net/reactspectrum/3facf8482ae0c546f85801571cede8fdc1659172/docs/react-aria/useOverlayPosition.html
- https://github.com/adobe/react-spectrum/discussions/6117 (context-menu/arbitrary-point menu request) · /pull/10237 (`MenuTrigger` `trigger="contextMenu"`) · /releases/tag/react-aria-components%401.19.0
- https://floating-ui.com/docs/virtual-elements
- https://github.com/component/textarea-caret-position (issues #28, #57)
- @mdn/browser-compat-data: `HTMLTextAreaElement.selectionchange_event` (Chrome/Edge 127,
  Firefox 92, Safari 18) and `Document.selectionchange_event` (universal) ·
  https://developer.mozilla.org/en-US/docs/Web/API/Document/selectionchange_event

Formatting:
- https://github.com/github/markdown-toolbar-element (+ `src/index.ts` lines 87–117 style
  table, 440–498 write mechanism) · https://github.github.com/markdown-toolbar-element/
- EasyMDE 2.21.0 npm tarball, `src/js/easymde.js` `_toggleBlock` (line 1324)
- https://spec.commonmark.org/0.31.2/#emphasis-and-strong-emphasis

Interaction:
- https://www.assistant-ui.com (SelectionToolbar dismissal spec) ·
  https://m3.material.io/components/menus/overview
- https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/isComposing ·
  https://developer.squareup.com/blog/understanding-composition-browser-events/ ·
  https://www.stum.de/2016/06/24/handling-ime-events-in-javascript/ ·
  https://github.com/foundryvtt/foundryvtt/issues/2685
