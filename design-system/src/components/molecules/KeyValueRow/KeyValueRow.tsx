import type { ReactNode } from "react";
import { classNames } from "@/lib/classNames";
import styles from "./KeyValueRow.module.css";

export interface KeyValueRowProps {
  label: ReactNode;
  value: ReactNode;
  /**
   * A second, quieter line under the label saying what the row IS — "all
   * sources", "after deductions", "what percentages divide".
   *
   * The settlement waterfall is the case it exists for: a chain of figures where
   * every row is the one above less one thing reads as an assertion unless each
   * row says what it is. Optional, and omitted rows lay out exactly as before.
   */
  caption?: ReactNode;
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
export function KeyValueRow({ label, value, caption, mono = false, total = false, valueColor, className }: KeyValueRowProps) {
  return (
    <div className={classNames(styles.row, total && styles.total, className)}>
      <span className={styles.label}>
        {label}
        {caption != null && <span className={styles.caption}>{caption}</span>}
      </span>
      <span className={classNames(styles.value, mono && styles.mono)} style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </span>
    </div>
  );
}
