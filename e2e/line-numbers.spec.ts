import { expect, test, type Page } from '@playwright/test';

/**
 * Line-number gutter (alignment + scroll-sync contract).
 *
 * The gutter is a display-only overlay on the editor's inline-start side:
 * numbers align with the FIRST VISUAL ROW of each logical line under soft
 * wrap, mirror the textarea's scroll position, pass wheel/pointer events
 * through, and flip to the right for RTL documents.
 *
 * Layout lives in CSS and caret placement is real browser behavior, so per
 * TESTING.md these assertions are e2e territory: a jsdom component test has
 * no layout engine to assert geometry with. The alignment check below is
 * behavioral on purpose: clicking at a number's vertical position (pointer
 * events pass through the gutter) must place the caret on that logical
 * line's first visual row — the browser's own caret mapping is the oracle.
 */

/** Rounding slack for box measurements against the viewport. */
const EPS_PX = 2;

/** The display-only gutter — aria-hidden by contract, so it has no role;
 *  a test id is the honest last-resort query here. */
function gutter(page: Page) {
  return page.getByTestId('line-gutter');
}

function editor(page: Page) {
  return page.getByRole('textbox');
}

/** Boots the README document and waits for the editor to render it. */
async function bootReadme(page: Page) {
  await page.goto('/');
  await expect(editor(page)).toHaveValue(/# Qalam/);
}

/** Boots in editor-only mode: the gutter's scroll contract is with the
 *  TEXTAREA, and the split view's editor↔preview fraction sync echoes every
 *  programmatic scroll through the preview pane (outside its 60 ms lock),
 *  which would race the deterministic scroll steps below. Switching to
 *  "Editor only" takes the preview pane — and its sync — out of the loop. */
async function bootEditorOnly(page: Page) {
  await bootReadme(page);
  await page.getByRole('button', { name: 'Editor only' }).click();
  await expect(page.getByRole('region', { name: 'Preview' })).toHaveCount(0);
}

/** Loads `text` the way the app's own loadDocument does — value write plus
 *  one input event for the controller's mirror. A Playwright fill() on a
 *  huge document instead leaves a SMOOTH caret-scroll animation in flight:
 *  the browser keeps animating toward the caret after the test has pinned
 *  the scroll position, and every later measurement reads mid-animation. No
 *  focus, no caret, no animation — the wheel gestures below are the only
 *  scrolling input. */
async function loadDocumentText(page: Page, text: string) {
  await editor(page).evaluate((el, t) => {
    if (!(el instanceof HTMLTextAreaElement)) throw new Error('editor is not a textarea');
    // Loading writes the textarea value, exactly like loadDocument:
    // eslint-disable-next-line no-param-reassign
    el.value = t;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

/** Collapses the caret and parks the editor at the top: fill() leaves the
 *  textarea FOCUSED with the caret at the document end, and a focused
 *  textarea re-pins its scroll to that caret, silently undoing programmatic
 *  scrollTop changes (verified in all three engines) — so the textarea is
 *  blurred first. */
async function parkEditorAtTop(page: Page) {
  const ta = editor(page);
  await ta.evaluate((el) => {
    if (!(el instanceof HTMLTextAreaElement)) throw new Error('editor is not a textarea');
    el.setSelectionRange(0, 0);
    el.blur();
    // eslint-disable-next-line no-param-reassign
    el.scrollTop = 0;
  });
  // Let the gutter's rAF-batched render settle (scrollTo's poll relies on
  // this last poll having seen the pinned position).
  await expect.poll(() => ta.evaluate((el) => el.scrollTop)).toBe(0);
}

/** Clicks through the gutter at `lineNumber`'s vertical center and asserts
 *  the caret landed on that logical line's first visual row (column 0 — the
 *  click x is inside the inline-start padding). The browser's own caret
 *  mapping is the alignment oracle. */
async function assertNumberAligns(
  page: Page,
  lineNumber: string,
  linePreview: string,
  expectedCaret: number,
) {
  const ta = editor(page);
  const num = gutter(page).getByText(lineNumber, { exact: true });
  await expect(num).toBeVisible();
  const numBox = await num.boundingBox();
  const taBox = await ta.boundingBox();
  if (!numBox || !taBox) throw new Error(`number ${lineNumber} or editor not visible`);

  await ta.click({
    position: {
      x: numBox.x + numBox.width / 2 - taBox.x,
      y: numBox.y + numBox.height / 2 - taBox.y,
    },
  });
  const caret = await ta.evaluate((el) => {
    if (!(el instanceof HTMLTextAreaElement)) throw new Error('editor is not a textarea');
    return el.selectionStart;
  });
  expect(
    caret,
    `clicking number ${lineNumber} (${linePreview}…) lands on its line`,
  ).toBe(expectedCaret);
}

test.describe('line-number gutter', () => {
  test('numbers match the logical lines; an empty document shows 1', async ({ page }) => {
    await bootReadme(page);
    const ta = editor(page);

    await ta.fill('one\ntwo\nthree');
    const numbers = gutter(page);
    await expect(numbers.getByText('3', { exact: true })).toBeVisible();
    await expect(numbers.getByText('1', { exact: true })).toBeVisible();
    await expect(numbers.getByText('2', { exact: true })).toBeVisible();
    await expect(numbers.getByText('4', { exact: true })).toHaveCount(0);

    await ta.fill('');
    await expect(numbers.getByText('1', { exact: true })).toBeVisible();
    await expect(numbers.getByText('2', { exact: true })).toHaveCount(0);
  });

  test("a wrapped paragraph's number aligns with its first visual row", async ({ page }) => {
    await bootReadme(page);

    // The 400-char middle line wraps to several visual rows; the click
    // oracle would land mid-paragraph if the gutter misaligned.
    const lines = ['first', `wrapped ${'x'.repeat(400)}`, 'third'];
    await editor(page).fill(lines.join('\n'));

    // Line 1 starts at 0, line 2 after "first\n", line 3 after line 2.
    await assertNumberAligns(page, '1', 'first', 0);
    await assertNumberAligns(page, '2', 'wrapped', 'first\n'.length);
    await assertNumberAligns(page, '3', 'third', 'first\n'.length + lines[1].length + 1);
  });

  test('scrolling the textarea moves the gutter in lockstep, both directions', async ({ page }) => {
    await bootEditorOnly(page);
    const ta = editor(page);

    await loadDocumentText(page, Array.from({ length: 1200 }, (_, i) => `line ${i + 1}`).join('\n'));
    await parkEditorAtTop(page);
    // The steps below read the gutter's rendered numbers, so first wait for
    // the 1,200-line document's metrics to have landed: the digit-driven
    // width grows to 4ch in the same render as the fresh tops (the README's
    // window would pass a mere 'max number' check).
    await expect.poll(() => ta.evaluate(
      (el) => (el.parentElement as HTMLElement).style.getPropertyValue('--gutter-w'),
    )).toContain('4ch');
    await expect(gutter(page).getByText('1200', { exact: true })).toHaveCount(0);

    // Real wheel gestures over the text — the same input a user's trackpad
    // produces — drive the scrolling, so the test never fights the browser's
    // caret/scroll-repin semantics around programmatic scrollTop writes.
    await ta.hover({ position: { x: 320, y: 240 } });

    /** The lockstep contract, read in one pass: the gutter's translated
     *  column must sit at -scrollTop, and the rendered numbers must sit at
     *  their content offsets INSIDE the translated column (their viewport y
     *  = content top - scrollTop + pane offset). Any tracking gap between
     *  the textarea and the gutter shows up here. */
    const readLockstep = async () => ta.evaluate((el) => {
      const g = document.querySelector('[data-testid="line-gutter"]');
      const col = g?.firstElementChild as HTMLElement | null;
      const first = col?.firstElementChild as HTMLElement | null;
      if (!g || !col || !first) return { live: el.scrollTop, transform: '', offset: Number.NaN };
      const gRect = g.getBoundingClientRect();
      const firstRect = first.getBoundingClientRect();
      return {
        live: el.scrollTop,
        transform: col.style.transform,
        // content offset minus rendered position must equal scrollTop
        offset: Math.round(
          (firstRect.top - gRect.top) + el.scrollTop - parseFloat(first.style.top),
        ),
      };
    });

    /** Wheels by `dy` from `at` (the expected absolute scrollTop), waits
     *  for the gutter state to land EXACTLY there (the transform is the
     *  gutter's rendered scroll state), then asserts the number placement
     *  invariant. */
    const wheelAndAssertLockstep = async (at: number, dy: number) => {
      await page.mouse.wheel(0, dy);
      await expect.poll(() => ta.evaluate(() => {
        const g = document.querySelector('[data-testid="line-gutter"]');
        return g ? (g.firstElementChild as HTMLElement).style.transform : '';
      }), { timeout: 5_000 }).toBe(`translateY(${-at}px)`);
      const lock = await readLockstep();
      expect(lock.live).toBe(at);
      expect(lock.offset).toBeLessThanOrEqual(EPS_PX);
    };

    await wheelAndAssertLockstep(360, 360);
    // The top window scrolled out; the virtualized window followed.
    await expect(gutter(page).getByText('1', { exact: true })).toHaveCount(0);

    await wheelAndAssertLockstep(120, -240);
    await wheelAndAssertLockstep(360, 240);
  });

  test('the gutter does not trap wheel events — they scroll the editor', async ({ page }) => {
    await bootEditorOnly(page);
    const ta = editor(page);

    await loadDocumentText(page, Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join('\n'));
    // Start from a settled top so the wheel gesture is what moves it.
    await parkEditorAtTop(page);

    // Park the cursor OVER the gutter's area and wheel: the event must
    // reach the textarea underneath (display-only, pointer-events none).
    const taBox = await ta.boundingBox();
    if (!taBox) throw new Error('editor not visible');
    await ta.hover({ position: { x: 12, y: 80 } });
    await page.mouse.wheel(0, 400);

    await expect
      .poll(() => ta.evaluate((el) => el.scrollTop), { timeout: 5_000 })
      .toBeGreaterThan(0);
  });

  test('an RTL document shows the gutter on the right (inline-start) side', async ({ page }) => {
    await bootEditorOnly(page);
    const ta = editor(page);

    await ta.fill('این سند فارسی است\nخط دوم ماجراست\nخط سوم');
    await expect(gutter(page).getByText('3', { exact: true })).toBeVisible();

    const g = await gutter(page).boundingBox();
    const t = await ta.boundingBox();
    if (!g || !t) throw new Error('gutter or editor not visible');
    expect(g.x).toBeGreaterThan(t.x + t.width / 2);
    expect(Math.abs(g.x + g.width - (t.x + t.width))).toBeLessThanOrEqual(EPS_PX);

    // The numbers keep their scroll lockstep under RTL too (park at the top
    // — blurred, so the write sticks).
    await parkEditorAtTop(page);
    await expect(gutter(page).getByText('1', { exact: true })).toBeVisible();
  });
});
