import {
  expect, test, type ConsoleMessage, type Page,
} from '@playwright/test';

/**
 * Boot-page console errors split into two classes:
 *
 * 1. APP errors — a CSP violation fighting the meta policy, or any uncaught
 *    exception. These are regressions and MUST fail the suite. CSP refusals
 *    are reported with the incurring document as their location (the app
 *    origin); uncaught exceptions arrive on the separate pageerror channel.
 *
 * 2. ENVIRONMENT noise from the page's third-party content — the boot
 *    document is this repo's README (external CI-badge image) and index.html
 *    pulls the Vazirmatn font CSS from cdn.jsdelivr.net. Under real-network
 *    variance those report through the console in engine-specific shapes and
 *    flaked this suite exactly once in a full 3-engine run (three reruns
 *    clean; six subsequent local full runs clean) before the second
 *    signature reproduced live: chromium logs "Failed to load resource:
 *    net::ERR_*"; firefox logs cross-site cookie rejections from
 *    github.com's badge.svg as "[JavaScript Error: \"Cookie … rejected …\"]"
 *    attributed to the REMOTE file. Neither can be caused by app code, and
 *    the app degrades by design (font falls back; a broken image renders as
 *    a broken image). They are ignored — but only when attributed to a
 *    foreign origin or the network layer, so own-origin app errors always
 *    count.
 */
function isAppConsoleError(message: ConsoleMessage, page: Page): boolean {
  // Chromium/WebKit network-layer resource failures (no app code involved;
  // a genuinely broken same-origin asset fails the landmark assertions
  // below anyway, because the shell cannot boot without it).
  if (/^Failed to load resource/.test(message.text())) return false;
  const file = message.location()?.url ?? '';
  if (!file) return true;
  try {
    return new URL(file).origin === new URL(page.url()).origin;
  } catch {
    return true; // unparseable location — count it, fail loud
  }
}

/** Collect console errors and uncaught page errors so a test can assert none occurred. */
function trackBrowserErrors(page: Page): { consoleErrors: string[]; pageErrors: string[] } {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error' && isAppConsoleError(message, page)) {
      consoleErrors.push(message.text());
    }
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

  test('the boot README renders its repo-relative logo image', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('article h1')).toHaveText(/Qalam/);

    // The README references public/logo.svg relative to the repo — the build
    // mirrors it to dist/public/ so the preview's first image actually loads
    // (a 404 would fall back to index.html and render as a broken image).
    const logo = page.locator('article img').first();
    await expect(logo).toBeVisible();
    await expect
      .poll(() => logo.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
  });
});
