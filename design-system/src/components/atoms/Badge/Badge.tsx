import type { CSSProperties, HTMLAttributes } from "react";
import { classNames } from "@/lib/classNames";
import { GLOWING_STATUSES, STATUS_COLOR, type Status } from "@/lib/status";
import styles from "./Badge.module.css";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Status hue; drives the exact tint fill + text color. Omit for neutral. */
  status?: Status;
  /** Show a leading status dot (exact 6px). */
  dot?: boolean;
}

/**
 * Exact copy of the catalog badge/pill: `padding:4px 11px; radius:999px;
 * font 11/600; gap 6px`, filled with the status hue's `.14` tint and colored
 * with the hue itself. Status colors are the source literals (not tokens).
 *
 * A status in `GLOWING_STATUSES` — today only `showday` — additionally breathes a
 * halo in its own hue. The caller does not ask for that and cannot forget it.
 */
export function Badge({ status, dot = false, className, children, ...rest }: BadgeProps) {
  const statusColor = status ? STATUS_COLOR[status] : undefined;
  const glows = status !== undefined && GLOWING_STATUSES.has(status);
  // `--glow` is a custom property: React passes it through, `CSSProperties` does
  // not model it, and the cast is the standard way to say so.
  const style = statusColor
    ? ({
        background: statusColor.tint,
        color: statusColor.fg,
        ...(glows && { "--glow": statusColor.fg }),
      } as CSSProperties)
    : undefined;
  return (
    <span
      className={classNames(styles.badge, !status && styles.neutral, glows && styles.glow, className)}
      style={style}
      {...rest}
    >
      {dot && <span className={styles.dot} style={statusColor ? { background: statusColor.fg } : undefined} />}
      {children}
    </span>
  );
}
