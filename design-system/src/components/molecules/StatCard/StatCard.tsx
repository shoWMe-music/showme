import type { ReactNode } from "react";
import { classNames } from "@/lib/classNames";
import styles from "./StatCard.module.css";

export interface StatCardProps {
  /** Mono uppercase label, e.g. "Total settlement". */
  label: ReactNode;
  /** The headline figure (display font). */
  value: ReactNode;
  /** Small trailing hint / delta under the value. */
  hint?: ReactNode;
  /** Optional icon tile top-right. */
  icon?: ReactNode;
  className?: string;
}

/** A KPI tile: mono label + large display figure + optional hint. Used across
 * dashboards (revenue, payouts, settlement totals). */
export function StatCard({ label, value, hint, icon, className }: StatCardProps) {
  return (
    <div className={classNames(styles.card, className)}>
      <div className={styles.row}>
        <div className={styles.label}>{label}</div>
        {icon && <span className={styles.icon}>{icon}</span>}
      </div>
      <div className={styles.value}>{value}</div>
      {hint && <div className={styles.hint}>{hint}</div>}
    </div>
  );
}
