import type { ButtonHTMLAttributes, ReactNode } from "react";
import { classNames } from "@/lib/classNames";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "cta";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Icon rendered before the label. */
  leftIcon?: ReactNode;
  /** Icon rendered after the label. */
  rightIcon?: ReactNode;
}

/**
 * Exact copy of the shoWMe buttons. `primary` / `secondary` / `ghost` are the
 * in-app / catalog inline buttons (12px radius); `cta` is the `.btn.btn--primary`
 * pill used for hero calls-to-action (e.g. "Propose representation").
 */
export function Button({
  variant = "primary",
  leftIcon,
  rightIcon,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={classNames(styles.btn, styles[variant], className)}
      {...rest}
    >
      {leftIcon && <span className={styles.icon}>{leftIcon}</span>}
      {children}
      {rightIcon && <span className={styles.icon}>{rightIcon}</span>}
    </button>
  );
}
