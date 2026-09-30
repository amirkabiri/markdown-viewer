// Component tests for <PendingDiffCard /> — the chat-thread card that holds a
// proposed edit until the user Applies or Discards it (spec §5.4). Keyboard
// operability + the aria-live resolution announcement are part of the
// contract (a11y bar: the card is operable without a pointer).

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  describe, expect, it, vi,
} from 'vitest';
import PendingDiffCard from './PendingDiffCard';
import type { PendingDiffView } from './pendingDiff';
import { makeT } from './ai-fakes';

const tt = makeT('en');

const diff: PendingDiffView = {
  id: 1,
  stepId: 1,
  status: 'pending',
  docAtProposal: '# Doc\n\nold line\n',
  data: {
    tool: 'replace_text',
    startLine: 3,
    endLine: 3,
    startOffset: 7,
    endOffset: 15,
    removedText: 'old line\n',
    addedText: 'new line\n',
  },
};

describe('<PendingDiffCard />', () => {
  it('renders the proposed edit with its removed/added lines and line range', () => {
    render(<PendingDiffCard diff={diff} tt={tt} onApply={() => {}} onDiscard={() => {}} />);

    const card = screen.getByRole('group', { name: 'Proposed edit' });
    expect(card).toHaveTextContent('replace_text');
    expect(card).toHaveTextContent('lines 3');
    expect(within(card).getByLabelText('Removed lines (1)')).toHaveTextContent('old line');
    expect(within(card).getByLabelText('Added lines (1)')).toHaveTextContent('new line');
  });

  it('renders a multi-line range with the en-dash form', () => {
    const ranged: PendingDiffView = {
      ...diff,
      data: { ...diff.data, startLine: 3, endLine: 5 },
    };
    render(<PendingDiffCard diff={ranged} tt={tt} onApply={() => {}} onDiscard={() => {}} />);
    expect(screen.getByRole('group', { name: 'Proposed edit' })).toHaveTextContent('lines 3–5');
  });

  it('applies and discards from the card buttons', async () => {
    const onApply = vi.fn();
    const onDiscard = vi.fn();
    render(<PendingDiffCard diff={diff} tt={tt} onApply={onApply} onDiscard={onDiscard} />);

    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('announces the resolution through the live region and retires the buttons', () => {
    render(
      <PendingDiffCard
        diff={{ ...diff, status: 'applied' }}
        tt={tt}
        onApply={() => {}}
        onDiscard={() => {}}
      />,
    );

    const card = screen.getByRole('group', { name: 'Proposed edit' });
    const live = within(card).getByText('Applied');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument();
  });

  it('shows the discard resolution label', () => {
    render(
      <PendingDiffCard
        diff={{ ...diff, status: 'discarded' }}
        tt={tt}
        onApply={() => {}}
        onDiscard={() => {}}
      />,
    );
    expect(screen.getByText('Discarded')).toHaveAttribute('aria-live', 'polite');
  });

  it('collapses a huge diff to bounded sections with hidden counts, Apply still available', () => {
    const lines = Array.from({ length: 150 }, (_, i) => `old ${i + 1}`).join('\n');
    const big: PendingDiffView = {
      ...diff,
      data: { ...diff.data, removedText: `${lines}\n`, addedText: 'small\n' },
    };
    render(<PendingDiffCard diff={big} tt={tt} onApply={() => {}} onDiscard={() => {}} />);

    const removed = screen.getByLabelText('Removed lines (150)');
    expect(removed).toHaveTextContent('old 100'); // the head is kept
    expect(removed).not.toHaveTextContent('old 101');
    expect(screen.getByText('+50 more lines'));
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
  });

  it('disables Apply with an explanation when the document moved on', () => {
    render(
      <PendingDiffCard
        diff={{ ...diff, status: 'error' }}
        tt={tt}
        onApply={() => {}}
        onDiscard={() => {}}
      />,
    );
    expect(screen.getByText('Document changed since this proposal — Apply is unavailable.')).toBeInTheDocument();
  });
});
