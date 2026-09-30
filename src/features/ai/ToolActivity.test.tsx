// Component tests for <ToolActivity /> — the visible agent activity inside an
// assistant message: per-op labels (v2 toolset) and the full status machine
// running → pending/applied/discarded/refused/error → ok. The panel
// integration covers the event-driven transitions; this file covers the
// rendering states directly.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ToolActivity from './ToolActivity';
import type { ToolCallView } from './ToolActivity';
import { makeT } from './ai-fakes';

// The panel's translator: all label keys now live in the global dictionaries.
const tt = makeT('en');

describe('<ToolActivity />', () => {
  it('renders nothing without tool calls', () => {
    render(<ToolActivity steps={[]} tt={tt} />);
    expect(screen.queryByLabelText('Agent activity')).not.toBeInTheDocument();
  });

  it('labels each v2 op while it is running', () => {
    const steps: ToolCallView[] = [
      { id: 1, tool: 'search_document', status: 'running' },
      { id: 2, tool: 'document_outline', status: 'running' },
      { id: 3, tool: 'replace_text', status: 'running' },
      { id: 4, tool: 'replace_range', status: 'running' },
      { id: 5, tool: 'insert_at_cursor', status: 'running' },
      { id: 6, tool: 'replace_document', status: 'running' },
    ];
    render(<ToolActivity steps={steps} tt={tt} />);

    const list = screen.getByLabelText('Agent activity');
    expect(list).toHaveTextContent('Searching document…');
    expect(list).toHaveTextContent('Reading outline…');
    expect(list).toHaveTextContent('Proposing text replacement');
    expect(list).toHaveTextContent('Replacing line range');
    expect(list).toHaveTextContent('Inserting at cursor');
    expect(list).toHaveTextContent('Replacing document');
    expect(screen.getAllByText('Running…')).toHaveLength(6);
  });

  it('keeps the read_document label', () => {
    render(<ToolActivity steps={[{ id: 1, tool: 'read_document', status: 'running' }]} tt={tt} />);
    expect(screen.getByLabelText('Agent activity')).toHaveTextContent('Reading document…');
  });

  it('shows the ok outcome for reads', () => {
    render(<ToolActivity steps={[{ id: 1, tool: 'read_document', status: 'ok' }]} tt={tt} />);
    expect(screen.getByText('OK')).toBeInTheDocument();
  });

  it('shows a pending write as awaiting review', () => {
    render(<ToolActivity steps={[{ id: 1, tool: 'replace_text', status: 'pending' }]} tt={tt} />);
    expect(screen.getByText('Pending review')).toBeInTheDocument();
  });

  it('shows applied and discarded resolutions', () => {
    const steps: ToolCallView[] = [
      { id: 1, tool: 'replace_text', status: 'applied' },
      { id: 2, tool: 'replace_range', status: 'discarded' },
    ];
    render(<ToolActivity steps={steps} tt={tt} />);
    expect(screen.getByText('Applied')).toBeInTheDocument();
    expect(screen.getByText('Discarded')).toBeInTheDocument();
  });

  it('marks a refused write as refused', () => {
    render(<ToolActivity steps={[{ id: 1, tool: 'replace_document', status: 'refused' }]} tt={tt} />);
    expect(screen.getByLabelText('Agent activity')).toHaveTextContent('replace_document');
    expect(screen.getByText('Refused')).toBeInTheDocument();
  });

  it('marks a failed op as an error', () => {
    render(<ToolActivity steps={[{ id: 1, tool: 'replace_text', status: 'error' }]} tt={tt} />);
    expect(screen.getByText('Error')).toBeInTheDocument();
  });
});
