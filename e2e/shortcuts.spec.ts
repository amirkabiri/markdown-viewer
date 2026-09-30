import { expect, test } from '@playwright/test';

/**
 * A MOVED global shortcut fires end-to-end on the production build
 * (docs/SHORTCUTS.md conflict audit: Mod+O — the browsers' Open File combo —
 * moved to Mod+Alt+O). Chromium carries the assertion; the unit layer
 * (shortcuts.test.ts) proves both platforms' matchers, the reserved-combo
 * invariant and the cheat-sheet rendering from the same table.
 *
 * `mod` is ⌘ on macOS and Ctrl elsewhere (matchesCombo), so pick the
 * modifier from the OS the suite runs on.
 */
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('moved shortcut bindings', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'binding journey on the primary engine');

  test('Mod+Alt+O opens the Open dialog (moved off the browser-reserved Mod+O)', async ({ page }) => {
    await page.goto('/');
    const editor = page.getByRole('textbox');
    await expect(editor).toHaveValue(/# Qalam/);

    // The old combo must be inert — no app dialog opens from it.
    await page.keyboard.press(`${MOD}+o`);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.keyboard.press(`${MOD}+Alt+o`);

    const dialog = page.getByRole('dialog', { name: 'Open a document' });
    await expect(dialog).toBeVisible();

    // Escape closes the dialog again (closeLayer stays bound).
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });
});
