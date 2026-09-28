import { expect, test } from '@playwright/test';

/**
 * Sidebar document management against the production build: every document
 * is a persisted record, so create/rename/remove/reorder all survive a
 * reload (autosave commits behind a 400 ms debounce; pagehide flushes and
 * the synchronous draft snapshot covers the in-flight tail). The panel
 * (aside#panel) scopes row locators away from the workspace. The new-document
 * flow closes the panel on purpose (focus goes to the editor) — reopen it
 * before row interactions.
 */
test.describe('sidebar document management', () => {
  test('creates a document, autosaves typed content, and restores it after a reload', async ({
    page,
  }) => {
    await page.goto('/');
    const editor = page.getByRole('textbox');
    await expect(editor).toHaveValue(/# Qalam/);

    await page.getByRole('button', { name: 'Toggle panel' }).click();
    await page.locator('#panel').getByRole('button', { name: 'New document' }).click();
    await expect(editor).toHaveValue('');

    await editor.fill('# Persisted doc\n\nwritten once, kept forever');

    // A reload fires pagehide → the repository flushes the pending save.
    await page.reload();
    await expect(editor).toHaveValue('# Persisted doc\n\nwritten once, kept forever');

    await page.getByRole('button', { name: 'Toggle panel' }).click();
    const panel = page.locator('#panel');
    await expect(panel.getByRole('button', { name: 'Untitled', exact: true })).toBeVisible();
    // The active-document pointer restored the SAME document.
    await expect(panel.getByRole('button', { name: 'README', exact: true })).toBeVisible();
  });

  test('renames a document inline and persists the new name', async ({ page }) => {
    await page.goto('/');
    const editor = page.getByRole('textbox');
    await expect(editor).toHaveValue(/# Qalam/);

    await page.getByRole('button', { name: 'Toggle panel' }).click();
    await page.locator('#panel').getByRole('button', { name: 'New document' }).click();
    await expect(editor).toHaveValue('');

    // The new-document flow closed the panel — reopen it for the row action.
    await page.getByRole('button', { name: 'Toggle panel' }).click();
    const panel = page.locator('#panel');
    const row = panel.getByRole('button', { name: 'Untitled', exact: true });
    await row.dblclick();
    await panel.getByLabel('Rename').fill('My notes');
    await panel.getByLabel('Rename').press('Enter');

    // Both the row and the workspace pane head show the new name.
    await expect(panel.getByRole('button', { name: 'My notes', exact: true })).toBeVisible();
    await expect(
      page.getByRole('main').getByRole('button', { name: 'My notes', exact: true }),
    ).toBeVisible();

    await page.reload();
    await page.getByRole('button', { name: 'Toggle panel' }).click();
    await expect(panel.getByRole('button', { name: 'My notes', exact: true })).toBeVisible();
  });

  test('removes a document only after an explicit confirmation', async ({ page }) => {
    await page.goto('/');
    const editor = page.getByRole('textbox');
    await expect(editor).toHaveValue(/# Qalam/);

    await page.getByRole('button', { name: 'Toggle panel' }).click();
    await page.locator('#panel').getByRole('button', { name: 'New document' }).click();
    await expect(editor).toHaveValue('');

    await page.getByRole('button', { name: 'Toggle panel' }).click();
    const panel = page.locator('#panel');
    const row = panel.getByRole('button', { name: 'Untitled', exact: true });
    await row.waitFor();

    await panel.getByRole('button', { name: /Document actions – Untitled/ }).click();
    await page.getByRole('menuitem', { name: 'Remove' }).click();

    // Non-dismissable confirm dialog, localized interpolated body.
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('will be permanently removed');

    await dialog.getByRole('button', { name: 'Remove' }).click();
    await expect(row).toBeHidden();
    // Removing the ACTIVE document falls back to the most recent one (README).
    await expect(editor).toHaveValue(/# Qalam/);
  });

  test('reorders documents by dragging a row grip and persists the order', async ({
    page,
  }) => {
    await page.goto('/');
    const editor = page.getByRole('textbox');
    await expect(editor).toHaveValue(/# Qalam/);

    const panel = page.locator('#panel');

    const createNamed = async (name: string): Promise<void> => {
      // Escape closes the panel deterministically (while it is open the
      // scrim blocks the toggle button — close via the keyboard, open via
      // the toggle), then create + rename.
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Toggle panel' }).click();
      await panel.getByRole('button', { name: 'New document' }).click();
      await expect(editor).toHaveValue('');
      await page.getByRole('button', { name: 'Toggle panel' }).click();
      await panel.getByRole('button', { name: 'Untitled', exact: true }).dblclick();
      await panel.getByLabel('Rename').fill(name);
      await panel.getByLabel('Rename').press('Enter');
      await expect(panel.getByRole('button', { name, exact: true })).toBeVisible();
    };

    await createNamed('Alpha drag');
    await createNamed('Beta drag');

    // Drag the README row below "Beta drag": the grip is the row's first
    // button (decorative, pointer-only — the menu offers the keyboard path).
    const sourceGrip = panel.locator('li', { hasText: 'README' }).locator('button').first();
    const target = await panel.locator('li', { hasText: 'Beta drag' }).boundingBox();
    const source = await sourceGrip.boundingBox();
    if (!source || !target) throw new Error('drag targets not visible');

    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    // Aim at the lower half of the target row — an unambiguous "insert after
    // this row" (hit-testing compares against the row's vertical midpoint).
    await page.mouse.move(
      target.x + target.width / 2,
      target.y + target.height * 0.8,
      { steps: 12 },
    );
    await page.mouse.up();

    await expect(panel.locator('li').nth(0)).toContainText('Alpha drag');
    await expect(panel.locator('li').nth(2)).toContainText('README');

    // The manual order is persisted — it survives a reload.
    await page.reload();
    await page.getByRole('button', { name: 'Toggle panel' }).click();
    await expect(panel.locator('li').nth(0)).toContainText('Alpha drag');
    await expect(panel.locator('li').nth(2)).toContainText('README');
  });

  test('legacy recents migration leaves one row per document', async ({ page }) => {
    // A browser profile that used the vanilla app: mv:recent holds absolute
    // urls the React boot also loads (the README boots by default). The
    // one-shot migration must adopt/skip same-url records, never surface the
    // same document twice in the sidebar.
    await page.addInitScript(() => {
      localStorage.setItem('mv:recent', JSON.stringify([
        { name: 'README', url: `${window.location.origin}/README.md` },
        { name: 'sample-fa', url: `${window.location.origin}/samples/sample-fa.md` },
      ]));
    });

    await page.goto('/');
    const editor = page.getByRole('textbox');
    await expect(editor).toHaveValue(/# Qalam/);

    await page.getByRole('button', { name: 'Toggle panel' }).click();
    const panel = page.locator('#panel');
    await expect(panel.getByRole('button', { name: 'README', exact: true })).toHaveCount(1);
    await expect(panel.getByRole('button', { name: 'sample-fa', exact: true })).toHaveCount(1);
  });
});
