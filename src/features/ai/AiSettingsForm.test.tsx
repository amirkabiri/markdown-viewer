// Component tests for the provider settings flow (disclosure inside the panel
// — legacy parity): Save validates + persists via the mv:ai store (the real
// jsdom localStorage is the boundary), the status line reflects readiness, a
// toast confirms the save, and hostile stored payloads repair to defaults.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach, beforeAll, beforeEach, describe, expect, it, vi,
} from 'vitest';
import AiPanel from './AiPanel';
import { createFakeEditor, installMatchMediaStub, makeT } from './ai-fakes';

const t = makeT('en');

function renderPanel(): void {
  render(<AiPanel editor={createFakeEditor('')} t={t} lang="en" />);
}

async function openSettings(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: /AI service/ }));
}

beforeAll(() => {
  installMatchMediaStub();
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AI provider settings', () => {
  it('saves a complete external provider draft, persists it, and flips the status line', async () => {
    renderPanel();
    await openSettings();

    // The Select trigger reads as the current provider value.
    await userEvent.click(screen.getByRole('button', { name: /Built-in \(on-device\)/ }));
    await userEvent.click(screen.getByRole('option', { name: 'OpenAI-compatible' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Base URL' }), 'https://api.example.com/v1');
    await userEvent.type(screen.getByRole('textbox', { name: 'Model' }), 'gpt-test');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    const stored = JSON.parse(localStorage.getItem('mv:ai') ?? '{}') as Record<string, unknown>;
    expect(stored).toMatchObject({
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-test',
    });

    expect(await screen.findByText('Ready — external AI service configured.')).toBeInTheDocument();
    expect(await screen.findByText('AI settings saved')).toBeInTheDocument(); // toast
  });

  it('keeps an incomplete external provider disabled with an honest status line', async () => {
    localStorage.setItem(
      'mv:ai',
      JSON.stringify({
        provider: 'openai', baseUrl: '', apiKey: '', model: '',
      }),
    );
    renderPanel();

    expect(
      await screen.findByText('Enter the base URL and model to enable this provider (token optional).'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('repairs a hostile stored payload back to the builtin defaults', async () => {
    localStorage.setItem(
      'mv:ai',
      JSON.stringify({
        provider: 'nope', baseUrl: 42, apiKey: [], model: true, directEdit: 'yes',
      }),
    );
    renderPanel();
    await openSettings();

    // Unknown provider → builtin; non-string fields → '' (normalizeSettings).
    expect(
      await screen.findByRole('button', { name: /Built-in \(on-device\)/ }),
    ).toBeInTheDocument();
    const checkbox = screen.getByRole('checkbox', { name: 'Direct editing' });
    expect(checkbox).not.toBeChecked();

    // The next save persists the REPAIRED shape, not the hostile payload.
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('mv:ai') ?? '{}') as Record<string, unknown>;
      expect(stored).toEqual({
        provider: 'builtin', baseUrl: '', apiKey: '', model: '',
      });
    });
  });

  it('persists the direct-edit toggle immediately when flipped', async () => {
    renderPanel();
    await openSettings();

    const checkbox = screen.getByRole('checkbox', { name: 'Direct editing' });
    await userEvent.click(checkbox);

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('mv:ai') ?? '{}') as Record<string, unknown>;
      expect(stored).toMatchObject({ provider: 'builtin', directEdit: true });
    });
    expect(checkbox).toBeChecked();
  });
});
