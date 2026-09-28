// Module: app/persistence — the persistence provider: ONE DocumentRepository
// per tab (default driver + one TabSyncHub + the default lock adapter, built
// once), booted with init() + the one-shot legacy mv:recent migration before
// the repository is published through context.
//
// Boot NEVER fails on storage errors: createDefaultDriver already degrades to
// the in-memory driver (IndexedDB unavailable/blocked), and any residual
// failure falls back to a memory repository — the app stays usable with
// session-only storage, and `degraded` lets the shell surface the one-time
// notice. The sync hub is only wired where BroadcastChannel exists (jsdom
// tests and exotic embeds run hub-less: cross-tab sync off, everything else
// identical).
//
// Lifecycle: pending debounced saves are flushed on pagehide and on
// visibilitychange → hidden; dispose() runs on app unmount, deferred one
// macrotask and cancelled by a fast remount — React 19 strict mode's
// double-invoked effects reuse the singleton instead of disposing it.
import {
  createContext, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from 'react';

import {
  createDefaultDriver,
  createDefaultLockAdapter,
  createDocumentRepository,
  createMemoryDriver,
  createTabSyncHub,
  migrateLegacyLocalStorage,
} from '../lib/persistence';
import type { DocumentRepository } from '../lib/persistence';
import { store } from '../lib/store';

export interface PersistenceState {
  /** The live repository — null until boot init resolved (never rejects). */
  repo: DocumentRepository | null;
  /** True when persistence degraded to the in-memory driver. */
  degraded: boolean;
}

const PersistenceContext = createContext<PersistenceState>({ repo: null, degraded: false });

export interface PersistenceProviderProps {
  children: ReactNode;
}

interface Boot {
  repo: DocumentRepository;
  degraded: boolean;
}

/** Boot the singleton repository; resolves, never rejects. */
async function bootRepository(): Promise<Boot> {
  try {
    const driver = await createDefaultDriver();
    const hub = typeof BroadcastChannel !== 'undefined' ? createTabSyncHub() : undefined;
    const repo = createDocumentRepository(driver, { hub, locks: createDefaultLockAdapter() });
    await repo.init();
    await migrateLegacyLocalStorage(store, repo);
    return { repo, degraded: driver.name !== 'indexeddb' };
  } catch {
    // Unreachable while the drivers behave (createDefaultDriver already falls
    // back) — the last-resort guarantee: boot must never fail.
    const repo = createDocumentRepository(createMemoryDriver());
    await repo.init();
    return { repo, degraded: true };
  }
}

// Module-level singleton: the provider may mount/unmount (React strict mode,
// hot reload) but a tab owns exactly one repository per page lifetime.
let bootCache: Promise<Boot> | null = null;
let mountGeneration = 0;

function getBoot(): Promise<Boot> {
  if (!bootCache) bootCache = bootRepository();
  return bootCache;
}

export function PersistenceProvider({ children }: PersistenceProviderProps) {
  const [state, setState] = useState<PersistenceState>({ repo: null, degraded: false });

  useEffect(() => {
    mountGeneration += 1;
    const generation = mountGeneration;
    const bootPromise = getBoot();
    let live = true;
    bootPromise.then((boot) => {
      if (!live) return;
      setState({ repo: boot.repo, degraded: boot.degraded });
    });
    return () => {
      live = false;
      // Defer disposal one macrotask so React strict mode's immediate remount
      // (a new effect run — a higher generation) cancels it by making this
      // generation check false. A REAL unmount disposes the singleton and
      // forgets the cache so a later mount can never reuse a disposed repo.
      setTimeout(() => {
        if (mountGeneration !== generation) return;
        bootCache = null;
        bootPromise.then((boot) => boot.repo.dispose()).catch(() => {});
      }, 0);
    };
  }, []);

  /* Flush pending debounced saves when the tab is going away. */
  const { repo } = state;
  useEffect(() => {
    if (!repo) return undefined;
    const flush = () => {
      repo.flush().catch(() => { /* dying anyway — nothing left to report */ });
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [repo]);

  const value = useMemo<PersistenceState>(() => state, [state]);

  return (
    <PersistenceContext.Provider value={value}>
      {children}
    </PersistenceContext.Provider>
  );
}

/** The persistence state. `repo` is null only during the first boot tick. */
export function useDocumentRepository(): PersistenceState {
  return useContext(PersistenceContext);
}
