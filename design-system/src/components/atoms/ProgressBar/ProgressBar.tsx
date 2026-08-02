import { classNames } from "@/lib/classNames";
import { STATUS_COLOR, type Status } from "@/lib/status";
import styles from "./ProgressBar.module.css";

export interface ProgressBarProps {
  /** 0–100. */
  value: number;
  /** Optional label + value shown above the track. */
  label?: string;
  /** Show the percentage on the right of the label row. */
  showValue?: boolean;
  /** Tint the fill with a status hue instead of the brand gradient. */
  status?: Status;
  className?: string;
}

/** Horizontal progress / capacity bar (ticket sales, settlement completion).
 * Brand-gradient fill by default; status-tinted when given a `status`. */
export function ProgressBar({ value, label, showValue = false, status, className }: ProgressBarProps) {
  const percent = Math.max(0, Math.min(100, value));
  return (
    <div className={classNames(styles.wrap, className)}>
      {(label || showValue) && (
        <div className={styles.labelRow}>
          {label && <span className={styles.label}>{label}</span>}
          {showValue && <span className={styles.percent}>{Math.round(percent)}%</span>}
        </div>
      )}
      <div className={styles.track} role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div
          className={styles.fill}
          style={{
            width: `${percent}%`,
            background: status ? STATUS_COLOR[status].fg : undefined,
          }}
        />
      </div>
    </div>
  );
}
