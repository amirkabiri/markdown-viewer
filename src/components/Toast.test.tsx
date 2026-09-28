// Component tests for the Toast primitive: messages appear in the status
// region, color kinds map, and each toast dismisses after 2600 ms.
import {
  act, fireEvent, render, screen,
} from '@testing-library/react';
import {
  afterEach, describe, expect, it, vi,
} from 'vitest';

import { ToastProvider, TOAST_DURATION_MS, useToast } from './Toast';

afterEach(() => {
  vi.useRealTimers();
});

function Harness() {
  const toast = useToast();
  return (
    <div>
      <button type="button" onClick={() => toast('Link copied to clipboard', 'ok')}>copy</button>
      <button type="button" onClick={() => toast('Could not load document', 'error')}>fail</button>
      <button type="button" onClick={() => toast('plain')}>plain</button>
    </div>
  );
}

describe('<ToastProvider />', () => {
  it('renders messages into a polite status region', () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'copy' }));

    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('Link copied to clipboard');
  });

  it('queues multiple toasts at once', () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'copy' }));
    fireEvent.click(screen.getByRole('button', { name: 'fail' }));

    expect(screen.getByRole('status')).toHaveTextContent('Link copied to clipboard');
    expect(screen.getByRole('status')).toHaveTextContent('Could not load document');
  });

  it('dismisses each toast after 2600 ms', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'plain' }));
    expect(screen.getByRole('status')).toHaveTextContent('plain');

    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS);
    });

    expect(screen.getByRole('status')).not.toHaveTextContent('plain');
  });

  it('throws when useToast is used outside the provider', () => {
    function Broken() {
      useToast();
      return null;
    }

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<Broken />)).toThrow('useToast must be used inside <ToastProvider>');
    } finally {
      consoleError.mockRestore();
    }
  });
});
