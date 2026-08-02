import type { ButtonHTMLAttributes } from "react";
import { classNames } from "@/lib/classNames";
import styles from "./Chip.module.css";

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Selected state — active chip uses the warm brand tint + accent text. */
  active?: boolean;
}

/** Filter chip (All / Performers / Agents / Venues…). Selected = brand tint. */
export function Chip({ active = false, className, children, type = "button", ...rest }: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={active}
      className={classNames(styles.chip, active && styles.active, className)}
      {...rest}
    >
      {children}
    </button>
  );
}
