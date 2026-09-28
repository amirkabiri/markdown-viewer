// Component tests for <AiPanel /> — jsdom + RTL per TESTING.md, with house
// fakes at every boundary (ai-fakes.ts):
//   builtin  → FakeLanguageModel on the ambient window.LanguageModel boundary
//   external → stubFetch(): SSE delta queues over real ReadableStream Responses
//   editor   → recording FakeEditorApi
// Coverage here: the three stakeholder UX requirements (first-send loading
// feedback, explicit download consent, visible tool activity) plus direct-edit
// gating, selection pinning, and Esc. Settings save/status/repair live in
// AiSettingsForm.test.tsx.

import {
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import AiPanel from './AiPanel';
import {
  createFakeEditor,
  FakeLanguageModel,
  installMatchMediaStub,
  makeT,
  stubFetch,
  uninstallFakeLanguageModel,
} from './ai-fakes';
import type { FakeLanguageModel as FakeLanguageModelType } from './ai-fakes';

const t = makeT('en');
const composer = () => screen.getByRole('textbox', { name: /Ask the assistant/ });
const sendButton = () => screen.getByRole('button', { name: 'Send' });

/** Seeds mv:ai (the real jsdom localStorage is the store boundary). */
function seedSettings(settings: Record<string, unknown>): void {
  const defaults = {
    provider: 'builtin', baseUrl: '', apiKey: '', model: '',
  };
  localStorage.setItem('mv:ai', JSON.stringify({ ...defaults, ...settings }));
}

let installedLm: FakeLanguageModelType | null = null;

type FakeAvailabilityArg = ConstructorParameters<typeof FakeLanguageModel>[0];

function installLm(availability: FakeAvailabilityArg): FakeLanguageModelType {
  installedLm = new FakeLanguageModel(availability);
  installedLm.install();
  return installedLm;
}

/** Waits until the availability machine settles and the composer unlocks. */
async function awaitComposerReady(): Promise<void> {
  // The textbox carries the can-attempt state (the send button additionally
  // disables on an empty draft — legacy-style empty sends just no-op).
  await waitFor(() => expect(composer()).toBeEnabled());
}

beforeAll(() => {
  installMatchMediaStub();
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  if (installedLm) {
    uninstallFakeLanguageModel();
    installedLm = null;
  }
  vi.unstubAllGlobals();
});

describe('<AiPanel /> — first-send loading feedback', () => {
  it('shows a labeled loading state from send until the first streamed event (builtin)', async () => {
    const lm = installLm('available');
    const editor = createFakeEditor('# Doc');
    render(<AiPanel editor={editor} t={t} lang="en" />);
    await awaitComposerReady();

    await userEvent.type(composer(), 'hello');
    await userEvent.click(sendButton());

    // LanguageModel.create() can take a while — the wait is labeled, the
    // composer is disabled, and the pending bubble shows the affordance.
    await screen.findAllByText('Starting the on-device model…');
    expect(sendButton()).toBeDisabled();
    expect(composer()).toBeDisabled();

    const session = lm.openSession();
    await waitFor(() => expect(session.queues.length).toBeGreaterThan(0));
    session.queues[0].push('Hello there');
    session.queues[0].end();

    expect(await screen.findByText('Hello there')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryAllByText('Starting the on-device model…')).toHaveLength(0);
    });
    // busy is released: the composer unlocks for a follow-up message (the
    // button itself stays disabled while the draft is empty, like legacy).
    await userEvent.type(composer(), ' and more');
    await waitFor(() => expect(sendButton()).toBeEnabled());
  });

  it('shows a labeled connecting state for an external provider until the first event', async () => {
    seedSettings({ provider: 'openai', baseUrl: 'https://api.example.com/v1', model: 'gpt-test' });
    const { fetch, queues } = stubFetch();
    vi.stubGlobal('fetch', fetch);
    const editor = createFakeEditor('# Doc');
    render(<AiPanel editor={editor} t={t} lang="en" />);

    await userEvent.type(composer(), 'hi there');
    await userEvent.click(sendButton());

    await screen.findAllByText('Connecting to the OpenAI-compatible service…');
    expect(sendButton()).toBeDisabled();
    expect(composer()).toBeDisabled();

    await waitFor(() => expect(queues.length).toBeGreaterThan(0));
    queues[0].delta('Hey — hi!');
    queues[0].end();

    expect(await screen.findByText('Hey — hi!')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryAllByText(/Connecting to the OpenAI-compatible service/)).toHaveLength(0);
    });
    // busy is released: the composer unlocks for a follow-up message.
    await userEvent.type(composer(), ' and more');
    await waitFor(() => expect(sendButton()).toBeEnabled());
  });
});

describe('<AiPanel /> — explicit ~4 GB download consent', () => {
  it('asks for consent when the user tries the downloadable model, and never auto-downloads', async () => {
    const lm = installLm('downloadable');
    const editor = createFakeEditor('# Doc');
    render(<AiPanel editor={editor} t={t} lang="en" />);
    // The explicit settings-side download path is present too (legacy parity).
    expect(await screen.findByRole('button', { name: 'Download AI model (~4 GB)' })).toBeInTheDocument();

    await userEvent.type(composer(), 'rewrite this');
    await userEvent.click(sendButton());

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('about 4 GB');
    expect(within(dialog).getByRole('button', { name: 'Download' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    expect(lm.createCalls).toBe(0); // nothing started without the explicit press
  });

  it('keeps the draft and shows the honest explainer after "Not now"', async () => {
    installLm('downloadable');
    const editor = createFakeEditor('# Doc');
    render(<AiPanel editor={editor} t={t} lang="en" />);
    await awaitComposerReady();
    await userEvent.type(composer(), 'rewrite this');
    await userEvent.click(sendButton());

    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Not now' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByText(/This app makes no network calls/)).toBeInTheDocument();
    expect(composer()).toHaveValue('rewrite this'); // draft preserved
    expect(editor.doc).toBe('# Doc'); // nothing was applied or downloaded
  });

  it('starts the download only on the explicit Download press, then proceeds with the message', async () => {
    const lm = installLm('downloadable');
    const editor = createFakeEditor('# Doc');
    render(<AiPanel editor={editor} t={t} lang="en" />);
    await awaitComposerReady();
    await userEvent.type(composer(), 'rewrite this');
    await userEvent.click(sendButton());

    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Download' }));

    // Live progress while the one-time download runs (legacy monitor pattern).
    expect(await screen.findByText(/Downloading model/)).toBeInTheDocument();
    lm.emitProgress(0.4);
    expect(await screen.findByText(/40%/)).toBeInTheDocument();

    // Download finishes (create resolves) → the queued message is sent.
    const session = lm.openSession();
    await waitFor(() => expect(session.queues.length).toBeGreaterThan(0));
    session.queues[0].push('Here is your rewritten text');
    session.queues[0].end();

    expect(await screen.findByText('Here is your rewritten text')).toBeInTheDocument();
    expect(composer()).toHaveValue(''); // the draft was consumed by the send
  });
});

describe('<AiPanel /> — visible tool activity', () => {
  it('renders the tool name, mode label, and the refused outcome for a blocked edit', async () => {
    seedSettings({ provider: 'openai', baseUrl: 'https://api.example.com/v1', model: 'gpt-test' });
    const { fetch, queues } = stubFetch();
    vi.stubGlobal('fetch', fetch);
    const editor = createFakeEditor('# Doc');
    render(<AiPanel editor={editor} t={t} lang="en" />);

    await userEvent.type(composer(), 'append a tail');
    await userEvent.click(sendButton());
    await waitFor(() => expect(queues.length).toBeGreaterThan(0));

    const fence = `\`\`\`qalam\n${JSON.stringify({
      tool: 'edit_document',
      args: { mode: 'append', text: 'TAIL' },
    })}\n\`\`\``;
    queues[0].delta(`Let me try.\n\n${fence}`);
    queues[0].end();

    // Direct editing is OFF → the executor refuses without touching the editor;
    // the entry stays in the chat audit trail.
    const activity = await screen.findByText('Refused');
    expect(activity.closest('ul')).toHaveTextContent('edit_document');
    expect(activity.closest('ul')).toHaveTextContent('Append');
    expect(editor.doc).toBe('# Doc'); // document untouched
    expect(editor.edits).toHaveLength(0); // never even reached the editor
  });
});

describe('<AiPanel /> — direct-edit gating', () => {
  it('tells the agent it is read-only when direct editing is off', async () => {
    seedSettings({ provider: 'openai', baseUrl: 'https://api.example.com/v1', model: 'gpt-test' });
    const { fetch, requests, queues } = stubFetch();
    vi.stubGlobal('fetch', fetch);
    const editor = createFakeEditor('# Doc');
    render(<AiPanel editor={editor} t={t} lang="en" />);

    await userEvent.type(composer(), 'improve this');
    await userEvent.click(sendButton());
    await waitFor(() => expect(requests.length).toBeGreaterThan(0));

    const body = requests[0].body as { messages: { role: string; content: string }[] };
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('READ-ONLY access');

    // The chat is the audit trail: the agent suggests text in its reply.
    await waitFor(() => expect(queues.length).toBeGreaterThan(0));
    queues[0].delta('Here is the suggested text instead.');
    queues[0].end();
    expect(await screen.findByText(/suggested text/)).toBeInTheDocument();
  });

  it('applies edits via editor.applyEdit when direct editing is on', async () => {
    seedSettings({
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-test',
      directEdit: true,
    });
    const { fetch, requests, queues } = stubFetch();
    vi.stubGlobal('fetch', fetch);
    const editor = createFakeEditor('# Doc', [5, 5]); // caret at the end
    render(<AiPanel editor={editor} t={t} lang="en" />);

    await userEvent.type(composer(), 'append a line');
    await userEvent.click(sendButton());
    await waitFor(() => expect(requests.length).toBeGreaterThan(0));

    const body = requests[0].body as { messages: { role: string; content: string }[] };
    expect(body.messages[0].content).not.toContain('READ-ONLY access');

    await waitFor(() => expect(queues.length).toBeGreaterThan(0));
    const fence = `\`\`\`qalam\n${JSON.stringify({
      tool: 'edit_document',
      args: { mode: 'cursor', text: '\nAppended line' },
    })}\n\`\`\``;
    queues[0].delta(`Done.\n\n${fence}`);
    queues[0].end();

    const activity = await screen.findByLabelText('Agent activity');
    expect(activity).toHaveTextContent('OK');
    expect(editor.edits[0]).toEqual({ mode: 'cursor', text: '\nAppended line' });
    expect(editor.doc).toBe('# Doc\nAppended line');
  });
});

describe('<AiPanel /> — selection-aware chat', () => {
  it('shows the selection chip and pins replace-selection to the captured range', async () => {
    seedSettings({
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-test',
      directEdit: true,
    });
    const { fetch, requests, queues } = stubFetch();
    vi.stubGlobal('fetch', fetch);
    const editor = createFakeEditor('# Title\n\nBody text here', [9, 23]);
    render(<AiPanel editor={editor} t={t} lang="en" />);

    expect(screen.getByText(/Editing selection · 14/)).toBeInTheDocument();

    await userEvent.type(composer(), 'make it formal');
    await userEvent.click(sendButton());
    await waitFor(() => expect(requests.length).toBeGreaterThan(0));

    // The selection-aware prompt (buildSelectionMessages) + the pin directive.
    const body = requests[0].body as { messages: { role: string; content: string }[] };
    expect(body.messages[0].content).toContain('"replace-selection" mode');
    const userMessage = body.messages[body.messages.length - 1];
    expect(userMessage.content).toContain('<selection>\nBody text here\n</selection>');

    // The rewrite lands in the captured range via the pinned applyEdit.
    await waitFor(() => expect(queues.length).toBeGreaterThan(0));
    const fence = `\`\`\`qalam\n${JSON.stringify({
      tool: 'edit_document',
      args: { mode: 'replace-selection', text: 'FORMAL TEXT' },
    })}\n\`\`\``;
    queues[0].delta(`Certainly.\n\n${fence}`);
    queues[0].end();

    const activity = await screen.findByLabelText('Agent activity');
    expect(activity).toHaveTextContent('Replace selection');
    expect(activity).toHaveTextContent('OK');
    expect(editor.edits[0]?.pinnedRange).toEqual([9, 23]);
    expect(editor.doc).toBe('# Title\n\nFORMAL TEXT');
  });
});

describe('<AiPanel /> — panel chrome', () => {
  it('closes on Escape', async () => {
    installLm('unavailable');
    render(<AiPanel editor={createFakeEditor('')} t={t} lang="en" />);
    expect(screen.getByRole('dialog', { name: 'AI assistant' })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows the honest unavailable explainer when the browser has no on-device model', async () => {
    installLm('unavailable');
    render(<AiPanel editor={createFakeEditor('')} t={t} lang="en" />);

    expect(await screen.findByText(/This app makes no network calls/)).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
  });
});
