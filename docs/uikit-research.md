# UI Kit for the React Rewrite — Research Findings

> Research date: September 2026. Compiled from vendor docs, npm registry metadata,
> and bundle-size measurements (source URLs inline). Versions re-verified against
> the npm registry on 2026-09-27. Feeds the React 19 AI-panel implementation —
> re-verify version numbers before adding the dependency.

## Decision

**React Aria Components (Adobe) — `react-aria-components` — pin `^1.21.1`.**

Headless/unstyled, WAI-ARIA-APG-driven components with the strongest reputation
for accessibility and internationalization of any React kit. It wins the
stakeholder's tie-break order (a11y quality > RTL > styling freedom > adoption)
outright: it is first on a11y AND first on RTL, while remaining unstyled so our
bespoke CSS-custom-property design language survives untouched.

Runner-up: **Radix UI Primitives** (`radix-ui` umbrella, `1.6.7`; per-primitive
packages still published, e.g. `@radix-ui/react-dialog@1.1.23`) — the fallback if
the bundle budget is blown, and the safest "fame" pick. **Base UI**
(`@base-ui/react@1.8.0`, stable since Dec 2025) is the one to watch from the
MUI/Radix lineage. **Ark UI** and **Headless UI** were evaluated and passed over
(brief notes below).

Why React Aria Components over the default-expected Radix, in three points:

1. **RTL is automatic, not manual.** React Aria derives text direction from the
   *locale*, and by default reads the locale from the `lang` attribute of
   `<html>` (`useLocale`). Qalam mirrors EN⇄FA by flipping `lang`/`dir` on
   `documentElement` — with React Aria every primitive (menu arrow keys, popover
   placement, typeahead) follows with zero provider plumbing. Radix and Base UI
   explicitly do **not** read the document `dir`: both require a manually synced
   `DirectionProvider` wrapper (Radix docs: "You need to use `DirectionProvider`
   if you were relying on `dir` attribute inheritance from document"; Base UI's
   provider "does not affect HTML and CSS"; Radix issue #3830 asking for
   auto-detection is still unresolved).
2. **Accessibility depth.** React Aria is Adobe's accessibility engineering
   distilled: APG-aligned roles, complete focus management, keyboard/typeahead,
   and i18n (translations, locale-aware formatting) baked in. It is the kit that
   a11y-first teams default to; the others are *also* good, but React Aria is the
   benchmark.
3. **Styling freedom without lock-in.** Components ship zero styles; they expose
   `className`, render props, and `data-*` state attributes (`data-focused`,
   `data-selected`, …). That composes cleanly with our light/dark CSS custom
   properties and full logical-property mirroring. Headless UI, by contrast, is
   too small (no Tooltip, no Toast, no Select — its Listbox covers selects only),
   and Ark/Base UI, while fine, lose the tie-break on a11y track record and RTL
   ergonomics respectively.

Accepted trade-off: **bundle weight**. React Aria Components is the heaviest of
the four (whole-package ~268 KB gz before tree-shaking vs ~63–290 KB for the
others; Radix is per-primitive, e.g. its Dialog is ~12.6 KB gz). We only use
~9 component families and the library tree-shakes per component, so the real
cost is a fraction of that — but it must be measured in CI once the panel lands
(see Consequences).

## 1. Comparison table

| Criterion | React Aria Components 1.21.1 | Radix Primitives (radix-ui 1.6.7) | Base UI 1.8.0 | Ark UI 5.39.2 | Headless UI 2.2.10 |
|---|---|---|---|---|---|
| WAI-ARIA pattern quality | Best-in-class; APG + Adobe a11y team; auto focus/typeahead/labels | Excellent; APG-aligned, battle-tested via shadcn/ui | Excellent; APG-aligned, ex-Radix/MUI team; a11y fixes nearly every release | Very good; Zag.js state machines | Good but minimal surface |
| Keyboard breadth | Broadest (incl. typeahead, collection keyboarding, IME) | Broad for covered patterns | Broad; Accordion keyboard aligned to APG (v1.6.0) | Broad | Basic |
| RTL / dir support | **Automatic from locale; inherits `<html lang>`**; `I18nProvider` to override | Manual `Direction.Provider dir=…`; does NOT read document dir (#3830 open) | Manual `DirectionProvider`; "does not affect HTML and CSS" | `dir` prop on `Provider`/per component; manual | No direction API (relies on CSS logical properties) |
| Styling | Unstyled; `className` + `data-*` states + render props | Unstyled; `className` + data-state attrs | Unstyled; `className` + `data-*` states + CSS keyframe vars | Unstyled; parts + machine context | Unstyled; Tailwind-oriented |
| Bundle (min+gz, whole pkg, pre-tree-shake)* | ~268 KB (975 KB min) | ~12.6 KB for react-dialog; ~40+ tiny pkgs; umbrella 1.6.7 tree-shakes | ~143 KB (446 KB min) | ~290 KB (1.05 MB min) | ~63 KB (209 KB min) |
| React 19 today | Yes — peer `^16.8 \|\| ^17 \|\| ^18 \|\| ^19.0.0-rc.1` | Yes — peer `…\|\| ^19.0`; June 2026 fixed a React 19 re-render loop (Toast) | Yes — peer `^17 \|\| ^18 \|\| ^19` | Yes — peer `>=18` | Yes — peer `^18 \|\| ^19` |
| Fame / adoption | High (Adobe; powers Spectrum; standard for a11y-heavy apps) | **Highest** (shadcn/ui ecosystem; WorkOS) | Rising fast; shadcn/ui offers it as a primitives option; 35 components at 1.0 | Moderate (Chakra ecosystem; multi-framework) | High in Tailwind circles |
| Maintenance health | Steady monthly-ish releases → 1.21.1 (Sep 2026) | Active fixes (Jul 20, 2026: tree-shaking + subpath entries; Jun 30, 2026: Toast/React-19 fixes) but few new primitives since 2023–24 slowdown | **Most active**: monthly cadence since stable 1.0.0 (Dec 11, 2025) → v1.8.0 (Sep 4, 2026) | Very active (v5 line) | Slow; small set by design |
| TypeScript | Excellent (written in TS) | Good (`.d.ts` per pkg) | Excellent (TS, strict) | Excellent | Good |

\* bundlephobia.com measurements, 2026-09-27, full package before tree-shaking —
upper bounds, not app-accurate; per-component cost is far lower for all of them.

## 2. The brief comparisons

**Radix UI Primitives** — https://www.radix-ui.com/primitives/docs/overview/releases
Still the most famous and the shadcn/ui foundation, and by no means abandoned:
July 2026 brought improved tree-shaking, per-primitive subpath entry points
(`radix-ui/accordion`), and Dialog/Toast/Tooltip fixes; June 2026 fixed a React 19
re-render loop. But: no direction auto-detection from the document (explicit
breaking change, July 2022: DirectionProvider required), no new primitives of
consequence since 2023–24's post-WorkOS slowdown, and the individual packages
(`@radix-ui/react-*`) are now secondary to the consolidated `radix-ui` package
(added Jan 22, 2025 — not deprecated, just consolidated).

**Base UI** — https://base-ui.com/react/overview/releases ·
https://base-ui.com/react/utils/direction-provider
The MUI-team/Radix-lineage successor: 1.0.0 stable Dec 11, 2025 (35 unstyled
components), monthly releases to v1.8.0 (Sep 4, 2026), APG-aligned keyboard
behavior, RTL scroll-alignment fixes in v1.7.0. Caveats: the package was renamed
(`@base-ui-components/react` is deprecated → `@base-ui/react`), components reach
"stable" status gradually post-1.0 (Drawer only in v1.3.0, Mar 2026), and its
DirectionProvider, like Radix's, must be synced manually. A very credible
library — the leading candidate if we ever re-evaluate — but at 9 months past
stable it can't match React Aria's a11y/i18n track record for an a11y-first,
RTL-critical rewrite.

**Ark UI** — https://github.com/chakra-ui/ark
Chakra's headless layer over Zag.js state machines; solid a11y, multi-framework
(React/Vue/Solid), heaviest measured bundle (~290 KB gz whole-package). Its
advantage (framework portability) is irrelevant to us, and RTL needs a manual
`dir` on its Provider. Pass.

**Headless UI** — https://github.com/tailwindlabs/headlessui
Only ~8 components: no Tooltip, no Toast, no AlertDialog, no accordion beyond a
single Disclosure, no Select beyond Listbox. Would force hand-rolling a third of
the AI panel's a11y. Designed to pair with Tailwind, which we don't use. Pass.

## 3. Component → primitive mapping (AI co-author panel)

| Qalam need | React Aria Components primitive | Notes |
|---|---|---|
| AI panel dialogs (confirmations, model info) | `Modal` + `Dialog` | `Modal` handles overlay/focus trap/scroll lock; `Dialog` provides semantics |
| **Model-download consent (~4 GB)** | `AlertDialog` | The attention-gated dialog variant (built on `Modal`+`Dialog`); semantics enforce an explicit user response — right shape for a 4 GB download consent |
| Provider picker (model provider select) | `Select` (+ `HiddenSelect` for no-JS/fallback form semantics) | RAC `Select` = listbox pattern, full keyboard |
| Direct-edit toggle | `Switch` | Also `Checkbox` for multi-option settings |
| Settings disclosure/accordion | `Disclosure` / `DisclosureGroup` | DisclosureGroup added Nov 2024; accordion = grouped disclosures |
| Open-dialog tabs (URL / upload / paste) | `Tabs`, `TabList`, `Tab`, `TabPanel` | For the upload tab, pair with `FileTrigger` (accessible file-input handling, ships in the same package) |
| Tooltips on icon buttons | `Tooltip` + `TooltipTrigger` | Trigger wraps the icon button, keeps focus/keyboard working |
| Toast feedback (send errors, copy, etc.) | `ToastRegion` / `Toast` + `ToastQueue` (`useToastQueue`) | Queue hook comes from the react-stately layer — add that dep when wiring toasts |
| **Tool-call activity display in chat** | **No kit primitive required** | Render as semantic HTML: a `<ul>` of tool calls with `role="status"`/`aria-live="polite"` for in-flight state; if calls should expand to show payloads, use `Disclosure` per call — the only place the kit touches chat |

Editor, preview, and split-pane layout remain fully custom (no kit involvement),
matching the scope decision in the rewrite brief.

## 4. Versions to pin

```jsonc
// package.json (React 19 + Vite + strict TS)
"dependencies": {
  "react": "^19.x",                  // peer-supported by all candidates (verified 2026-09-27)
  "react-dom": "^19.x",
  "react-aria-components": "^1.21.1" // npm latest 1.21.1; peer: ^16.8 || ^17 || ^18 || ^19.0.0-rc.1
}
// when wiring toasts:
"dependencies": { "react-stately": "^3.x" }  // ToastQueue/useToastQueue host — confirm minor at impl time
```

Reference points (verified 2026-09-27, npm registry): `radix-ui@1.6.7`,
`@radix-ui/react-dialog@1.1.23`, `@base-ui/react@1.8.0`
(`@base-ui-components/react` deprecated → renamed), `@ark-ui/react@5.39.2`,
`@headlessui/react@2.2.10`.

## 5. Caveats found in the sources

- **RTL**: React Aria's direction comes from the locale. Today the browser locale
  is inherited from `<html lang>` — our `documentElement` lang/dir flip therefore
  "just works". If the AI panel ever needs a direction independent of the
  document, wrap it in `<I18nProvider locale="fa-IR">` (or `"en-US"`) explicitly.
  Kit-side RTL does **not** style anything: our own CSS must use logical
  properties (`margin-inline-start`, `inset-inline-end`, …) — same rule as today.
- **RTL (why not Radix/Base UI)**: neither reads the document `dir`; Radix docs
  call the DirectionProvider requirement out as a breaking change (2022-07-21)
  and open issue radix-ui/primitives#3830 asks for the auto-detection we'd need;
  Base UI's DirectionProvider "does not affect HTML and CSS". Both workable, but
  each needs a sync layer we'd have to own and test.
- **React 19**: all five candidates declare React 19 in peer dependencies today.
  The only React 19-specific bug found in sources was a Radix Toast re-render
  loop fixed June 30, 2026 — a reminder that library React 19 edge cases are
  still surfacing in 2026; keep the kit on the latest minor.
- **Bundle**: React Aria Components is the heaviest package of the set; the
  numbers above are pre-tree-shaking upper bounds. Measure the real chunk after
  the panel lands; if the dialog+select+tabs slice is unacceptably large, the
  documented fallback is a Radix per-primitive swap for the heaviest components
  (pattern-compatible APIs, ~10–30 KB gz per primitive).
- **Package renames**: Base UI's old `@base-ui-components/react` is deprecated in
  favor of `@base-ui/react`; Radix recommends the consolidated `radix-ui` import
  for new code (individual packages remain published). Neither affects our pick;
  recorded to prevent pinning a dead package in any future swap.

## 6. Consequences — what consuming agents must do

1. **Provider wrapper.** Mount React Aria's i18n layer at the app root (a small
   `<AppProviders>`): rely on `<html lang>` inheritance for direction, or wrap
   explicitly in `I18nProvider` with the active locale so the AI panel's direction
   is testable in isolation. Re-render on the existing EN⇄FA toggle so the kit
   re-reads the locale.
2. **Direction handling.** Keep the `documentElement` lang/dir flip as the single
   source of truth; write all new (kit and custom) CSS with logical properties;
   never assume LTR in component styles. Kit primitives handle arrow-key order,
   popover side, and typeahead direction automatically once the locale is right.
3. **Theming hooks.** Style kit parts exclusively via `className` + `data-*`
   state attributes (`data-hovered`, `data-focused`, `data-selected`,
   `data-disabled`, …) using our existing CSS custom properties — no CSS-in-JS,
   no Tailwind. Define visible-focus styles ourselves (the kit sets state, not
   looks); verify they survive forced-colors/high-contrast.
4. **Toast plumbing.** One `ToastRegion` at the app root fed by a shared
   `ToastQueue`; imperative `ToastQueue.add()` from anywhere in the AI panel.
5. **Consent gate.** The ~4 GB model download must be initiated only from the
   `AlertDialog`'s affirmative action; cancel must abort (AbortController) — the
   dialog semantics (no outside-click dismissal by default) support this.
6. **Bundle budget check.** Add a chunk-size assertion (CI) for the AI-panel
   chunk when the kit lands; on breach, apply the documented Radix fallback for
   the offending component before reaching for a different kit.
