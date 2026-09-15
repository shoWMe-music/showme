import type { CSSProperties, HTMLAttributes } from "react";
import { classNames } from "@/lib/classNames";
import { GLOWING_STATUSES, STATUS_COLOR, type Status } from "@/lib/status";
import styles from "./StatusDot.module.css";

export interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
  status: Status;
  size?: number;
}

/** The exact status dot — a solid circle of the status hue (source literal),
 * used on calendar cells, list rows and badges. Source uses 6px / 12px.
 *
 * Glows for the statuses `Badge` glows for, read from the same set so a calendar
 * cell and a list row never disagree about whether tonight is lit up. */
export function StatusDot({ status, size = 12, className, style, ...rest }: StatusDotProps) {
  const glows = GLOWING_STATUSES.has(status);
  // `--glow` is a custom property: React passes it through, `CSSProperties` does
  // not model it, and the cast is the standard way to say so.
  const glowStyle = glows ? ({ "--glow": STATUS_COLOR[status].fg } as CSSProperties) : {};
  return (
    <span
      className={classNames(styles.dot, glows && styles.glow, className)}
      style={{ width: size, height: size, background: STATUS_COLOR[status].fg, ...glowStyle, ...style }}
      {...rest}
    />
  );
}
