import type { ReactNode } from "react";
import { createContext, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Status } from "@/lib/status";
import { Toast } from "./Toast";
import { useToastItemMotion } from "./useToastItemMotion";
import styles from "./ToastProvider.module.css";

export interface ToastOptions {
  action?: { label: string; onClick?: () => void };
  icon?: ReactNode;
  status?: Status;
  /** Auto-dismiss after this many ms. `Infinity` keeps it until dismissed. Default 4000. */
  duration?: number;
}

interface ToastItemData extends ToastOptions {
  id: string;
  message: ReactNode;
  dismissing: boolean;
}

export interface ToastContextValue {
  add: (message: ReactNode, options?: ToastOptions) => string;
  dismiss: (id: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

export type ToastPosition = "top-right" | "bottom-right" | "bottom-center";

export interface ToastProviderProps {
  children: ReactNode;
  position?: ToastPosition;
  /** Most toasts kept on screen at once (older ones are dropped). */
  max?: number;
}

/** Mounts once at the app root. Owns the toast queue, auto-dismiss timers
 * (paused while the region is hovered) and the portal region. Fire toasts with
 * the `useToast()` hook. */
export function ToastProvider({ children, position = "bottom-right", max = 4 }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastItemData[]>([]);
  const [mounted, setMounted] = useState(false);
  const timers = useRef(new Map<string, { handle: number | null; remaining: number; startedAt: number }>());
  const nextId = useRef(0);

  useEffect(() => setMounted(true), []);

  const remove = useCallback((id: string) => {
    setToasts((list) => list.filter((toast) => toast.id !== id));
    timers.current.delete(id);
  }, []);

  const startDismiss = useCallback((id: string) => {
    setToasts((list) => list.map((toast) => (toast.id === id ? { ...toast, dismissing: true } : toast)));
    const timer = timers.current.get(id);
    if (timer?.handle) clearTimeout(timer.handle);
  }, []);

  const scheduleTimer = useCallback((id: string, duration: number) => {
    if (!Number.isFinite(duration) || duration <= 0) return;
    const handle = window.setTimeout(() => startDismiss(id), duration);
    timers.current.set(id, { handle, remaining: duration, startedAt: Date.now() });
  }, [startDismiss]);

  const add = useCallback((message: ReactNode, options: ToastOptions = {}) => {
    const id = `toast-${nextId.current++}`;
    const duration = options.duration ?? 4000;
    setToasts((list) => [...list, { id, message, dismissing: false, ...options }].slice(-max));
    scheduleTimer(id, duration);
    return id;
  }, [max, scheduleTimer]);

  const pauseAll = useCallback(() => {
    timers.current.forEach((timer) => {
      if (timer.handle) {
        clearTimeout(timer.handle);
        timer.remaining -= Date.now() - timer.startedAt;
        timer.handle = null;
      }
    });
  }, []);

  const resumeAll = useCallback(() => {
    timers.current.forEach((timer, id) => {
      if (!timer.handle && timer.remaining > 0) {
        timer.startedAt = Date.now();
        timer.handle = window.setTimeout(() => startDismiss(id), timer.remaining);
      }
    });
  }, [startDismiss]);

  return (
    <ToastContext.Provider value={{ add, dismiss: startDismiss }}>
      {children}
      {mounted &&
        createPortal(
          <div
            className={classNamesForPosition(position)}
            role="region"
            aria-label="Notifications"
            aria-live="polite"
            onMouseEnter={pauseAll}
            onMouseLeave={resumeAll}
          >
            {toasts.map((toast) => (
              <ToastItem key={toast.id} toast={toast} onExited={() => remove(toast.id)} />
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

function classNamesForPosition(position: ToastPosition) {
  return `${styles.region} ${styles[position]}`;
}

function ToastItem({ toast, onExited }: { toast: ToastItemData; onExited: () => void }) {
  const element = useToastItemMotion(toast.dismissing, onExited);
  return (
    <div ref={element} className={styles.item}>
      <Toast message={toast.message} action={toast.action} icon={toast.icon} status={toast.status} />
    </div>
  );
}
