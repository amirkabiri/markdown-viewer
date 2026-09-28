# Qalam Style Guide

React 19 + TypeScript (strict) + Vite. We enforce **Airbnb conventions** with
ESLint 9 flat config. This document records which Airbnb distribution we use,
why, and the deltas we run on top of it.

## Tooling

| Gate        | Command            | Enforces                                    |
| ----------- | ------------------ | ------------------------------------------- |
| Typecheck   | `pnpm typecheck`   | `tsc --noEmit`, `strict: true`              |
| Lint        | `pnpm lint`        | ESLint 9 flat config (Airbnb)               |
| Unit/component | `pnpm test`     | Vitest (`node` + `jsdom` projects)          |
| Build       | `pnpm build`       | `vite build` → `dist/`                      |
| E2E         | `pnpm test:e2e`    | Playwright, chromium/firefox/webkit         |

All five must pass before every commit. Testing practices live in
[TESTING.md](./TESTING.md).

## ESLint: the Airbnb route we took

We use **`eslint-config-airbnb-extended`** — the flat-config-native Airbnb
distribution — and ESLint is **pinned to `^9`** (the package's peer range;
do not bump to a newer ESLint major without re-checking it).

This is the canonical ESLint 9 + TS + React route:

- `eslint-config-airbnb` is eslintrc-era; `airbnb-typescript` would force the
  `@eslint/eslintrc` FlatCompat shim, which is deprecated tooling.
- `eslint-config-airbnb-extended` ships flat configs (`configs.*`) and plugin
  registrations (`plugins.*`) directly, including `typescript-eslint`,
  `eslint-plugin-react`, `react-hooks`, `jsx-a11y`, `import-x` and
  `@stylistic` as its own dependencies.
- Composition mirrors the official `create-airbnb-x-config` React+TypeScript
  template (see `eslint.config.js`): JS recommended → `plugins.stylistic` /
  `plugins.importX` + `configs.base.recommended` → react plugin registrations +
  `configs.react.recommended` → `plugins.typescriptEslint` +
  `configs.base.typescript` + `configs.react.typescript`. TypeScript entries
  come last so their turn-offs win on `.ts/.tsx` files.

The TypeScript configs use `projectService: true` (type-aware rules without a
timestamped tsprogram). Consequence: **every `.ts/.tsx` file ESLint lints must
be covered by `tsconfig.json`** — when you add a root-level `*.config.ts`, add
it to the tsconfig `include` too.

### Project deltas (each lives in `eslint.config.js` under `qalam/deltas/*`)

1. **Automatic JSX runtime** — `react/react-in-jsx-scope` and
   `react/jsx-uses-react` are off. React 19's automatic transform makes the
   React import obsolete; this mirrors the plugin's own `jsx-runtime` preset,
   which airbnb-extended does not apply.
2. **max-len allowances restored** — airbnb-extended reduced max-len to a bare
   100 columns. We keep the limit but restore classic Airbnb's
   `ignoreUrls` / `ignoreStrings` / `ignoreTemplateLiterals` /
   `ignoreRegExpLiterals`, because brand SVG path data and long hrefs cannot
   be wrapped.
3. **devDependencies in test & tooling files** — airbnb-extended's devDeps file
   list predates React: it has no `.tsx` extension, so `*.test.tsx` files would
   reject `@testing-library/react`. We allow devDependencies in
   `**/*.test.*`, `**/*.spec.*`, `src/test/**`, and `playwright.config.ts`
   (and only there — app code still may not import dev tooling).
4. **Ignores** — `dist/`, `node_modules/`, `coverage/`, and `public/`.

If you ever add a rule override, add it as a named `qalam/deltas/*` block with
a comment, and list it here.

## Conventions

### Airbnb defaults, then these house rules

Airbnb defaults win wherever they are sensible. Where they are silent, we fix
the convention here.

### Language

- TypeScript strict everywhere; no `any`, no non-null assertions (`!`) —
  narrow with type guards or fail fast (`if (!el) throw new Error(...)`, like
  `src/main.tsx`).
- Imports never use `.js`/`.mjs` extensions (`moduleResolution: bundler`);
  `type`-only imports use `import type` (`verbatimModuleSyntax`).
- Prefer `interface` for object shapes (Airbnb's
  `consistent-type-definitions`), `type` for unions/aliases.

### Naming

- Components and their files: `PascalCase.tsx` (`App.tsx`).
- Hooks: `useSomething.ts`; plain modules: `camelCase.ts`.
- CSS Modules keys: `camelCase` (accessed as `styles.topBar`).
- Tests: `Component.test.tsx` / `module.test.ts`, colocated next to the code.
- Event handlers: `handleX` props / `onX` DOM props (Airbnb
  `react/jsx-handler-names` is off by default here; keep the distinction
  anyway).

### Components

- Function components only (Airbnb `react/function-component-definition`).
  No `React.FC`, no `forwardRef` unless a ref actually must forward.
- Props: one component per module, props type named `ComponentProps`
  colocated above the component.
- Colocate state and types with the feature that owns them; cross-feature
  imports go through the feature's entry module (`features/preview`), not
  deep file paths.

### Styling

- **Global tokens live in `src/styles/tokens.css`** — CSS custom properties
  (`--bg`, `--accent`, `--sans`, …), the base reset, and theme
  (`[data-theme="dark"]`) overrides. This file is the only global stylesheet;
  it is imported once in `main.tsx` and is pre-paint safe (boot.js sets
  `data-theme`/`lang`/`dir` before React mounts).
- Everything else is **CSS Modules** (`App.module.css`), one module per
  component, camelCase keys. No CSS-in-JS, no inline `style` props except for
  genuinely dynamic values (geometry, drag offsets).
- Never hard-code colors/fonts/sizes that exist as tokens.

### Exports

- Single-purpose modules (one component, one helper) use a **default export**
  (Airbnb `import-x/prefer-default-export` enforces this).
- Multi-export modules (barrels, type clusters, hook collections) use named
  exports exclusively.
- Type-only exports use `export type`.

### Imports

Order is enforced by `import-x/order`: builtin → external → internal →
parent → sibling. Inside a feature folder keep imports relative; reach
upwards (`../../`) only to cross feature boundaries, never to skip sideways
through internals of another feature.
