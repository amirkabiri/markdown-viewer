import {
  expect, test, type BrowserContext, type Locator, type Page,
} from '@playwright/test';

/**
 * Multi-tab behavior over one browser context: the pages share
 * localStorage + IndexedDB, BroadcastChannel and Web Locks — the exact
 * production multi-tab surface. Each test gets a fresh context.
 */
/**
 * A page inside the SHARED context — `browser.newPage()` would create a fresh
 * (storage-isolated) context per call, defeating the whole multi-tab premise.
 */
async function newTab(context: BrowserContext): Promise<{ page: Page; editor: Locator }> {
  const page = await context.newPage();
  await page.goto('http://localhost:4173/');
  const editor = page.getByRole('textbox');
  return { page, editor };
}

/** The committed content of a stored document, read from IndexedDB. */
async function storedContent(page: Page, name: string): Promise<string | undefined> {
  return page.evaluate(async (docName) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('qalam');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return new Promise<string | undefined>((resolve) => {
      const tx = db.transaction('documents', 'readonly');
      const req = tx.objectStore('documents').getAll();
      req.onsuccess = () => {
        const records = req.result as { name: string; content: string }[];
        resolve(records.find((record) => record.name === docName)?.content);
      };
      req.onerror = () => resolve(undefined);
    });
  }, name);
}

test.describe('multi-tab documents', () => {
  test('edits saved in tab A are restored when tab B boots', async ({ browser }) => {
    const context = await browser.newContext();
    const { page: a, editor: editorA } = await newTab(context);
    await expect(editorA).toHaveValue(/# Qalam/);

    await editorA.fill('# Written in tab A');
    // Wait for the autosave to COMMIT (poll the store — the debounce and the
    // reload-time draft adoption are invisible in the UI).
    await expect
      .poll(() => storedContent(a, 'README'), { timeout: 10_000 })
      .toBe('# Written in tab A');

    const { editor: editorB } = await newTab(context);
    // Tab B restores the same active document from the shared repository.
    await expect(editorB).toHaveValue('# Written in tab A');

    await context.close();
  });

  test('a document opened in a second tab is readonly until it takes over', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const { page: a, editor: editorA } = await newTab(context);
    await expect(editorA).toHaveValue(/# Qalam/);
    // Tab A holds the document lock for its editing session.

    const { page: b, editor: editorB } = await newTab(context);
    await expect(editorB).toHaveValue(/# Qalam/);
    await expect(b.getByRole('main').getByRole('status')).toHaveText(
      /Being edited in another tab/,
    );
    await expect(editorB).toHaveAttribute('readonly');

    // Tab B steals the lock: its own banner disappears and the editor opens.
    await b.getByRole('button', { name: 'Take over' }).click();
    await expect(b.getByRole('main').getByRole('status')).toBeHidden();
    await expect(editorB).not.toHaveAttribute('readonly');

    // Tab A's session was stolen: it flips readonly with the same banner.
    await expect(a.getByRole('main').getByRole('status')).toHaveText(
      /Being edited in another tab/,
    );
    await expect(editorA).toHaveAttribute('readonly');

    await context.close();
  });

  test('a document created in tab A appears in tab B without a reload', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const { page: a } = await newTab(context);
    await expect(a.getByRole('textbox')).toHaveValue(/# Qalam/);
    const { page: b } = await newTab(context);
    await expect(b.getByRole('textbox')).toHaveValue(/# Qalam/);

    await a.getByRole('button', { name: 'Toggle panel' }).click();
    await b.getByRole('button', { name: 'Toggle panel' }).click();

    const panelB = b.locator('#panel');
    await expect(panelB.getByRole('button', { name: 'README', exact: true })).toBeVisible();

    // Creating in A closes A's panel (editor focus) — B's list still updates
    // live through the sync hub, without a reload.
    await a.locator('#panel').getByRole('button', { name: 'New document' }).click();
    await expect(panelB.getByRole('button', { name: 'Untitled', exact: true })).toBeVisible();

    await context.close();
  });
});
