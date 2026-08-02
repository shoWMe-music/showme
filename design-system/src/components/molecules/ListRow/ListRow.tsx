import type { ReactNode } from "react";
import { classNames } from "@/lib/classNames";
import styles from "./ListRow.module.css";

export interface ListRowProps {
  /** Leading icon tile or avatar. */
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  /** Trailing content: a badge, action pill, chevron, etc. */
  trailing?: ReactNode;
  /** Renders as a button-like interactive row. */
  interactive?: boolean;
  onClick?: () => void;
  className?: string;
}

/** The workhorse list row: leading tile → title + meta → trailing slot. Used
 * for attention/action items, contacts, tasks, settlement lines. */
export function ListRow({ leading, title, meta, trailing, interactive, onClick, className }: ListRowProps) {
  return (
    <div
      className={classNames(styles.row, interactive && styles.interactive, className)}
      onClick={onClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      {leading && <span className={styles.leading}>{leading}</span>}
      <div className={styles.body}>
        <div className={styles.title}>{title}</div>
        {meta && <div className={styles.meta}>{meta}</div>}
      </div>
      {trailing && <div className={styles.trailing}>{trailing}</div>}
    </div>
  );
}
