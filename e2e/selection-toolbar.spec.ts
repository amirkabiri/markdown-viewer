import { expect, test, type Page } from '@playwright/test';

/**
 * Selection toolbar (floating markdown formatting menu over an editor
 * selection). Real engines only, per TESTING.md: word selection, caret
 * geometry, the native undo stack and RAC's focus restore are browser
 * behaviors with no jsdom oracle.
 *
 * Journey (research §4 gates): double-click a word → the toolbar floats
 * after its settle debounce → Bold wraps it in **…** as ONE undo step →
 * Mod/Ctrl+Z reverts exactly → Escape dismisses and typing lands back in
 * the editor. The RTL case flips the menu to the document's side.
 */

const DOC = 'Bleeding ink on paper\nSecond line here';
const DOC_FA = 'قلم و مرکب\nخط دوم';

function editor(page: Page) {
  return page.getByRole('textbox');
}

function toolbar(page: Page) {
  return page.getByRole('menu', { name: 'Formatting' });
}

/** Boots the app and waits for the boot README's ASYNC hydration to settle
 *  — a document written before it lands gets clobbered by loadDocument. */
async function boot(page: Page) {
  await page.goto('/');
  await expect(editor(page)).toHaveValue(/# Qalam/);
}

/** Loads `text` the way the app's own loadDocument does — value write plus
 *  one input event for the controller's mirror (line-numbers.spec pattern). */
async function loadDocumentText(page: Page, text: string) {
  await editor(page).evaluate((el, t) => {
    if (!(el instanceof HTMLTextAreaElement)) throw new Error('editor is not a textarea');
    // eslint-disable-next-line no-param-reassign
    el.value = t;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
  await expect(editor(page)).toHaveValue(text);
}

test.describe('selection toolbar', () => {
  test('select a word by mouse, Bold wraps it, undo reverts in one step', async ({ page }) => {
    await boot(page);
    await loadDocumentText(page, DOC);

    // Mouse selection: a double-click selects the word under the pointer
    // (native behavior — the toolbar is pointer-driven, research §4).
    await editor(page).dblclick({ position: { x: 70, y: 30 } });
    await expect(toolbar(page)).toBeVisible();
    // The menu floats over the selection, on the document's side (LTR).
    const menuBox = await toolbar(page).boundingBox();
    const editorBox = await editor(page).boundingBox();
    expect(menuBox && editorBox).toBeTruthy();
    expect(menuBox!.x).toBeLessThan(editorBox!.x + editorBox!.width / 2);

    await page.getByRole('menuitem', { name: 'Bold' }).click();
    await expect(editor(page)).toHaveValue('**Bleeding** ink on paper\nSecond line here');

    // Every toolbar action is ONE native undo step — a single Mod/Ctrl+Z
    // restores the document byte-for-byte.
    await editor(page).press('ControlOrMeta+z');
    await expect(editor(page)).toHaveValue(DOC);
  });

  test('Escape dismisses and typing lands back in the editor', async ({ page }) => {
    await boot(page);
    await loadDocumentText(page, DOC);

    await editor(page).dblclick({ position: { x: 70, y: 30 } });
    await expect(toolbar(page)).toBeVisible();

    await editor(page).press('Escape');
    await expect(toolbar(page)).toHaveCount(0);
    await expect(editor(page)).toHaveValue(DOC);

    // Focus restore (RAC FocusScope): keystrokes go to the editor again.
    // The live selection is still the word, so the keypress replaces it.
    await editor(page).press('x');
    await expect(editor(page)).toHaveValue('x ink on paper\nSecond line here');
  });

  test('an RTL document shows the menu on the right (document direction)', async ({ page }) => {
    await boot(page);
    // The direction toggle cycles Auto → LTR → RTL; force RTL.
    const dirToggle = page.getByRole('button', { name: 'Text direction (Auto / LTR / RTL)' });
    await dirToggle.click();
    await dirToggle.click();
    await expect(editor(page)).toHaveAttribute('dir', 'rtl');

    await loadDocumentText(page, DOC_FA);
    // The first word of an RTL line sits at the top-RIGHT.
    const editorBox = await editor(page).boundingBox();
    expect(editorBox).toBeTruthy();
    await editor(page).dblclick({
      position: { x: editorBox!.width - 70, y: 30 },
    });
    await expect(toolbar(page)).toBeVisible();

    const menuBox = await toolbar(page).boundingBox();
    expect(menuBox).toBeTruthy();
    // Placement follows the DOCUMENT's direction: the menu sits on the
    // right half of the editor, mirrored from the LTR case.
    expect(menuBox!.x).toBeGreaterThan(editorBox!.x + editorBox!.width / 2);
  });
});
