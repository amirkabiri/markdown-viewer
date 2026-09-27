// Component tests for the Open dialog: tab switching, the URL form, the
// paste flow (rejection keeps the dialog open) and the file picker.
import {
  fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import {
  describe, expect, it, vi,
} from 'vitest';

import { I18nProvider } from '../../app/i18n';

import OpenDialog from './OpenDialog';

function Harness({
  onOpenUrl, onOpenFile, onPaste,
}: {
  onOpenUrl: (url: string) => void;
  onOpenFile: (file: File) => void;
  onPaste: (text: string) => boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <I18nProvider lang="en">
      <button type="button" onClick={() => setOpen(true)}>open</button>
      <OpenDialog
        isOpen={open}
        onOpenChange={setOpen}
        onOpenUrl={onOpenUrl}
        onOpenFile={onOpenFile}
        onPaste={onPaste}
      />
    </I18nProvider>
  );
}

describe('<OpenDialog />', () => {
  it('presents the three tabs from the legacy dialog', () => {
    render(<Harness onOpenUrl={vi.fn()} onOpenFile={vi.fn()} onPaste={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Open a document' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'From URL' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Upload file' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Paste text' })).toBeVisible();
  });

  it('submits the URL tab and closes', async () => {
    const onOpenUrl = vi.fn();
    render(<Harness onOpenUrl={onOpenUrl} onOpenFile={vi.fn()} onPaste={vi.fn()} />);

    await userEvent.type(screen.getByRole('textbox'), 'https://example.com/doc.md');
    await userEvent.click(screen.getByRole('button', { name: 'Load' }));

    expect(onOpenUrl).toHaveBeenCalledWith('https://example.com/doc.md');
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Open a document' })).toBeNull();
    });
  });

  it('switches to the paste tab, renders the text and closes', async () => {
    const onPaste = vi.fn(() => true);
    render(<Harness onOpenUrl={vi.fn()} onOpenFile={vi.fn()} onPaste={onPaste} />);

    await userEvent.click(screen.getByRole('tab', { name: 'Paste text' }));
    await userEvent.type(screen.getByRole('textbox'), '# Pasted');
    await userEvent.click(screen.getByRole('button', { name: 'Insert & render' }));

    expect(onPaste).toHaveBeenCalledWith('# Pasted');
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Open a document' })).toBeNull();
    });
  });

  it('stays open when the paste is rejected', async () => {
    const onPaste = vi.fn(() => false);
    render(<Harness onOpenUrl={vi.fn()} onOpenFile={vi.fn()} onPaste={onPaste} />);

    await userEvent.click(screen.getByRole('tab', { name: 'Paste text' }));
    await userEvent.click(screen.getByRole('button', { name: 'Insert & render' }));

    expect(onPaste).toHaveBeenCalledWith('');
    expect(screen.getByRole('heading', { name: 'Open a document' })).toBeVisible();
  });

  it('hands a picked file to onOpenFile and closes', async () => {
    const onOpenFile = vi.fn();
    render(<Harness onOpenUrl={vi.fn()} onOpenFile={onOpenFile} onPaste={vi.fn()} />);

    await userEvent.click(screen.getByRole('tab', { name: 'Upload file' }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['# x'], 'picked.md')] } });

    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onOpenFile.mock.calls[0][0].name).toBe('picked.md');
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Open a document' })).toBeNull();
    });
  });
});
