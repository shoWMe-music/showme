import { classNames } from "@/lib/classNames";
import styles from "./Toggle.module.css";

export interface ToggleProps {
  checked: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  /** Accessible label (used as aria-label when no visible label is rendered). */
  label?: string;
  id?: string;
  className?: string;
}

/** The on/off switch used across settings, theme, two-factor and feature rows.
 * Track fills with the brand gradient when on; the knob slides right. */
export function Toggle({ checked, onChange, disabled = false, label, id, className }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={classNames(styles.track, checked && styles.on, "touch-target-overlay", className)}
    >
      <span className={styles.knob} />
    </button>
  );
}
