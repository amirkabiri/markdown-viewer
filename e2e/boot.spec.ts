import {
  expect, test, type ConsoleMessage, type Page,
} from '@playwright/test';

/** Collect console errors and uncaught page errors so a test can assert none occurred. */
function trackBrowserErrors(page: Page): { consoleErrors: string[]; pageErrors: string[] } {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return { consoleErrors, pageErrors };
}

test.describe('app boot', () => {
  test('boots the React shell, shows the Qalam brand, with no browser errors', async ({ page }) => {
    const { consoleErrors, pageErrors } = trackBrowserErrors(page);

    await page.goto('/');

    // Landmarks give the shell an accessible structure from day one.
    await expect(page.getByRole('banner')).toContainText('Qalam');
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('contentinfo')).toContainText('Qalam');

    // CSP violations (e.g. the React/mount layer fighting the meta policy)
    // surface here as console errors — the production build must stay clean.
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
