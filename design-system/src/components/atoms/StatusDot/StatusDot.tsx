import type { HTMLAttributes } from "react";
import { classNames } from "@/lib/classNames";
import { STATUS_COLOR, type Status } from "@/lib/status";
import styles from "./StatusDot.module.css";

export interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
  status: Status;
  size?: number;
}

/** The exact status dot — a solid circle of the status hue (source literal),
 * used on calendar cells, list rows and badges. Source uses 6px / 12px. */
export function StatusDot({ status, size = 12, className, style, ...rest }: StatusDotProps) {
  return (
    <span
      className={classNames(styles.dot, className)}
      style={{ width: size, height: size, background: STATUS_COLOR[status].fg, ...style }}
      {...rest}
    />
  );
}
