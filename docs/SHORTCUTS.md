# Global Keyboard Shortcuts — Conflict Audit (macOS / Windows / browsers)

> Research date: September 2026. Compiled from Apple Support, Microsoft Support /
> Microsoft Learn, Google Chrome Help, Chrome DevTools docs, Mozilla (SUMO +
> firefox-source-docs), WebKit and Edge DevTools docs (source URLs inline and in
> [Sources](#sources)). Drives the `SHORTCUTS` table in `src/app/shortcuts.ts` —
> the cheat sheet, the global dispatcher and the README all render from that
> table, and the reserved-combo invariant is test-enforced
> (`shortcuts.test.ts`, `RESERVED_COMBOS` fixture).

## 1. Stakeholder requirement

"the shortcuts must be designed to have no conflict with macos, windows and
chrome shortcuts." Audit scope: macOS system shortcuts, Windows system
shortcuts, and the browsers Chrome, Edge, Firefox, Safari. Every action keeps a
working binding; bindings move where they collide.

## 2. Rules derived from the research

Three tiers of conflict emerged from the vendor docs:

1. **OS-reserved (hard).** Handled by the operating system before the browser
   ever sees the key — a web page can never win. Examples: ⌘⌥D toggles the Dock
   on macOS (Apple, *Mac keyboard shortcuts*); Ctrl+Alt+Del; the Win-key combos.
   Also macOS *menu key equivalents that every app carries* (⌘⌥H Hide Others,
   ⌘⌥M Minimize All, ⌘⌥W Close All) — the app menu consumes them first.
2. **Browser-reserved / browser-documented (hard for us).** Either the browser
   handles the combo before dispatching to the page (Chromium's tab/window
   commands: Ctrl+T/N/W, Ctrl+Shift+T/N/W, Ctrl+1…9) or the browser documents
   the combo as a user-facing feature of the page's own viewport (Ctrl+O open
   file, Ctrl+Shift+C DevTools Inspect, Alt+D address bar, ⌘⌥N Chrome split
   view on Mac, ⌘⇧D Safari Add to Reading List). A page can intercept *some* of
   these via `preventDefault` in some browsers, but binding them is still a
   conflict: the user's browser has taught their fingers a meaning, and in at
   least one audited browser the page cannot win. We treat "documented as a
   viewport feature" as reserved.
3. **Merely conventional (soft).** Combos a *convention* reserves even though
   no vendor reserves them: ⌘B / Ctrl+B and ⌘I / Ctrl+I are bold/italic in
   every editor, ⌘P / Ctrl+P prints, ⌘S / Ctrl+S saves. Hijacking these for
   unrelated actions is a usability bug even where technically interceptable.
   House rule: **never bind Mod+B / Mod+I / Mod+U / Mod+P / Mod+S to
   non-formatting or unrelated actions.**

Two scoping notes:

- **In-DevTools-only combos don't count.** DevTools documents internal
  navigation keys (Shift+? = DevTools settings, Ctrl+Alt+S = save all in Edge
  Sources, ⌥⌘A = Web Inspector Sources tab). They fire inside the DevTools UI,
  not the page viewport, so a page binding them is fine.
- **macOS Option+digit types dead characters** (¡™£ on US layouts) but Apple
  documents **no** Option+digit system shortcut, and Qalam's dispatcher
  `preventDefault`s modifier combos even inside text fields, so bare `Alt+1/2/3`
  are safe on all three OSes (verified against Apple's full shortcut list; the
  browsers bind tab switching to Ctrl/⌘+digit, not Alt+digit).

## 3. Conflict matrix — the audited (old) bindings

Legend: ✅ free · ⚠️ conventional clash · ❌ reserved clash (documented source).
`Mod` = ⌘ on macOS, Ctrl elsewhere (`matchesCombo`).

| Action (id) | Old binding | macOS | Windows | Chrome | Edge | Firefox | Safari | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Open dialog (`openDialog`) | `Mod+O` | ❌ ⌘O = Open (Apple); Safari/Chrome/Firefox Open File | ❌ browser Open File convention | ❌ Ctrl+O "Open a file from your computer" (Chrome Help) | ❌ Ctrl+O "Open a file" (Edge Help) | ❌ Ctrl+O Open File (Mozilla) | ❌ ⌘O Open File (Safari menu) | **MOVE** |
| New document (`newDocument`) | `Mod+Alt+N` | ⚠️ ⌘⌥N = New Smart Folder (Finder, Apple) | ✅ | ❌ ⌘⌥N = "Open split view" on Mac (Chrome Help) | ✅ | ✅ | ✅ | **MOVE** |
| Copy share link (`copyShareLink`) | `Mod+Shift+C` | ❌ ⌘⇧C = DevTools Elements (Chrome/Edge/Firefox on Mac); Finder "Computer window" | ❌ Ctrl+Shift+C = DevTools Inspect | ❌ DevTools Elements (Chrome DevTools docs) | ❌ "Open the Elements tool / Toggle Inspect Element Mode" (Edge DevTools docs) | ❌ "Pick an element from the page" (Firefox DevTools docs) | ⚠️ none documented | **MOVE** |
| Toggle sidebar (`toggleSidebar`) | `Mod+\` | ✅ (⌘⇧\ = Safari tab overview is a different combo) | ✅ | ✅ | ✅ | ✅ | ✅ | **KEEP** |
| Toggle AI panel (`toggleAiPanel`) | `Mod+I` | ⚠️ ⌘I = Italic (Apple text editing) / Get Info (Finder) | ⚠️ Ctrl+I = Italic (Microsoft) | ⚠️ italic convention | ⚠️ italic convention | ❌ Ctrl+I = Page Info (Mozilla) + italic | ⚠️ italic convention | **MOVE** (rule 3) |
| Editor only (`paneEditor`) | `Alt+1` | ✅ no Option+digit system shortcut (Apple) | ✅ | ✅ (tabs are Ctrl/⌘+digit) | ✅ | ✅ | ✅ | **KEEP** |
| Split view (`paneSplit`) | `Alt+2` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **KEEP** |
| Preview only (`panePreview`) | `Alt+3` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **KEEP** |
| Cycle direction (`cycleDir`) | `Mod+Alt+D` | ❌ ⌘⌥D = "Show or hide the Dock" (Apple) — the Dock wins, the page never sees the key | ✅ | ✅ (Alt+D address bar is a different combo) | ✅ (Alt+D address bar, no Ctrl) | ✅ | ✅ | **MOVE** |
| Cheat sheet (`cheatSheet`) | `Shift+?` | ✅ | ✅ | ✅ (Shift+? = DevTools settings fires only inside DevTools) | ✅ | ✅ | ✅ | **KEEP** |
| Close layer (`closeLayer`) | `Escape` | ✅ | ✅ | ✅ (Esc = stop loading / exit fullscreen; standard close, interceptable) | ✅ | ✅ | ✅ | **KEEP** |

## 4. Final binding map

The Qalam family is **`Mod+Alt+…`** (⌘⌥ on macOS, Ctrl+Alt elsewhere): the one
modifier neighborhood that is free on macOS, Windows and all four audited
browsers — Apple's own ⌘⌥ list (Dock, Hide Others, Minimize/Close All,
Downloads, Toolbar, Copy/Paste Style, Smart Folder…) and the browsers' ⌘⌥
DevTools/Bookmark-Manager/Split-View combos avoid most letters, and Windows
reserves none of Ctrl+Alt+letter (Microsoft: only Win+Alt variants exist). The
letters below are absent from every audited source list on both platforms.

| Action | Old | New (macOS) | New (Windows/browsers) | Rationale |
| --- | --- | --- | --- | --- |
| Open dialog | `⌘O` / `Ctrl+O` | `⌘⌥O` | `Ctrl+Alt+O` | Escapes the universal browser Open File combo; keeps the O mnemonic. |
| New document | `⌘⌥N` / `Ctrl+Alt+N` | `⌘⌥⇧N` | `Ctrl+Alt+Shift+N` | Chrome binds ⌘⌥N to split view on Mac; ⇧ clears it (⌘⌥⇧N is on no vendor list) while keeping the N mnemonic. |
| Copy link to this document | `⌘⇧C` / `Ctrl+Shift+C` | `⌘⌥U` | `Ctrl+Alt+U` | Escapes the DevTools Inspect combo on every browser; U = URL. |
| Toggle sidebar | `⌘\` / `Ctrl+\` | `⌘\` | `Ctrl+\` | No documented conflict on any platform. |
| Toggle AI assistant | `⌘I` / `Ctrl+I` | `⌘⌥A` | `Ctrl+Alt+A` | Ctrl/⌘+I is the italic convention (and Firefox Page Info); A = AI assistant. |
| Editor only | `⌥1` / `Alt+1` | `⌥1` | `Alt+1` | Safe everywhere; preventDefault stops macOS dead-character typing. |
| Split view | `⌥2` / `Alt+2` | `⌥2` | `Alt+2` | Same as above. |
| Preview only | `⌥3` / `Alt+3` | `⌥3` | `Alt+3` | Same as above. |
| Text direction (Auto/LTR/RTL) | `⌘⌥D` / `Ctrl+Alt+D` | `⌘⌥X` | `Ctrl+Alt+X` | ⌘⌥D toggles the macOS Dock (OS-reserved — the page cannot win); X = flip/swap. |
| Keyboard shortcuts | `?` | `?` | `?` | Character-matched, layout-independent; no viewport conflict (DevTools' Shift+? is DevTools-internal). |
| Close panel or dialog | `Esc` | `Esc` | `Esc` | Universal close convention; yields to React Aria layers first. |

Known accepted trade-off (documented, out of audit scope): on Windows,
**Ctrl+Alt is the AltGr alias** on many international layouts, so AltGr-typed
characters (ó, ñ, €…) share key codes with the Mod+Alt family. This trait is
inherited from the pre-existing Mod+Alt+N / Alt+digit bindings; the Persian
standard layout makes little use of AltGr letters. Revisit if European-layout
typing regressions are reported.

## 5. Reserved-combo fixture (test-enforced)

`src/app/shortcuts.test.ts` encodes the researched reserved set
(`RESERVED_COMBOS`) for both platforms and asserts no `SHORTCUTS` entry
collides. The fixture lists only combos documented by the sources below at
OS level or browser-viewport level; in-DevTools-only combos are excluded by the
scoping rule in §2.

## Sources

macOS / Safari:

- Apple — Mac keyboard shortcuts: <https://support.apple.com/en-us/102650>
  (⌘⌥D Dock, ⌘⇧C Computer window, ⌘I Italic/Get Info, ⌘O Open, ⌘⌥N Smart
  Folder, ⌘⌥H/M/W/S/T/L/P/F/V/Y, no Option+digit shortcuts)
- Apple — Safari keyboard shortcuts and gestures:
  <https://support.apple.com/guide/safari/keyboard-shortcuts-and-gestures-cpsh003/mac>
  (⌘⇧D Add to Reading List, ⌘⇧\ tab overview, ⌘1–9 tabs, ⌘P print)
- WebKit — Web Inspector keyboard shortcuts:
  <https://webkit.org/web-inspector/keyboard-shortcuts/>
  (⌥⌘I open/close Web Inspector, ⌥⌘C Console, ⌥⌘R reload from origin)

Windows / Edge:

- Microsoft — Keyboard shortcuts in Windows:
  <https://support.microsoft.com/en-us/accessibility/windows/keyboard-shortcuts-in-windows>
  (no Ctrl+Alt+letter system shortcuts; Win+Alt+D / Win+Alt+B are distinct;
  Ctrl+I italic; Alt+underlined-letter menu mnemonics)
- Microsoft — Keyboard shortcuts in Microsoft Edge:
  <https://support.microsoft.com/en-us/microsoft-edge/keyboard-shortcuts-in-microsoft-edge-50d3edab-30d9-c7e4-21ce-37fe2713cfad>
  (Ctrl+O open file, Ctrl+Shift+I DevTools, Ctrl+Shift+D save all tabs as
  favorites, Alt+D address bar, Ctrl+N/T/W/P/S/U)
- Microsoft Learn — Edge DevTools keyboard shortcuts:
  <https://learn.microsoft.com/en-us/microsoft-edge/devtools/shortcuts>
  (Ctrl+Shift+C / ⌘⇧C or ⌘⌥C = Elements / Inspect Element Mode, Ctrl+Shift+I,
  Ctrl+Shift+P, Ctrl+Shift+D, Ctrl+O/Ctrl+P open file in Sources)

Chrome:

- Google — Chrome keyboard shortcuts:
  <https://support.google.com/chrome/answer/157179>
  (Ctrl+O open file; ⌘⌥N split view on Mac / Shift+Alt+N on Windows;
  Ctrl+Shift+D bookmark all tabs; Ctrl+Shift+O Bookmark Manager; Ctrl+J
  downloads; Ctrl+D bookmark; Ctrl+1–9 tabs; Ctrl+L/Alt+D address bar; no
  Ctrl+Alt+letter shortcuts documented)
- Chrome for Developers — DevTools keyboard shortcuts:
  <https://developer.chrome.com/docs/devtools/shortcuts>
  (Ctrl+Shift+C = Elements; macOS ⌘⇧C or ⌘⌥C; Ctrl+Shift+I / ⌘⌥I; Ctrl+Shift+J / ⌘⌥J)

Firefox:

- Mozilla — Firefox keyboard shortcuts (SUMO):
  <https://support.mozilla.org/kb/keyboard-shortcuts-perform-firefox-tasks-quickly>
  (Ctrl+O open file, Ctrl+I Page Info, Ctrl+B bookmarks sidebar, Ctrl+Shift+D
  bookmark all tabs, Ctrl+J downloads, Ctrl+P print, Ctrl+S save, Ctrl+U source;
  accessed via the Wayback Machine snapshot of the page, 2024)
- Mozilla — Firefox DevTools keyboard shortcuts (firefox-source-docs):
  <https://firefox-source-docs.mozilla.org/devtools-user/keyboard_shortcuts/>
  (Ctrl+Shift+C pick an element / ⌘⇧C Inspect Element on macOS / ⌘⌥C picker on
  macOS, Ctrl+Shift+I / ⌘⌥I toolbox, Ctrl+Shift+J browser console,
  Ctrl+Alt+Shift+I browser toolbox, Ctrl+Shift+M responsive mode)
