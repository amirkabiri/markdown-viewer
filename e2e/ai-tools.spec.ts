import { expect, test } from '@playwright/test';

/**
 * The v2 agent-tools journey, end to end against the production build:
 * search_document → replace_text → the pending-diff card → Apply lands the
 * edit in the editor as ONE undo step; Discard leaves the document untouched
 * and feeds the resolution back into the next send.
 *
 * Provider stubbing (house boundary, per e2e/preview-selection.spec.ts): the
 * settings point at an OpenAI-compatible service and `page.route` intercepts
 * chat/completions, answering each turn of the scripted agent conversation
 * with SSE delta frames. No network leaves the machine.
 *
 * The document is seeded through the REAL editor textarea (value + input
 * event — the same sync path a user's typing takes) so the scripted
 * SEARCH text is exact regardless of what the boot README contains.
 */

interface RecordedBody {
  messages: { role: string; content: string }[];
}

const SEED_DOC = [
  '# Tool demo',
  '',
  ...Array.from({ length: 25 }, (_, i) => `needle line ${i + 1} of the body`),
  '',
  'tail of the document',
  '',
].join('\n');

const REWRITTEN_BLOCK = Array.from({ length: 25 }, (_, i) => `edited verse ${i + 1}`).join('\n');
const ORIGINAL_BLOCK = Array.from({ length: 25 }, (_, i) => `needle line ${i + 1} of the body`).join('\n');

const searchTurn = [
  'Let me find the section.',
  '',
  '```qalam',
  '{"tool": "search_document", "args": {"pattern": "needle line"}}',
  '```',
].join('\n');

const replaceTurn = [
  'Found it. Proposing the rewrite.',
  '',
  '```qalam',
  '{"tool": "replace_text"}',
  '<<<<<<< SEARCH',
  ORIGINAL_BLOCK,
  '=======',
  REWRITTEN_BLOCK,
  '>>>>>>> REPLACE',
  '```',
].join('\n');

const closingTurn = 'Review the proposed edit and Apply it when ready.';

test.describe('AI v2 toolset journey', () => {
  test.beforeEach(async ({ page }) => {
    // External provider + direct editing ON (the agent may write).
    await page.addInitScript(() => {
      localStorage.setItem('mv:ai', JSON.stringify({
        provider: 'openai',
        baseUrl: 'https://ai.stub.invalid/v1',
        apiKey: 'stub-token',
        model: 'stub-model',
        directEdit: true,
      }));
    });
  });

  async function seedDocument(page: import('@playwright/test').Page): Promise<void> {
    await page.goto('/');
    await expect(page.getByRole('textbox')).toHaveValue(/# Qalam/);
    await page.evaluate((doc) => {
      const editor = document.querySelector('textarea');
      if (!editor) throw new Error('editor textarea missing');
      editor.value = doc;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }, SEED_DOC);
    await expect(page.getByRole('textbox')).toHaveValue(/^# Tool demo\n\nneedle line 1/);
  }

  async function stubAgent(page: import('@playwright/test').Page, bodies: RecordedBody[]): Promise<void> {
    const frame = (text: string): string => `data: ${JSON.stringify({
      choices: [{ delta: { content: text } }],
    })}\n\n`;
    const turns = [searchTurn, replaceTurn, closingTurn];
    let followUp = 0;
    const followUps = ['Understood.', 'Noted — I will not repeat it.'];
    await page.route('**/v1/chat/completions', async (route) => {
      bodies.push(JSON.parse(route.request().postData() ?? '{}') as RecordedBody);
      const reply = bodies.length <= turns.length
        ? turns[bodies.length - 1]
        : followUps[Math.min(followUp, followUps.length - 1)];
      followUp += 1;
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: `${frame(reply)}data: [DONE]\n\n`,
      });
    });
  }

  async function openPanelAndSend(page: import('@playwright/test').Page, question: string): Promise<void> {
    await page.getByRole('button', { name: 'AI assistant' }).click();
    const panel = page.getByRole('dialog', { name: 'AI assistant' });
    await expect(panel).toBeVisible();
    await panel.getByRole('textbox').fill(question);
    await panel.getByRole('button', { name: 'Send' }).click();
  }

  test('search → pending card → Apply lands the edit in the editor (one undo step)', async ({ page }) => {
    const bodies: RecordedBody[] = [];
    stubAgent(page, bodies);
    await seedDocument(page);
    await openPanelAndSend(page, 'replace the needle block');

    // Turn 2's request carries the structured search result (numbered hits).
    await expect.poll(() => bodies.length).toBeGreaterThan(1);
    const secondTurn = bodies[1];
    const lastUser = secondTurn.messages[secondTurn.messages.length - 1];
    expect(lastUser.role).toBe('user');
    expect(lastUser.content).toContain('TOOL RESULT (search_document)');
    expect(lastUser.content).toMatch(/3: needle line 1 of the body/);

    // The edit exceeds the auto-apply budget (50 changed lines) → a card.
    const panel = page.getByRole('dialog', { name: 'AI assistant' });
    const card = panel.getByRole('group', { name: 'Proposed edit' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('edited verse 1');
    await expect(card).toContainText('Pending review');
    const editor = page.getByRole('textbox', { name: 'Markdown source' });
    await expect(editor).toHaveValue(SEED_DOC); // untouched while pending

    await card.getByRole('button', { name: 'Apply' }).click();

    // The applied document text…
    const applied = SEED_DOC.replace(ORIGINAL_BLOCK, REWRITTEN_BLOCK);
    await expect(editor).toHaveValue(applied);
    await expect(card).toContainText('Applied');

    // …reverts in ONE undo step (the splice went through execCommand).
    await panel.getByRole('button', { name: 'Close' }).click();
    await editor.click();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor).toHaveValue(SEED_DOC);
  });

  test('Discard leaves the document untouched and reports back on the next send', async ({ page }) => {
    const bodies: RecordedBody[] = [];
    stubAgent(page, bodies);
    await seedDocument(page);
    await openPanelAndSend(page, 'replace the needle block');

    const panel = page.getByRole('dialog', { name: 'AI assistant' });
    const card = panel.getByRole('group', { name: 'Proposed edit' });
    await expect(card).toBeVisible();

    await card.getByRole('button', { name: 'Discard' }).click();

    // Nothing was written; the card and the activity row say so.
    await expect(page.getByRole('textbox', { name: 'Markdown source' })).toHaveValue(SEED_DOC);
    await expect(card).toContainText('Discarded');
    await expect(card.getByRole('button', { name: 'Apply' })).toHaveCount(0);

    // The NEXT send tells the model the proposal was discarded.
    await panel.getByRole('textbox').fill('ok, different approach');
    await panel.getByRole('button', { name: 'Send' }).click();
    await expect.poll(() => bodies.length).toBeGreaterThan(3);
    const lastBody = bodies[bodies.length - 1];
    const nextSend = lastBody.messages[0].content;
    expect(nextSend).toMatch(/DISCARDED by the user/);
  });
});
