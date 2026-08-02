import type { InputHTMLAttributes, ReactNode } from "react";
import { forwardRef } from "react";
import { classNames } from "@/lib/classNames";
import { Icon } from "@/icons";
import styles from "./Input.module.css";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Icon rendered inside, before the field. */
  leftIcon?: ReactNode;
  /** Content after the field (e.g. a shortcut hint). */
  trailing?: ReactNode;
}

/** Text input with an optional inset icon. Matches the prototype's inset-dark
 * field on `--bg` with a `--border-strong` outline. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { leftIcon, trailing, className, ...rest },
  ref,
) {
  return (
    <label className={classNames(styles.wrap, className)}>
      {leftIcon && <span className={styles.icon}>{leftIcon}</span>}
      <input ref={ref} className={styles.input} {...rest} />
      {trailing && <span className={styles.trailing}>{trailing}</span>}
    </label>
  );
});

/** Convenience: a search field pre-wired with the search icon. */
export function SearchInput(props: InputProps) {
  return <Input leftIcon={<Icon name="search" size={16} strokeWidth={2} />} placeholder="Search events, artists…" {...props} />;
}
