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
 *
 * The "typing keeps the scroll position" tests guard the second regression
 * class: the preview's document-switch reset must fire on a document switch
 * only. Gating it on the debounced preview html instead dragged both panes
 * back to the top on every typing pause (the reset scrolled the preview,
 * and the preview→editor scroll sync mirrored 0 into the editor).
 */

/** Rounding slack for box measurements against the viewport. */
const EPS_PX = 2;

/** The preview scroll container — the pane div hosting the article. */
function previewScroll(page: Page) {
  return page.locator('div:has(> article)');
}

/** The editor's vertical scroll fraction (0 = top, 1 = bottom). */
function editorFraction(page: Page) {
  return page.getByRole('textbox').evaluate(
    (el) => el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight),
  );
}

/** Boots the README document and waits for editor + preview to render it. */
async function bootReadme(page: Page) {
  await page.goto('/');
  const editor = page.getByRole('textbox');
  await expect(editor).toHaveValue(/# Qalam/);
  await expect(page.locator('article h1')).toHaveText(/Qalam/);
  return editor;
}

/** Deep-link assertions measure GEOMETRY, and the app re-anchors the jump
 *  while late in-article assets (the README logo image, the CDN font face)
 *  reflow the article — so the gap is only meaningful once the layout is
 *  final. Polls to quiescence: no pending font loads and two identical
 *  half-px offset reads a beat apart. No sleeps. */
async function awaitDeepLinkSettled(page: Page, selector: string) {
  await expect.poll(async () => page.evaluate(async (sel) => {
    const read = () => {
      const sc = document.querySelector('div:has(> article)');
      const target = sc?.querySelector(sel);
      return target && sc
        ? Math.round((target.getBoundingClientRect().top + sc.scrollTop) * 2) / 2
        : Number.NaN;
    };
    const before = read();
    await new Promise((resolve) => {
      setTimeout(resolve, 150);
    });
    return document.fonts.status === 'loaded' && !Number.isNaN(before) && before === read();
  }, selector), { timeout: 10_000 }).toBe(true);
}

/** Resolves once every <img> matched by the selector has finished loading
 *  (complete or failed) — gate assertions on a specific late asset. */
async function awaitImagesSettled(page: Page, selector: string) {
  await expect.poll(async () => page.evaluate((sel) => {
    const imgs = [...document.querySelectorAll('article img')]
      .filter((img): img is HTMLImageElement => img instanceof HTMLImageElement)
      .filter((img) => img.matches(sel));
    return imgs.length > 0 && imgs.every((img) => img.complete);
  }, selector), { timeout: 10_000 }).toBe(true);
}

/** The vertical distance between the preview pane top and a target element. */
function deepLinkGap(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const sc = document.querySelector('div:has(> article)');
    const target = sc?.querySelector(sel);
    if (!sc || !target) return Number.POSITIVE_INFINITY;
    return Math.abs(target.getBoundingClientRect().top - sc.getBoundingClientRect().top);
  }, selector);
}

/** Types text at the editor caret and waits for the debounced preview update
 *  that proves the typing-driven re-render committed (no sleeps — the marker
 *  text only appears in the article once the debounce fired). The marker is
 *  passed as an evaluate argument: page-side functions are serialized, so
 *  they cannot close over Node variables. */
async function typeAndAwaitPreview(page: Page, text: string) {
  await page.keyboard.type(text);
  const marker = text.trim();
  await expect.poll(async () => page.locator('article').evaluate(
    (el, m) => el.textContent?.includes(m) ?? false,
    marker,
  ), { timeout: 5_000 }).toBe(true);
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

/** Holds the ?file= document fetch back by the given delay: the hash target
 *  then arrives well after the load event, when the browser's own deferred
 *  fragment scroll has long given up — the APP's jump becomes the only
 *  mechanism under test (regression check: break it, watch this go red). */
async function holdDocumentFetch(page: Page, ms: number) {
  await page.route('**/README.md', async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
    await route.fulfill({ response });
  });
}

test.describe('typing keeps the scroll position', () => {
  test('a typing pause does not drag the panes back to the top', async ({ page }) => {
    const editor = await bootReadme(page);
    const scroll = previewScroll(page);

    // Focus FIRST: webkit scrolls a focused textarea to its caret (top, at
    // this point) and the scroll sync mirrors that into the preview — so
    // the focus must land before the panes are parked, or that mirror
    // drags them back to the top mid-test.
    await editor.focus();
    await editor.evaluate((el) => {
      if (!(el instanceof HTMLTextAreaElement)) throw new Error('editor is not a textarea');
      el.setSelectionRange(el.value.length, el.value.length);
      // eslint-disable-next-line no-param-reassign
      el.scrollTop = el.scrollHeight;
    });

    // Park BOTH panes at their bottom (the preview drag mirrors into the
    // editor via scroll sync) — the stakeholder repro: type while scrolled
    // to the bottom.
    await scroll.evaluate((el) => {
      // eslint-disable-next-line no-param-reassign
      el.scrollTop = el.scrollHeight;
    });
    await expect.poll(() => editorFraction(page), { timeout: 5_000 }).toBeGreaterThan(0.8);

    // Type through THREE debounce windows: each marker only appears in the
    // article once its 300 ms preview re-render committed (no sleeps), and
    // by the third marker the 60 ms scroll-sync echo of the earlier commits
    // has certainly fired — the buggy reset cannot hide between polls.
    await typeAndAwaitPreview(page, ' ZMARKERONE');
    await typeAndAwaitPreview(page, ' ZMARKERTWO');
    await typeAndAwaitPreview(page, ' ZMARKERTHREE');

    // Content and caret survive; ONLY the view must not jump: the editor
    // stays scrolled (> 80% of its range) and the preview stays scrolled.
    expect(await editorFraction(page)).toBeGreaterThan(0.8);
    const previewTop = await scroll.evaluate((el) => el.scrollTop);
    expect(previewTop).toBeGreaterThan(0);
  });

  test('switching documents still resets the preview and editor to the top', async ({ page }) => {
    const editor = await bootReadme(page);
    const scroll = previewScroll(page);
    const panel = page.locator('#panel');

    // Switch OUT to the short feature tour first, then do the asserted
    // switch BACK to the taller README: a textarea scrolled deep into a
    // SHORTER document fires one clamp scroll event when the shorter
    // content is loaded into it, and that stale event re-mirrors the old
    // fraction through the scroll sync AFTER the reset (a Workspace sync
    // race orthogonal to the Preview gating under test). Sample-en →
    // README grows the content, so the carried-over scrollTop stays valid
    // and no clamp event can race the reset.
    await page.getByRole('button', { name: 'Toggle panel' }).click();
    await panel.getByRole('link', { name: 'Feature tour (EN)' }).click();
    await expect(page.locator('article h1')).toHaveText(/Feature Tour/);
    await expect(editor).not.toHaveValue(/# Qalam/);

    // Stamp every pane scroll so quiescence is observable (dataset, not a
    // closure — page-side functions are serialized, so they cannot close
    // over Node variables).
    await scroll.evaluate((el) => {
      el.addEventListener('scroll', () => {
        document.documentElement.dataset.mvPreviewScroll = String(Date.now());
      });
    });
    await editor.evaluate((el) => {
      el.addEventListener('scroll', () => {
        document.documentElement.dataset.mvEditorScroll = String(Date.now());
      });
    });

    // Park both panes at the bottom (the preview drag mirrors into the
    // editor via scroll sync) — the reset must clear BOTH.
    await scroll.evaluate((el) => {
      // eslint-disable-next-line no-param-reassign
      el.scrollTop = el.scrollHeight;
    });
    await expect
      .poll(() => editor.evaluate((el) => el.scrollTop), { timeout: 5_000 })
      .toBeGreaterThan(0);

    // The scroll sync suppresses echo scrolls for 60 ms; if the switch lands
    // inside that window, the reset's mirror into the editor gets eaten and
    // the editor legitimately stays scrolled. Poll for quiescence (one
    // lock window plus slack) so the asserted switch starts from a settled
    // sync state.
    const quiescent = () => page.evaluate(() => {
      const { mvPreviewScroll, mvEditorScroll } = document.documentElement.dataset;
      const last = Math.max(Number(mvPreviewScroll ?? 0), Number(mvEditorScroll ?? 0));
      return Date.now() - last > 150;
    });
    await expect.poll(quiescent, { timeout: 5_000 }).toBe(true);

    // The doc links close the panel on navigation — reopen for the way back.
    await page.getByRole('button', { name: 'Toggle panel' }).click();
    await panel.getByRole('link', { name: 'About this viewer' }).click();
    await expect(page.locator('article h1')).toHaveText(/Qalam/);
    await expect(editor).toHaveValue(/# Qalam/);

    // The document switch resets BOTH panes to the top. The preview lands
    // at exactly 0 (the Preview effect's contract). The editor follows
    // through the scroll-sync mirror, which the 60 ms echo lock may eat
    // when the switch displaces the textarea (firefox reveals the caret at
    // ~25 px on value replacement) — 25 px of a ~12 000 px document is
    // still "at the top", so the editor is asserted by fraction.
    await expect.poll(() => scroll.evaluate((el) => el.scrollTop), { timeout: 5_000 }).toBe(0);
    await expect
      .poll(() => editorFraction(page), { timeout: 5_000 })
      .toBeLessThan(0.05);
  });

  test('a ?file= deep link with a hash lands on the target heading', async ({ page }) => {
    // The hash must survive the async boot: the identity is set first, the
    // content renders right after — the jump fires once the target exists.
    await holdDocumentFetch(page, 600);
    await page.goto('/?file=README.md#why-qalam');
    const scroll = previewScroll(page);

    await expect(page.locator('article h2#why-qalam')).toHaveText(/Why Qalam/);
    await expect
      .poll(() => scroll.evaluate((el) => el.scrollTop), { timeout: 5_000 })
      .toBeGreaterThan(0);

    // block: 'start' — the heading aligns with the top of the pane and STAYS
    // there: the app re-anchors the jump while late in-article assets (the
    // README logo, the CDN font) reflow the article, so the asserted gap is
    // the SETTLED end state, not a snapshot taken mid-reflow.
    await awaitDeepLinkSettled(page, 'h2#why-qalam');
    expect(await deepLinkGap(page, 'h2#why-qalam')).toBeLessThanOrEqual(48);
  });

  test('a late-loading in-article asset cannot drag the deep link off target', async ({ page }) => {
    // The README logo ships no reserved layout box: while it loads, the
    // article reflows and the anchored heading used to end up ~90 px below
    // the pane top on webkit (gap measured against the PRE-image layout).
    // Hold the logo back until the jump has provably landed, then release
    // it — the reflow now hits exactly in the post-jump window where the
    // drift used to happen — and require the app to still finish with the
    // heading at the pane top (the re-anchor contract).
    let releaseLogo: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      releaseLogo = resolve;
    });
    await holdDocumentFetch(page, 600);
    await page.route('**/logo.svg', async (route) => {
      // Fetch the real response now; deliver it only when the test releases it.
      const response = await route.fetch();
      await released;
      await route.fulfill({ response });
    });
    await page.goto('/?file=README.md#why-qalam');
    const scroll = previewScroll(page);

    await expect(page.locator('article h2#why-qalam')).toHaveText(/Why Qalam/);
    await expect
      .poll(() => scroll.evaluate((el) => el.scrollTop), { timeout: 5_000 })
      .toBeGreaterThan(0);
    releaseLogo();

    // Only assert once the held-back asset has actually landed, then the
    // layout around the target must settle to the pane-top alignment.
    await awaitImagesSettled(page, 'img[src*="logo"]');
    await awaitDeepLinkSettled(page, 'h2#why-qalam');
    expect(await deepLinkGap(page, 'h2#why-qalam')).toBeLessThanOrEqual(48);
  });
});
