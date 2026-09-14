import type { CSSProperties, ReactNode } from "react";
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
  /**
   * `comfortable` is the standalone dashboard tile: its own card, a figure that
   * grows to 34px when the tile is wide.
   *
   * `compact` is a CELL IN A GRID OF FIGURES — no border, no radius, no shadow,
   * because the grid draws the separators instead (see `KpiRow`'s slab). Half the
   * padding, and the figure in the SANS face rather than the display one: a wall
   * of nine display-face numbers reads as nine headlines competing, which is what
   * "too spacious" was describing as much as the padding was.
   */
  density?: "comfortable" | "compact";
  /**
   * Compact only: the figure's size in px. Two call sites, two deliberate sizes —
   * the headline strip leads at 19 and the grid of nine sits at 15, so the strip
   * stays the thing you read first. A number rather than another named variant
   * because those are the whole vocabulary and naming them adds nothing.
   */
  valueSize?: number;
  className?: string;
}

/** A KPI tile: mono label + large display figure + optional hint. Used across
 * dashboards (revenue, payouts, settlement totals). */
export function StatCard({
  label,
  value,
  hint,
  icon,
  density = "comfortable",
  valueSize,
  className,
}: StatCardProps) {
  return (
    <div
      className={classNames(styles.card, density === "compact" && styles.compact, className)}
      style={valueSize ? ({ "--stat-value-size": `${valueSize}px` } as CSSProperties) : undefined}
    >
      <div className={styles.row}>
        <div className={styles.label}>{label}</div>
        {icon && <span className={styles.icon}>{icon}</span>}
      </div>
      <div className={styles.value}>{value}</div>
      {hint && <div className={styles.hint}>{hint}</div>}
    </div>
  );
}
