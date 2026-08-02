import type { HTMLAttributes } from "react";
import { classNames } from "@/lib/classNames";
import styles from "./Card.module.css";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds a hover lift + accent border (for clickable cards). */
  interactive?: boolean;
  /** Inner padding preset. */
  padding?: "sm" | "md" | "lg" | "none";
  /** Raise elevation to shadow-lg. */
  elevated?: boolean;
}

/** The surface primitive: the warm gradient `--card` fill, hairline border and
 * soft shadow that every panel, list and tile in the product sits on. */
export function Card({
  interactive = false,
  padding = "md",
  elevated = false,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={classNames(
        styles.card,
        styles[`p-${padding}`],
        interactive && styles.interactive,
        elevated && styles.elevated,
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
