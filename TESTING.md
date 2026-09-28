# Qalam Testing Guide

Our practices map Google's *Software Engineering at Google* and the Google
Testing Blog onto this stack: **Vitest** (node + jsdom projects), **Testing
Library** for React, **Playwright** for end-to-end. Every practice below is
enforced by review; the tooling only helps.

## The test pyramid, in our stack

| Size   | Runner              | Environment | What it covers                       | How many |
| ------ | ------------------- | ----------- | ------------------------------------ | -------- |
| Small  | Vitest `node`       | node        | Pure modules: markdown pipeline, AI chunking/edit logic, share encoding, reducers | **Many** — most tests live here |
| Medium | Vitest `jsdom`      | jsdom + RTL | One component (or one behavior) at a time, with fakes at the network/storage boundary | **Some** |
| Large  | Playwright          | Real browsers against the **production build** (`vite build` + `vite preview`, wired in `playwright.config.ts`) | Complete user journeys | **Few** |

Push logic down the pyramid: if a rule can be decided by a pure function, test
it as a small test and let the component test cover only the wiring, and the
e2e cover only the happy path. Small tests fail in milliseconds and pinpoint
the bug; large tests fail in seconds and only tell you *that* something broke.

### Layout

- Test files are **colocated** with the code they test.
- `*.test.ts` → runs in the `node` project. `*.test.tsx` → runs in the
  `jsdom` project (RTL + jest-dom; setup in `src/test/setup.ts`).
- e2e specs live in `e2e/*.spec.ts`.

## Behavior, not implementation

Test what the code **does for its user**, not how it is structured. Assert on
rendered roles/text/outcomes, observable state changes, and emitted effects —
never on internals (props drilling, class names, private functions).

```tsx
// Good: a user-visible outcome
it('shows an error message when the document fails to load', ...);

// Bad: an implementation detail
it('sets loadError to "network" and renders .error-box', ...);
```

When a test feels brittle, that is the signal the component exposes
implementation — fix the component (or its accessibility), not the query.

## One behavior per test, AAA

One arrange-act-assert block, one reason to fail. If you need "and" in the
test name, split the test. Shared arrange goes into helpers/builders, never
into cross-test state.

```tsx
describe('<App />', () => {
  it('renders the topbar with the Qalam brand', () => {
    render(<App />);                                        // arrange

    const topbar = screen.getByRole('banner');              // act (none needed)

    expect(topbar).toHaveTextContent('Qalam');              // assert
  });
});
```

## Names reveal behavior

`unit_<method>` tells nothing. State the expected behavior —
"streams the scripted reply before issuing a tool call",
"disables save while a request is pending". The test name is the first
diagnostic you read when CI is red.

## Determinism: no sleeps, ever

Never `setTimeout`/`sleep` to "wait for" UI. Poll instead — RTL's `findBy*`
and `waitFor` retry until timeout; Playwright's `expect(locator).toBeVisible()`
auto-waits. Fake time with `vi.useFakeTimers()` when the code under test uses
timers (e.g. the 300 ms preview debounce).

```tsx
it('updates the preview after the debounce', async () => {
  await userEvent.type(editor, '# Hello');
  await screen.findByRole('heading', { name: 'Hello' });   // polls
});
```

A suite that passes at 10:00 and flakes at 10:05 is worse than no suite; a
flaky test gets fixed or deleted within the day, never skipped.

## Fakes over mocks (house style)

We prefer **hand-rolled fakes at module boundaries** to `vi.mock` module
patching. Fakes are real (small) implementations with scripted inputs and
recorded outputs; they double as executable documentation of the boundary
contract. This is the established house style — see the agent and provider
tests under `src/lib/ai/` (`agent.test.ts`, `providers/http.test.ts`):

```ts
/** Streams one scripted reply per stream() call, chunked, recording inputs. */
class FakeProvider implements ChatProvider {
  readonly id: ProviderId = 'builtin';
  calls: ChatMessage[][] = [];
  private script: string[];
  constructor(...replies: string[]) { this.script = [...replies]; }

  async *stream(messages: ChatMessage[]): AsyncGenerator<string> {
    this.calls.push(messages.map((m) => ({ ...m })));
    const reply = this.script.shift() ?? '';
    for (const piece of reply.match(/[\s\S]{1,6}/g) ?? []) yield piece;
  }
}
```

Guidelines:

- **Network**: fake `fetch` with real `Response` objects (stream SSE with a
  `ReadableStream`, like the provider tests) — not by mocking the
  fetch wrapper.
- **Storage/clipboard/etc.**: tiny in-memory implementations.
- `vi.spyOn` is acceptable for "was this called" assertions at the same
  boundary. `vi.mock('./module')` is a last resort (config tables,
  browser-only SDKs), and its use must be explained in the test header.

## Accessibility queries are the primary queries

In component tests, query **by role first** (`getByRole('banner')`,
`getByRole('button', { name: 'Open' })`), then label/text. Role queries read
the accessibility tree, so every query is also a small a11y assertion: if the
role/name is missing, the component is inaccessible and the test *should*
fail. CSS-class or test-id queries are last resorts for genuinely
non-semantic elements.

- `getBy*` — element must exist (throws otherwise).
- `queryBy*` — only for asserting absence.
- `findBy*` — anything asynchronous.

## Coverage is a signal, not a target

We do not gate on coverage percentages. A meaningless 90% is worse than a
meaningful 70%. What we do require: **every bug fix ships with a failing
test first**, and new pure functions arrive with small tests. Run
`pnpm test --coverage` when you want to find *untested* behavior, not to
chase a number.

## e2e: few, meaningful, hermetic

- Run against the production bundle (the Playwright `webServer` builds and
  previews); dev-server-only bugs are still caught by local smoke runs.
- Assert **no console errors** on critical paths (`e2e/boot.spec.ts` shows the
  pattern — this is also how we catch CSP violations).
- Use roles/names over CSS selectors: `page.getByRole('link', { name: 'Qalam' })`.
- One journey per test; no multi-user flows until the features exist.
