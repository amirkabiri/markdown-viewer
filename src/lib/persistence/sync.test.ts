// Unit tests for src/lib/persistence/sync.ts — the multi-tab boundary. The
// hub tests use the REAL BroadcastChannel (node implements it in-process), so
// what runs here is the exact browser mechanism: echo suppression, clientId
// stamping, subscription fan-out. The lock adapter tests run the in-process
// adapter (same semantics as the Web Locks adapter) plus the degradation
// path of createDefaultLockAdapter.

import {
  afterEach, describe, expect, it, vi,
} from 'vitest';
import {
  createDefaultLockAdapter,
  createInProcessLockAdapter,
  createNoLockAdapter,
  createTabSyncHub,
  createWebLockAdapter,
} from './sync';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createTabSyncHub', () => {
  it('delivers another tab’s broadcast with its clientId stamped', async () => {
    const sender = createTabSyncHub('test-hub');
    const receiver = createTabSyncHub('test-hub');
    const received: unknown[] = [];
    receiver.subscribe((event) => received.push(event));

    sender.broadcast({ type: 'updated', ids: ['doc-1'], revision: 3 });

    await vi.waitFor(() => {
      expect(received).toEqual([
        {
          type: 'updated', ids: ['doc-1'], revision: 3, from: sender.clientId,
        },
      ]);
    });

    sender.close();
    receiver.close();
  });

  it('suppresses a tab’s own echo — a tab never hears itself', async () => {
    const hub = createTabSyncHub('test-echo');
    const received: unknown[] = [];
    hub.subscribe((event) => received.push(event));

    hub.broadcast({ type: 'created', ids: ['doc-1'] });
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    expect(received).toEqual([]);
    hub.close();
  });

  it('stops delivering after the subscription is cancelled', async () => {
    const sender = createTabSyncHub('test-unsub');
    const receiver = createTabSyncHub('test-unsub');
    const received: unknown[] = [];
    const unsubscribe = receiver.subscribe((event) => received.push(event));

    unsubscribe();
    sender.broadcast({ type: 'removed', ids: ['doc-1'] });
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    expect(received).toEqual([]);
    sender.close();
    receiver.close();
  });

  it('stops delivering after close', async () => {
    const sender = createTabSyncHub('test-close');
    const receiver = createTabSyncHub('test-close');
    const received: unknown[] = [];
    receiver.subscribe((event) => received.push(event));

    receiver.close();
    sender.broadcast({ type: 'reordered', ids: ['b', 'a'] });
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    expect(received).toEqual([]);
    sender.close();
  });
});

describe('createInProcessLockAdapter', () => {
  it('grants an ifAvailable acquisition and blocks a second one', async () => {
    const locks = createInProcessLockAdapter();

    const first = await locks.acquire('doc-1', { ifAvailable: true });
    const second = await locks.acquire('doc-1', { ifAvailable: true });

    expect(first.held).toBe(true);
    expect(second.held).toBe(false);
    first.release();
  });

  it('becomes acquirable again after release', async () => {
    const locks = createInProcessLockAdapter();
    const first = await locks.acquire('doc-1', { ifAvailable: true });
    first.release();

    const second = await locks.acquire('doc-1', { ifAvailable: true });

    expect(second.held).toBe(true);
    second.release();
  });

  it('fires the holder’s onLost and transfers the lock on steal', async () => {
    const locks = createInProcessLockAdapter();
    let lost = false;
    const first = await locks.acquire('doc-1', {
      ifAvailable: true,
      onLost: () => {
        lost = true;
      },
    });

    const stolen = await locks.steal('doc-1');

    expect(lost).toBe(true);
    expect(stolen.held).toBe(true);
    // The loser's release is inert — the stealer still holds the lock.
    first.release();
    const outsider = await locks.acquire('doc-1', { ifAvailable: true });
    expect(outsider.held).toBe(false);
  });

  it('lets the stealer release the lock for the next acquirer', async () => {
    const locks = createInProcessLockAdapter();
    await locks.acquire('doc-1', { ifAvailable: true });

    const stolen = await locks.steal('doc-1');
    stolen.release();

    const next = await locks.acquire('doc-1', { ifAvailable: true });
    expect(next.held).toBe(true);
    next.release();
  });

  it('steals cleanly when nobody holds the lock', async () => {
    const locks = createInProcessLockAdapter();

    const stolen = await locks.steal('doc-1');

    expect(stolen.held).toBe(true);
    stolen.release();
  });

  it('queues a blocking acquisition behind the holder', async () => {
    const locks = createInProcessLockAdapter();
    const first = await locks.acquire('doc-1');

    let resolved = false;
    const queued = locks.acquire('doc-1').then((result) => {
      resolved = true;
      return result;
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(resolved).toBe(false);

    first.release();
    const second = await queued;
    expect(second.held).toBe(true);
    second.release();
  });
});

describe('lock adapter degradation', () => {
  it('createNoLockAdapter always holds and never loses', async () => {
    const locks = createNoLockAdapter();

    const a = await locks.acquire('doc-1', { ifAvailable: true });
    const b = await locks.acquire('doc-1', { ifAvailable: true });

    expect(a.held).toBe(true);
    expect(b.held).toBe(true); // no contention in last-write-wins mode
    expect(() => a.release()).not.toThrow();
    await expect(locks.steal('doc-1')).resolves.toMatchObject({ held: true });
  });

  it('createDefaultLockAdapter degrades with one warning where Web Locks are missing', async () => {
    const warn = vi.spyOn(globalThis.console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('navigator', {}); // a navigator without locks
    try {
      const locks = createDefaultLockAdapter();
      const acquisition = await locks.acquire('doc-1');

      expect(acquisition.held).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain('Web Locks');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('createWebLockAdapter (node implements real Web Locks)', () => {
  const manager = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks;

  const itWithLocks = manager ? it : it.skip;

  itWithLocks('grants an exclusive acquisition and reports contention', async () => {
    const locks = createWebLockAdapter(manager as LockManager);
    const first = await locks.acquire('web-doc-1', { ifAvailable: true });
    const second = await locks.acquire('web-doc-1', { ifAvailable: true });

    expect(first.held).toBe(true);
    expect(second.held).toBe(false);

    first.release();
    // Web Locks release asynchronously — the lock is free after a macrotask.
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    const third = await locks.acquire('web-doc-1', { ifAvailable: true });
    expect(third.held).toBe(true);
    third.release();
  });

  itWithLocks('fires onLost when the lock is stolen by another holder', async () => {
    const locks = createWebLockAdapter(manager as LockManager);
    let lost = false;
    const first = await locks.acquire('web-doc-2', {
      ifAvailable: true,
      onLost: () => {
        lost = true;
      },
    });
    expect(first.held).toBe(true);

    const stolen = await locks.steal('web-doc-2');

    expect(stolen.held).toBe(true);
    await vi.waitFor(() => expect(lost).toBe(true));

    stolen.release();
  });
});
