import { expect, test, type Page } from '@playwright/test';

/**
 * Document scrolling (regression: the unbounded shell bug).
 *
 * The app is a fixed-viewport shell (body { overflow: hidden }): the mount
 * point must bound the workspace to the viewport so the EDITOR and PREVIEW
 * panes scroll internally. When the shell is unbounded (the regression this
 * spec guards), the workspace grows to the content height and the viewport
 * clips everything below the first screen — no pane ever overflows, so
 * nothing scrolls and the footer ends up thousands of pixels down.
 *
 * Layout lives in CSS, so per TESTING.md these assertions are e2e territory:
 * a jsdom component test has no layout engine to assert them with.
 */

/** Rounding slack for box measurements against the viewport. */
const EPS_PX = 2;

/** The preview scroll container — the pane div hosting the article. */
function previewScroll(page: Page) {
  return page.locator('div:has(> article)');
}

/** Boots the README document and waits for editor + preview to render it. */
async function bootReadme(page: Page) {
  await page.goto('/');
  const editor = page.getByRole('textbox');
  await expect(editor).toHaveValue(/# Qalam/);
  await expect(page.locator('article h1')).toHaveText(/Qalam/);
  return editor;
}

test.describe('document scrolling', () => {
  test('the boot README keeps the shell viewport-bounded and the preview scrollable', async ({ page }) => {
    await bootReadme(page);
    const viewportHeight = page.viewportSize()?.height ?? 0;

    // The workspace (and its panes) must fit the viewport, not the content.
    const workspaceBox = await page.getByRole('main').boundingBox();
    expect(workspaceBox).not.toBeNull();
    expect(workspaceBox!.height).toBeLessThanOrEqual(viewportHeight + EPS_PX);

    // The footer is pinned to the bottom of the viewport, not pushed below it.
    const footer = page.getByRole('contentinfo');
    await expect(footer).toBeVisible();
    const footerBox = await footer.boundingBox();
    expect(Math.abs(footerBox!.y + footerBox!.height - viewportHeight)).toBeLessThanOrEqual(EPS_PX);

    // The preview overflows internally — that overflow IS the scroll.
    const scroll = previewScroll(page);
    const geo = await scroll.evaluate((el) => ({
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
    }));
    expect(geo.clientHeight).toBeLessThanOrEqual(viewportHeight + EPS_PX);
    expect(geo.scrollHeight).toBeGreaterThan(geo.clientHeight);

    // A real wheel gesture scrolls the preview.
    await scroll.hover();
    await page.mouse.wheel(0, 500);
    await expect
      .poll(() => scroll.evaluate((el) => el.scrollTop), { timeout: 5_000 })
      .toBeGreaterThan(0);
  });

  test('scrolling the preview mirrors into the editor (scroll sync)', async ({ page }) => {
    await bootReadme(page);

    // Jump the preview to its bottom; the scroll event must mirror the
    // fraction into the editor (the 60 ms lock only suppresses echo scrolls,
    // so the mirror lands right after the event — poll, never sleep).
    const preview = previewScroll(page);
    await preview.evaluate((el) => {
      // eslint-disable-next-line no-param-reassign
      el.scrollTop = el.scrollHeight;
    });
    const editor = page.getByRole('textbox');
    await expect
      .poll(() => editor.evaluate((el) => el.scrollTop), { timeout: 5_000 })
      .toBeGreaterThan(0);

    // Fraction parity: preview at the bottom drags the editor to its bottom.
    const fractions = await Promise.all([
      preview.evaluate((el) => el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight)),
      editor.evaluate((el) => el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight)),
    ]);
    expect(fractions[1]).toBeGreaterThanOrEqual(fractions[0] - 0.01);
  });

  test('a short document leaves the panes unscrolled with the footer pinned', async ({ page }) => {
    const editor = await bootReadme(page);

    await editor.fill('# Tiny doc\n\nTwo short paragraphs. Nothing to scroll.');
    // Headings render with a trailing anchor glyph, so match the text loosely.
    await expect(page.locator('article h1')).toHaveText(/Tiny doc/);

    // No overflow, no residual scroll — and the shell stays a fixed viewport.
    const scroll = previewScroll(page);
    const geo = await scroll.evaluate((el) => ({
      scrollTop: el.scrollTop,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
    }));
    expect(geo.scrollTop).toBe(0);
    expect(geo.scrollHeight).toBeLessThanOrEqual(geo.clientHeight);

    const viewportHeight = page.viewportSize()?.height ?? 0;
    const footer = page.getByRole('contentinfo');
    await expect(footer).toBeVisible();
    const footerBox = await footer.boundingBox();
    expect(Math.abs(footerBox!.y + footerBox!.height - viewportHeight)).toBeLessThanOrEqual(EPS_PX);
  });
});
