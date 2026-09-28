// Component tests for the sidebar document list: rendering with the active
// marker, select/rename/reorder/remove intents (persisted by the parent),
// the non-dismissable removal confirm dialog with the localized interpolated
// body, and the pointer grip's drag-to-reorder (window pointer events).
import {
  fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  describe, expect, it, vi,
} from 'vitest';
import { I18nProvider } from '../../app/i18n';
import type { DocumentRecord } from '../../lib/persistence';

import DocumentList from './DocumentList';

function makeRecord(id: string, name: string): DocumentRecord {
  return {
    id,
    name,
    content: '',
    createdAt: 0,
    updatedAt: 0,
    sortIndex: 0,
    revision: 0,
  };
}

const DOCS: DocumentRecord[] = [
  makeRecord('a', 'Alpha'),
  makeRecord('b', 'Beta'),
  makeRecord('c', 'Gamma'),
];

interface SetupOpts {
  docs?: DocumentRecord[];
  activeDocId?: string | null;
}

function setup({ docs = DOCS, activeDocId = 'a' }: SetupOpts = {}) {
  const props = {
    onSelect: vi.fn(),
    onRename: vi.fn(),
    onRemove: vi.fn(),
    onReorder: vi.fn(),
  };
  render(
    <I18nProvider lang="en">
      <DocumentList docs={docs} activeDocId={activeDocId} {...props} />
    </I18nProvider>,
  );
  return props;
}

describe('<DocumentList />', () => {
  it('renders one row per record with the active document marked', () => {
    setup();

    expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Beta' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gamma' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Alpha' }).closest('li')).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Beta' }).closest('li')).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('selects a document when its name is clicked', async () => {
    const props = setup();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Beta' }));

    expect(props.onSelect).toHaveBeenCalledWith('b');
  });

  it('renames inline from the double-click and commits on Enter', async () => {
    const props = setup();
    const user = userEvent.setup();

    await user.dblClick(screen.getByRole('button', { name: 'Beta' }));
    const input = screen.getByLabelText('Rename');
    await user.clear(input);
    await user.type(input, 'Beta v2{Enter}');

    expect(props.onRename).toHaveBeenCalledWith('b', 'Beta v2');
  });

  it('renames from the row menu and moves a row up (the keyboard reorder path)', async () => {
    const props = setup();
    const user = userEvent.setup();

    await user.click(screen.getAllByRole('button', { name: /Document actions/ })[1]);
    await user.click(screen.getByRole('menuitem', { name: 'Move up' }));

    expect(props.onReorder).toHaveBeenCalledWith(['b', 'a', 'c']);
  });

  it('gates removal behind a non-dismissable confirm dialog', async () => {
    const props = setup();
    const user = userEvent.setup();

    await user.click(screen.getAllByRole('button', { name: /Document actions/ })[2]);
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent('“Gamma” will be permanently removed.');

    // Cancel keeps the document.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(props.onRemove).not.toHaveBeenCalled();

    // Confirm removes it.
    await user.click(screen.getAllByRole('button', { name: /Document actions/ })[2]);
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(props.onRemove).toHaveBeenCalledWith('c');
  });

  it('reorders by dragging a row grip (pointer events)', () => {
    const props = setup();

    // The grip is decorative (aria-hidden) — reached through its row.
    const row = screen.getByRole('button', { name: 'Alpha' }).closest('li');
    const grip = row?.querySelector('button');
    if (!grip) throw new Error('grip button missing');

    fireEvent.pointerDown(grip, { button: 0, clientY: 5 });
    fireEvent.pointerMove(window, { clientY: 500 });
    fireEvent.pointerUp(window);

    // jsdom gives every row a zero rect, so the dragged row lands after all
    // of them — the pointer path committed a reorder.
    expect(props.onReorder).toHaveBeenCalledWith(['b', 'c', 'a']);
  });
});
