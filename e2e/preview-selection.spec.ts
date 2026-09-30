import { expect, test } from '@playwright/test';

/**
 * The preview-selection → AI journey, end to end against the production
 * build: select text in the PREVIEW pane → the "Ask AI about this"
 * affordance floats → activating it opens the AI panel with the excerpt as
 * visible, removable composer context → sending delivers ONE provider
 * request whose messages carry both the excerpt (delimited as data) and the
 * user's prompt.
 *
 * The selection is made with REAL user input: a trusted mouse drag across
 * the first two text-rich blocks. Programmatic `selection.addRange()` does
 * not reliably surface `selectionchange` in headless browsers, but trusted
 * input events fire it in every engine (learned the hard way — the pill is
 * the gate under test, so the selection must be exactly what a user makes).
 *
 * Provider stubbing (house boundary): the settings point at an OpenAI-
 * compatible service and `page.route` intercepts the chat/completions call,
 * answering with SSE delta frames — the app streams a real reply while the
 * test records the exact request body. No network leaves the machine.
 */

interface RecordedBody {
  messages: { role: string; content: string }[];
}

/** A block's viewport box (the fields the drag math needs). */
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

test.describe('preview selection → AI', () => {
  test.beforeEach(async ({ page }) => {
    // External provider: CI browsers have no on-device model.
    await page.addInitScript(() => {
      localStorage.setItem('mv:ai', JSON.stringify({
        provider: 'openai',
        baseUrl: 'https://ai.stub.invalid/v1',
        apiKey: 'stub-token',
        model: 'stub-model',
      }));
    });
  });

  test('feeds a preview selection to the AI with the user’s prompt in one message', async ({ page }) => {
    const bodies: RecordedBody[] = [];
    await page.route('**/v1/chat/completions', async (route) => {
      bodies.push(JSON.parse(route.request().postData() ?? '{}') as RecordedBody);
      const frame = (text: string): string => `data: ${JSON.stringify({
        choices: [{ delta: { content: text } }],
      })}\n\n`;
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: `${frame('It says hello.')}data: [DONE]\n\n`,
      });
    });

    await page.goto('/');
    // The boot document (the repo README) loads through the async repository;
    // every Range/selection math below must run against the loaded article.
    await expect(page.getByRole('textbox')).toHaveValue(/# Qalam/);
    await expect(page.locator('article p').first()).toBeVisible();

    // The first two text-rich paragraphs (early README paragraphs can be
    // badge images) and their real layout boxes — computed per engine AFTER
    // the document settles. rich[0] is scrolled to the top of the preview so
    // BOTH blocks sit inside the (720px-tall, headless) viewport: a drag
    // endpoint below the fold makes the engine anchor a document-wide
    // selection instead of the intended one. The drag starts on the leading
    // edge of the first block and ends mid-way into the second, so the
    // selection spans two blocks and both of their leading texts are
    // guaranteed inside it.
    const drag = await page.evaluate(() => {
      const article = document.querySelector('article');
      if (!article) throw new Error('preview article missing');
      const rich = [...article.querySelectorAll('p')]
        .filter((p) => (p.textContent ?? '').trim().length >= 40);
      if (rich.length < 2) throw new Error('need two text-rich preview paragraphs');
      rich[0].scrollIntoView({ block: 'start', behavior: 'instant' });
      const box = (el: Element): Box => {
        const r = el.getBoundingClientRect();
        return {
          x: r.x, y: r.y, width: r.width, height: r.height,
        };
      };
      const start = box(rich[0]);
      const endBox = box(rich[1]);
      // The drag endpoint: horizontally centered, vertically in the upper
      // half of block 2 — and always inside the visible viewport.
      const end: Box = {
        x: endBox.x,
        y: endBox.y,
        width: endBox.width,
        height: Math.min(endBox.height / 2, Math.max(window.innerHeight - 24 - endBox.y, 16)),
      };
      return {
        start,
        end,
        text1: (rich[0].textContent ?? '').trim().slice(0, 40),
        text2: (rich[1].textContent ?? '').trim().slice(0, 40),
      };
    });
    expect(drag.text1.length).toBeGreaterThanOrEqual(40);
    expect(drag.text2.length).toBeGreaterThanOrEqual(40);

    const ask = page.getByRole('button', { name: 'Ask AI about this' });
    // Trusted drag-select (mouse down → sweep → up). Re-attempted only so a
    // late boot-swap of the article (full-suite load) can never leave the
    // gate half-run: the drag itself is always the same real user gesture.
    await expect(async () => {
      await page.mouse.move(drag.start.x + 2, drag.start.y + 3);
      await page.mouse.down();
      await page.mouse.move(
        drag.end.x + drag.end.width / 2,
        drag.end.y + drag.end.height / 2,
        { steps: 8 },
      );
      await page.mouse.up();
      await expect(ask).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await ask.click(); // the panel is closed → activation must open it

    const panel = page.getByRole('dialog', { name: 'AI assistant' });
    await expect(panel).toBeVisible();
    const chip = panel.getByRole('group', { name: 'From the preview' });
    await expect(chip).toBeVisible();
    // The user SEES what will be sent — both blocks of the cross-block drag.
    await expect(chip).toContainText(drag.text1);
    await expect(chip).toContainText(drag.text2);

    await panel.getByRole('textbox').fill('explain this paragraph');
    await panel.getByRole('button', { name: 'Send' }).click();

    // ONE request; the user message carries prompt AND excerpt-as-data.
    await expect.poll(() => bodies.length).toBeGreaterThan(0);
    const { messages } = bodies[0];
    const lastUser = messages[messages.length - 1];
    expect(lastUser.role).toBe('user');
    expect(lastUser.content).toContain('explain this paragraph');
    expect(lastUser.content).toContain('<document_excerpt>');
    expect(lastUser.content).toContain(drag.text1);
    expect(lastUser.content).toContain(drag.text2);
    // Injection hygiene rides on the system message.
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('never instructions');

    // The stubbed provider's reply streams into the panel; context consumed.
    await expect(panel.getByText('It says hello.')).toBeVisible();
    await expect(chip).not.toBeVisible();
  });
});
