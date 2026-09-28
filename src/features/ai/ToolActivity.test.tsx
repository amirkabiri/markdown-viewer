// Component tests for <ToolActivity /> — the visible agent activity inside an
// assistant message: tool name, edit-mode label, and the running → OK/refused
// states (the panel integration covers the event-driven transitions; this file
// covers the three rendering states directly).

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

  it('shows a running tool as in-flight', () => {
    const steps: ToolCallView[] = [{ id: 1, tool: 'read_document', status: 'running' }];
    render(<ToolActivity steps={steps} tt={tt} />);

    const list = screen.getByLabelText('Agent activity');
    expect(list).toHaveTextContent('read_document');
    expect(screen.getByText('Reading document…')).toBeInTheDocument();
    expect(screen.getByText('Running…')).toBeInTheDocument();
  });

  it('labels edit modes and the OK outcome', () => {
    const steps: ToolCallView[] = [
      { id: 1, tool: 'read_document', status: 'ok' },
      {
        id: 2, tool: 'edit_document', mode: 'replace-selection', status: 'ok',
      },
    ];
    render(<ToolActivity steps={steps} tt={tt} />);

    const list = screen.getByLabelText('Agent activity');
    expect(list).toHaveTextContent('Replace selection');
    expect(screen.getAllByText('OK')).toHaveLength(2);
    expect(screen.queryByText('Running…')).not.toBeInTheDocument();
  });

  it('marks a refused edit as refused', () => {
    const steps: ToolCallView[] = [
      {
        id: 1, tool: 'edit_document', mode: 'replace-document', status: 'refused',
      },
    ];
    render(<ToolActivity steps={steps} tt={tt} />);

    const list = screen.getByLabelText('Agent activity');
    expect(list).toHaveTextContent('edit_document');
    expect(list).toHaveTextContent('Replace document');
    expect(screen.getByText('Refused')).toBeInTheDocument();
  });
});
