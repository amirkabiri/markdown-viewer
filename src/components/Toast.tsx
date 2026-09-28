// Module: components/Toast — the shared transient-message primitive (the
// legacy #toast, now a minimal queue so simultaneous messages — e.g. "Link
// copied" + the long-link warning — stay visible together). Same 2600 ms
// cadence and ok/error color coding as legacy/src/state.ts toast().
import {
  createContext, useCallback, useContext, useRef, useState, type ReactNode,
} from 'react';

import styles from './Toast.module.css';

export type ToastKind = 'info' | 'ok' | 'error';

export interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

export type ToastFn = (message: string, kind?: ToastKind) => void;

/** Legacy toast duration. */
export const TOAST_DURATION_MS = 2600;

const ToastContext = createContext<ToastFn | null>(null);

function kindClass(kind: ToastKind): string {
  if (kind === 'ok') return ` ${styles.ok}`;
  if (kind === 'error') return ` ${styles.error}`;
  return '';
}

export interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const toast = useCallback<ToastFn>((message, kind = 'info') => {
    const id = nextId.current;
    nextId.current += 1;
    setItems((prev) => [...prev, { id, message, kind }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id));
    }, TOAST_DURATION_MS);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className={styles.region} role="status" aria-live="polite">
        {items.map((item) => (
          <div
            key={item.id}
            className={`${styles.toast}${kindClass(item.kind)}`}
          >
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** The app toast function. Throws outside a provider — the app always mounts one. */
export function useToast(): ToastFn {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error('useToast must be used inside <ToastProvider>');
  return toast;
}
