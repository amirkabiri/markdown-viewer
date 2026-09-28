// Component tests for the persistence provider. Boot is a per-tab singleton
// (module-level, by design), so the migration test runs FIRST and seeds
// localStorage before the first boot; later tests reuse the booted
// repository. The dispose test must run LAST-ish — it clears the singleton
// and remounts boot fresh — and the strict-mode test proves a fast remount
// does NOT dispose it. jsdom has no IndexedDB, so every boot here exercises
// the memory fallback (degraded flag included).
import { act, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { PersistenceProvider, useDocumentRepository } from './persistence';
import { MIGRATION_FLAG_KEY } from '../lib/persistence';
import type { DocumentRepository } from '../lib/persistence';

interface ProbedState {
  repo: DocumentRepository | null;
  degraded: boolean;
}

/** Captures the context value into a variable once it is published. */
function Probe({ onRepo }: { onRepo: (state: ProbedState) => void }) {
  const state = useDocumentRepository();
  useEffect(() => {
    onRepo(state);
  }, [onRepo, state]);
  return null;
}

function renderProvider(onRepo: (state: ProbedState) => void) {
  return render(
    <PersistenceProvider>
      <Probe onRepo={onRepo} />
    </PersistenceProvider>,
  );
}

async function probedRepo(onRepo: ReturnType<typeof vi.fn>): Promise<DocumentRepository> {
  await waitFor(() => {
    expect(onRepo).toHaveBeenLastCalledWith(expect.objectContaining({ repo: expect.anything() }));
  });
  return (onRepo.mock.lastCall?.[0] as { repo: DocumentRepository }).repo;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('<PersistenceProvider />', () => {
  it('runs the one-shot legacy migration on the first boot', async () => {
    localStorage.setItem(
      'mv:recent',
      JSON.stringify([{ name: 'Old notes', url: 'https://example.com/old.md' }]),
    );
    const onRepo = vi.fn();
    renderProvider(onRepo);
    const repo = await probedRepo(onRepo);

    await waitFor(async () => {
      const records = await repo.list();
      expect(records.map((r) => r.name)).toEqual(['Old notes']);
      expect(records[0]?.source).toEqual({ kind: 'url', url: 'https://example.com/old.md' });
    });
    expect(localStorage.getItem(`mv:${MIGRATION_FLAG_KEY}`)).toBe('true');
  });

  it('publishes a usable repository and the degraded flag (memory fallback in jsdom)', async () => {
    const onRepo = vi.fn();
    renderProvider(onRepo);
    const repo = await probedRepo(onRepo);

    const state = onRepo.mock.lastCall?.[0] as ProbedState;
    expect(state.degraded).toBe(true);
    await expect(repo.list()).resolves.toBeInstanceOf(Array);
  });

  it('flushes pending saves on pagehide and on visibilitychange → hidden', async () => {
    const onRepo = vi.fn();
    renderProvider(onRepo);
    const repo = await probedRepo(onRepo);
    const flush = vi.spyOn(repo, 'flush').mockResolvedValue();

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(flush).toHaveBeenCalledTimes(1);

    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it('keeps the repository alive across a strict-mode remount', async () => {
    const onRepo = vi.fn();
    const view = renderProvider(onRepo);
    const repo = await probedRepo(onRepo);

    // Strict mode's unmount+remount cycle: the remount lands before the
    // deferred disposal, cancelling it — the singleton stays usable.
    view.unmount();
    renderProvider(onRepo);
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });

    await expect(repo.list()).resolves.toBeInstanceOf(Array);
  });

  it('disposes the repository on a real app unmount', async () => {
    const onRepo = vi.fn();
    const view = renderProvider(onRepo);
    const repo = await probedRepo(onRepo);

    view.unmount();
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });

    await expect(repo.list()).rejects.toThrow('disposed');
  });
});
