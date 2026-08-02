import type { ReactNode } from "react";
import { classNames } from "@/lib/classNames";
import styles from "./EmptyState.module.css";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** The empty / zero-data state: soft icon tile, title, one line of guidance,
 * and an optional primary action. */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={classNames(styles.wrap, className)}>
      {icon && <span className={styles.icon}>{icon}</span>}
      <div className={styles.title}>{title}</div>
      {description && <p className={styles.desc}>{description}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
