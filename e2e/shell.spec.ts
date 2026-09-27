import { expect, test } from '@playwright/test';

/**
 * Shell journeys against the production build (the webServer config builds
 * and previews dist/). One journey per test; the boot spec (boot.spec.ts)
 * covers landmarks + console cleanliness.
 */
test.describe('shell', () => {
  test('boots the README document into the workspace', async ({ page }) => {
    await page.goto('/');

    // The default boot document is the site README (`?file=README.md`).
    const editor = page.getByRole('textbox');
    await expect(editor).toHaveValue(/# Qalam/);
    await expect(page.locator('article h1')).toHaveText(/Qalam/);
  });

  test('typing updates the preview after the render debounce', async ({ page }) => {
    await page.goto('/');
    const editor = page.getByRole('textbox');
    await expect(editor).toHaveValue(/# Qalam/);

    await editor.fill('# E2E Hello');

    await expect(page.locator('article h1')).toHaveText(/E2E Hello/);
  });

  test('theme choice persists across a reload', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.getByRole('button', { name: 'Toggle light / dark theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('language flip mirrors the document direction and persists', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

    await page.getByRole('button', { name: 'تغییر زبان به فارسی' }).click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('banner')).toContainText('قلم');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('preview-only mode hides the editor and persists', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Preview only' }).click();

    await expect(page.getByRole('textbox')).toBeHidden();

    await page.reload();
    await expect(page.getByRole('textbox')).toBeHidden();
  });
});
