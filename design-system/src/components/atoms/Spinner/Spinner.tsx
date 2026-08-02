import { classNames } from "@/lib/classNames";
import styles from "./Spinner.module.css";

export interface SpinnerProps {
  size?: number;
  /** Accessible label announced to assistive tech. */
  label?: string;
  className?: string;
}

/** A rotating loading indicator. Thickness scales with size; the leading arc is
 * the primary red. */
export function Spinner({ size = 20, label = "Loading", className }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={classNames(styles.spinner, className)}
      style={{ width: size, height: size, borderWidth: Math.max(2, Math.round(size / 12)) }}
    />
  );
}
