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

/** The rendered numbers with their viewport-space top coordinates. The
 *  structural query is the only way to read the (role-less, aria-hidden)
 *  numbers: the column is the gutter's child, the numbers the column's. */
function renderedNumbers(page: Page) {
  return gutter(page).evaluate((el) => [...el.querySelectorAll<HTMLElement>(':scope > div > div')]
    .map((n) => ({ n: n.textContent ?? '', y: n.getBoundingClientRect().top })));
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
    const ta = editor(page);

    // The 400-char middle line wraps to several visual rows; the click
    // oracle below would land mid-paragraph if the gutter misaligned.
    const longLine = `wrapped ${'x'.repeat(400)}`;
    const lines = ['first', longLine, 'third'];
    await ta.fill(lines.join('\n'));

    for (const [index, line] of lines.entries()) {
      const lineNumber = String(index + 1);
      const num = gutter(page).getByText(lineNumber, { exact: true });
      await expect(num).toBeVisible();
      const numBox = await num.boundingBox();
      const taBox = await ta.boundingBox();
      if (!numBox || !taBox) throw new Error(`number ${lineNumber} or editor not visible`);

      // Click through the gutter at the number's vertical center: the
      // caret must land on the line's first visual row (column 0, since
      // the x position is inside the inline-start padding).
      await ta.click({
        position: {
          x: numBox.x + numBox.width / 2 - taBox.x,
          y: numBox.y + numBox.height / 2 - taBox.y,
        },
      });
      const caret = await ta.evaluate((el) => el.selectionStart);
      const expected = lines.slice(0, index).join('\n').length + (index > 0 ? 1 : 0);
      expect(caret, `clicking number ${lineNumber} (${line.slice(0, 20)}…) lands on its line`).toBe(expected);
    }
  });

  test('scrolling the textarea moves the gutter in lockstep, both directions', async ({ page }) => {
    await bootReadme(page);
    const ta = editor(page);

    await ta.fill(Array.from({ length: 600 }, (_, i) => `line ${i + 1}`).join('\n'));
    await expect(gutter(page).getByText('600', { exact: true })).toHaveCount(0);

    /** Scroll state: scrollTop + the rendered numbers' positions. */
    const snapshot = async () => ({
      scrollTop: await ta.evaluate((el) => el.scrollTop),
      numbers: await renderedNumbers(page),
    });

    /** A number rendered in both snapshots must move by the scroll delta. */
    const assertLockstep = async (before: Awaited<ReturnType<typeof snapshot>>, after: Awaited<ReturnType<typeof snapshot>>) => {
      const kept = before.numbers.find(({ n }) => after.numbers.some((a) => a.n === n));
      if (!kept) throw new Error('no number survived the scroll to compare');
      const moved = after.numbers.find(({ n }) => n === kept.n);
      if (!moved) throw new Error('the kept number vanished between snapshots');
      expect(Math.abs((kept.y - moved.y) - (before.scrollTop - after.scrollTop))).toBeLessThanOrEqual(EPS_PX);
    };

    await ta.evaluate((el) => {
      // eslint-disable-next-line no-param-reassign
      el.scrollTop = 300;
    });
    const down1 = await snapshot();
    expect(down1.numbers.length).toBeGreaterThan(0);

    await ta.evaluate((el) => {
      // eslint-disable-next-line no-param-reassign
      el.scrollTop = 900;
    });
    await assertLockstep(down1, await snapshot());

    await ta.evaluate((el) => {
      // eslint-disable-next-line no-param-reassign
      el.scrollTop = 120;
    });
    await assertLockstep(down1, await snapshot());
  });

  test('the gutter does not trap wheel events — they scroll the editor', async ({ page }) => {
    await bootReadme(page);
    const ta = editor(page);

    await ta.fill(Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join('\n'));

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
    await bootReadme(page);
    const ta = editor(page);

    await ta.fill('این سند فارسی است\nخط دوم ماجراست\nخط سوم');
    await expect(gutter(page).getByText('3', { exact: true })).toBeVisible();

    const g = await gutter(page).boundingBox();
    const t = await ta.boundingBox();
    if (!g || !t) throw new Error('gutter or editor not visible');
    expect(g.x).toBeGreaterThan(t.x + t.width / 2);
    expect(Math.abs(g.x + g.width - (t.x + t.width))).toBeLessThanOrEqual(EPS_PX);

    // The numbers keep their scroll lockstep under RTL too.
    await ta.evaluate((el) => {
      // eslint-disable-next-line no-param-reassign
      el.scrollTop = 0;
    });
    await expect(gutter(page).getByText('1', { exact: true })).toBeVisible();
  });
});
