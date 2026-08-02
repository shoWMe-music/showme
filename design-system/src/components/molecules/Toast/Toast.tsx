import type { ReactNode } from "react";
import { classNames } from "@/lib/classNames";
import { STATUS_COLOR, type Status } from "@/lib/status";
import styles from "./Toast.module.css";

export interface ToastProps {
  message: ReactNode;
  /** Optional inline action (e.g. Undo). */
  action?: { label: string; onClick?: () => void };
  /** Leading icon. */
  icon?: ReactNode;
  /** Colors the leading icon with a status hue (success / error / …). */
  status?: Status;
  className?: string;
}

/** The transient confirmation toast ("Archived Nils Frahm · Undo"). Elevated
 * surface, optional trailing action button. Presentational only — the queue,
 * timers and portal live in ToastProvider. */
export function Toast({ message, action, icon, status, className }: ToastProps) {
  return (
    <div className={classNames(styles.toast, className)} role="status">
      {icon && (
        <span className={styles.icon} style={status ? { color: STATUS_COLOR[status].fg } : undefined}>
          {icon}
        </span>
      )}
      <span className={styles.msg}>{message}</span>
      {action && (
        <button type="button" className={styles.action} onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
