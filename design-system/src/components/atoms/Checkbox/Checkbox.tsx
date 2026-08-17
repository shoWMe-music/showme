import type { ReactNode } from "react";
import { classNames } from "@/lib/classNames";
import { Icon } from "@/icons";
import styles from "./Checkbox.module.css";

export interface CheckboxProps {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  /** Optional label rendered next to the box; clicking it also toggles. */
  label?: ReactNode;
  /** Checked fill: `confirmed` (green, the default) or `brand` (red — used where
   * the check means "block/exclude" rather than "done"). */
  tone?: "confirmed" | "brand";
  id?: string;
  className?: string;
}

/** The rounded check-box from the prototype: a 20px box that turns green (or brand
 * red) with a white check when checked. Accessible (role="checkbox", space/enter
 * toggles). */
export function Checkbox({
  checked,
  onChange,
  disabled = false,
  label,
  tone = "confirmed",
  id,
  className,
}: CheckboxProps) {
  const toggle = () => { if (!disabled) onChange?.(!checked); };
  const box = (
    <button
      type="button"
      id={id}
      role="checkbox"
      aria-checked={checked}
      aria-label={typeof label === "string" ? label : undefined}
      disabled={disabled}
      onClick={toggle}
      className={classNames(
        styles.box,
        checked && styles.checked,
        checked && tone === "brand" && styles.checkedBrand,
      )}
    >
      {checked && <Icon name="check" size={13} strokeWidth={2.6} />}
    </button>
  );

  if (label == null) return <span className={className}>{box}</span>;
  return (
    <span className={classNames(styles.wrap, className)}>
      {box}
      <span className={styles.label} onClick={toggle}>{label}</span>
    </span>
  );
}
