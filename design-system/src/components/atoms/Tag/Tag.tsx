import type { HTMLAttributes } from "react";
import { classNames } from "@/lib/classNames";
import styles from "./Tag.module.css";

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  /** Mono uppercase micro-label. Used for section eyebrows and meta labels. */
  tone?: "muted" | "accent" | "dim";
}

/** The JetBrains-Mono uppercase micro-label used everywhere for eyebrows,
 * field labels, IBAN-style meta and section numbers. */
export function Tag({ tone = "muted", className, children, ...rest }: TagProps) {
  return (
    <span className={classNames(styles.tag, styles[tone], className)} {...rest}>
      {children}
    </span>
  );
}
