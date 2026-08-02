import type { ReactNode } from "react";
import { classNames } from "@/lib/classNames";
import styles from "./KeyValueRow.module.css";

export interface KeyValueRowProps {
  label: ReactNode;
  value: ReactNode;
  /** Render the value in the mono figure style (money, IBANs, counts). */
  mono?: boolean;
  /** Emphasize as a total row (heavier top border + bolder value). */
  total?: boolean;
  /** Color the value with a status hue (e.g. positive/negative net). */
  valueColor?: string;
  className?: string;
}

/** A label ↔ value line — the atom of deal terms, settlement breakdowns and
 * spec sheets ("Total ticket revenue …… €10,000"). */
export function KeyValueRow({ label, value, mono = false, total = false, valueColor, className }: KeyValueRowProps) {
  return (
    <div className={classNames(styles.row, total && styles.total, className)}>
      <span className={styles.label}>{label}</span>
      <span className={classNames(styles.value, mono && styles.mono)} style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </span>
    </div>
  );
}
