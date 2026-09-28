import AxeBuilder from '@axe-core/playwright';
import {
  expect, test, type BrowserContext, type Page,
} from '@playwright/test';

/**
 * Automated a11y scans (axe-core) over the app's UI states, against the
 * production build. House bar: ZERO serious/critical violations. Minor
 * violations are assessed if they ever surface (accepted ones get documented
 * here with rationale). The deeper manual-equivalent behaviors — skip link,
 * dialog focus trap + restore, icon-button names, document-list roving
 * focus, reduced motion, contrast tokens — are covered by component tests
 * and the theme tokens; these scans catch whatever slips past.
 */

/** The gate: nothing serious or critical may ship. */
async function seriousOrCritical(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
}

test.describe('accessibility scans', () => {
  test('boot view (split editor/preview with the README) is clean', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('textbox')).toHaveValue(/# Qalam/);

    expect(await seriousOrCritical(page)).toEqual([]);
  });

  test('the Open dialog is clean', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('textbox')).toHaveValue(/# Qalam/);

    await page.getByRole('button', { name: 'Open' }).click();
    await expect(page.getByRole('heading', { name: 'Open a document' })).toBeVisible();

    expect(await seriousOrCritical(page)).toEqual([]);
  });

  test('the AI panel is clean', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('textbox')).toHaveValue(/# Qalam/);

    await page.getByRole('button', { name: 'AI assistant' }).click();
    const panel = page.getByRole('dialog', { name: 'AI assistant' });
    await expect(panel).toBeVisible();
    // The builtin availability machine settles right after mount (checking →
    // unavailable/downloadable/…); wait it out so the scan sees final UI.
    await expect(panel.getByRole('status')).not.toContainText(
      'Checking AI availability',
      { timeout: 15_000 },
    );

    expect(await seriousOrCritical(page)).toEqual([]);
  });

  test('the keyboard-shortcuts cheat sheet is clean', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('textbox')).toHaveValue(/# Qalam/);

    await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
    // The boot README also has a "Keyboard shortcuts" heading — scope to the
    // dialog.
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(sheet).toBeVisible();

    expect(await seriousOrCritical(page)).toEqual([]);
  });

  test('the readonly-session banner state is clean', async ({ browser }) => {
    const context: BrowserContext = await browser.newContext();
    const holder = await context.newPage();
    await holder.goto('/');
    await expect(holder.getByRole('textbox')).toHaveValue(/# Qalam/);

    // A second tab on the same storage sees the "edited elsewhere" banner.
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByRole('main').getByRole('status')).toHaveText(
      /Being edited in another tab/,
    );

    expect(await seriousOrCritical(page)).toEqual([]);
    await context.close();
  });
});
