// Small tests for the one-click share flow: clipboard copy + toasts, the
// long-link warning (>30k chars) and the refusal (>300k chars).
import {
  describe, expect, it, vi,
} from 'vitest';

import { copyShareLink } from './copyShareLink';

function makeDeps(clipboard: { writeText: (text: string) => Promise<void> }) {
  const t = (key: string): string => ({
    copied: 'Link copied to clipboard',
    linkWarn: 'Long link warning',
    linkTooLarge: 'Too large',
  })[key] ?? key;
  const toast = vi.fn();
  return { t, toast, clipboard };
}

/** Incompressible ASCII text long enough to exceed `len` chars once encoded. */
function randomText(len: number): string {
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += String.fromCharCode(97 + Math.floor(Math.random() * 26));
  }
  return out;
}

describe('copyShareLink', () => {
  it('copies the self-contained link and toasts "copied"', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ writeText });

    await copyShareLink('# Small doc', deps);

    expect(writeText).toHaveBeenCalledTimes(1);
    const url = writeText.mock.calls[0][0] as string;
    expect(url).toContain('#d=');
    expect(url.startsWith('http://localhost')).toBe(true);
    expect(deps.toast).toHaveBeenCalledWith('Link copied to clipboard', 'ok');
    expect(deps.toast).not.toHaveBeenCalledWith('Long link warning', expect.anything());
  });

  it('adds the long-link warning toast over 30k chars', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ writeText });

    await copyShareLink(randomText(40000), deps);

    expect(deps.toast).toHaveBeenCalledWith('Link copied to clipboard', 'ok');
    expect(deps.toast).toHaveBeenCalledWith('Long link warning');
  });

  it('refuses documents over 300k chars without touching the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ writeText });

    await copyShareLink(randomText(400000), deps);

    expect(writeText).not.toHaveBeenCalled();
    expect(deps.toast).toHaveBeenCalledWith('Too large', 'error');
  });

  it('toasts "copied" with the error kind when the clipboard is blocked', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('blocked'));
    const deps = makeDeps({ writeText });

    await copyShareLink('# doc', deps);

    await vi.waitFor(() => {
      expect(deps.toast).toHaveBeenCalledWith('Link copied to clipboard', 'error');
    });
  });
});
