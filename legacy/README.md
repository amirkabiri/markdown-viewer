# legacy/ — frozen vanilla implementation

This directory is the **frozen vanilla (TypeScript + DOM) implementation** kept
as a **porting reference for the `react-rewrite` branch**; it is deleted at
merge.

- `src/` — modules of the pre-React app (markdown pipeline, AI layer, UI wiring).
- `test/` — Vitest unit tests (node environment) for the modules above.
- `e2e/` — Playwright specs written against the vanilla DOM (superseded by the
  new baseline spec in `/e2e`).

Rules for this branch:

- Nothing here is built, type-checked, linted, or tested (excluded from
  `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, and the Playwright
  `testDir`).
- Do not import from `legacy/` in new code — port instead, then adapt the port
  to React idioms.
- Do not "fix" legacy code; it only exists to be read while porting.
