import { expect, test, type Page } from '@playwright/test';

/** Collect uncaught page errors so a test can assert none occurred. */
function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test.describe('smoke', () => {
  test('FA sample loads, renders a Mermaid diagram, with no page errors', async ({ page }) => {
    const errors = trackPageErrors(page);

    await page.goto('/?file=samples/sample-fa.md');

    await expect(page.locator('#doc-name')).toHaveText('sample-fa');
    await expect(page.locator('.markdown-body h1').first()).toBeVisible();

    // Mermaid initializes lazily and lays out asynchronously — allow 15s.
    await expect(page.locator('.mermaid-block svg').first()).toBeVisible({ timeout: 15000 });

    expect(errors).toEqual([]);
  });

  test('EN sample renders the heading and a table of contents', async ({ page }) => {
    await page.goto('/?file=samples/sample-en.md');

    await expect(page.locator('.markdown-body h1').first()).toBeVisible();
    await expect(page.locator('.toc-link').first()).toBeVisible({ timeout: 10000 });
  });

  test('typing into the editor updates the preview heading', async ({ page }) => {
    await page.goto('/?file=samples/sample-en.md');
    await expect(page.locator('.markdown-body h1').first()).toBeVisible();

    const heading = 'E2E Heading Check';
    const editor = page.locator('#editor');
    await editor.fill(`# ${heading}`);
    // The app re-renders on 'input' (300 ms debounce); fill() fires it, but
    // dispatch one explicitly so the update never depends on fill() internals.
    await editor.dispatchEvent('input');

    // Headings carry a trailing "#" anchor element, so match contained text.
    await expect(page.locator('.markdown-body h1')).toContainText(heading, { timeout: 5000 });
  });
});
