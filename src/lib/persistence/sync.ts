// Module: lib/persistence/sync — the multi-tab boundary (v2 amendment).
// createTabSyncHub wraps a BroadcastChannel: every tab gets a clientId,
// broadcasts carry it, and subscribers never see their own tab's events
// (echo suppression). createDefaultLockAdapter wires document locks onto
// navigator.locks (Web Locks) and degrades — with one console.warn — to an
// always-acquired, last-write-wins adapter where Web Locks are unavailable;
// writes stay torn-write-free either way because driver puts are atomic.
// createInProcessLockAdapter implements the SAME semantics inside one process
// (Web Locks do not exist in node) so the two-repository integration tests
// exercise real contention without a browser.

import type {
  DocumentLockAdapter,
  LockAcquisition,
  TabSyncEvent,
  TabSyncHub,
} from './types';

export const DEFAULT_SYNC_CHANNEL = 'qalam-documents';

/** Web Locks name prefix — one exclusive lock per document id. */
export const LOCK_NAME_PREFIX = 'qalam-doc-';

/** Per-tab change hub: clientId, echo-suppressed fan-out, one channel. */
export function createTabSyncHub(channelName: string = DEFAULT_SYNC_CHANNEL): TabSyncHub {
  const channel = new BroadcastChannel(channelName);
  const clientId = crypto.randomUUID();
  const listeners = new Set<(event: TabSyncEvent) => void>();

  channel.onmessage = (messageEvent: MessageEvent) => {
    const event = messageEvent.data as TabSyncEvent | null;
    if (!event || event.from === clientId) return;
    listeners.forEach((listener) => listener(event));
  };

  return {
    clientId,

    broadcast(event) {
      channel.postMessage({ ...event, from: clientId } satisfies TabSyncEvent);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    close() {
      listeners.clear();
      channel.close();
    },
  };
}

/* ---------------- Web Locks adapter ---------------- */

export function createWebLockAdapter(manager: LockManager): DocumentLockAdapter {
  return {
    acquire(id, opts = {}) {
      const name = LOCK_NAME_PREFIX + id;
      const { ifAvailable = false, onLost } = opts;
      return new Promise<LockAcquisition>((resolve) => {
        let settled = false;
        let held = false;
        manager
          .request(name, { ifAvailable }, (lock) => {
            if (!lock) {
              settled = true;
              resolve({ held: false, release() {} });
              return undefined;
            }
            held = true;
            return new Promise<void>((releaseLock) => {
              settled = true;
              resolve({
                held: true,
                release() {
                  releaseLock();
                },
              });
            });
          })
          .catch(() => {
            // Aborted: another tab stole the lock while we held it.
            if (!settled) {
              settled = true;
              resolve({ held: false, release() {} });
            }
            if (held) onLost?.();
          });
      });
    },

    steal(id) {
      const name = LOCK_NAME_PREFIX + id;
      return new Promise<LockAcquisition>((resolve, reject) => {
        // The stolen hold lasts until the returned handle is released.
        manager
          .request(
            name,
            { steal: true },
            () => new Promise<void>((releaseLock) => {
              resolve({
                held: true,
                release() {
                  releaseLock();
                },
              });
            }),
          )
          .catch(reject);
      });
    },
  };
}

/* ---------------- degraded adapter (no Web Locks) ---------------- */

/** Always-acquired, never-lost: last-write-wins by design. */
export function createNoLockAdapter(): DocumentLockAdapter {
  const noop = () => {};
  return {
    async acquire() {
      return { held: true, release: noop };
    },
    async steal() {
      return { held: true, release: noop };
    },
  };
}

/**
 * The boot-path adapter: Web Locks when the browser provides them, the
 * last-write-wins fallback (warned once) when not. Saves are atomic either
 * way; only concurrent-edit arbitration is lost in the fallback.
 */
export function createDefaultLockAdapter(): DocumentLockAdapter {
  const manager = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks;
  if (manager) return createWebLockAdapter(manager);

  globalThis.console?.warn?.(
    'qalam: Web Locks unavailable — document locking degrades to last-write-wins (saves stay atomic).',
  );
  return createNoLockAdapter();
}

/* ---------------- in-process adapter (node tests, same semantics) ---------------- */

interface HeldLock {
  release: () => void;
  onLost?: () => void;
}

/** Real contention semantics inside one process: real steal, real onLost. */
export function createInProcessLockAdapter(): DocumentLockAdapter {
  const held = new Map<string, HeldLock>();
  const waiters = new Map<string, (() => void)[]>();

  const pump = (id: string): void => {
    const next = waiters.get(id)?.shift();
    next?.();
  };

  return {
    acquire(id, opts = {}) {
      const { ifAvailable = false, onLost } = opts;
      if (ifAvailable && held.has(id)) {
        return Promise.resolve({ held: false, release() {} });
      }
      return new Promise<LockAcquisition>((resolve) => {
        const take = (): void => {
          const release = (): void => {
            if (held.get(id)?.release !== release) return; // stolen — already inert
            held.delete(id);
            pump(id);
          };
          held.set(id, { release, onLost });
          resolve({ held: true, release });
        };
        if (held.has(id)) {
          const queue = waiters.get(id) ?? [];
          queue.push(take);
          waiters.set(id, queue);
        } else {
          take();
        }
      });
    },

    async steal(id) {
      const previous = held.get(id);
      previous?.onLost?.(); // the loser flips to readonly via its onLost callback

      return new Promise<LockAcquisition>((resolve) => {
        const release = (): void => {
          if (held.get(id)?.release !== release) return;
          held.delete(id);
          pump(id);
        };
        held.set(id, { release });
        resolve({ held: true, release });
      });
    },
  };
}
