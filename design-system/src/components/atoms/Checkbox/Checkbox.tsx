import { type ReactNode, useId } from "react";
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
  // `aria-label` only carries a STRING label. A rich label — a name beside a
  // count, a scope beside its description — left the control with no accessible
  // name at all, because the visible text is a SIBLING span the button has no
  // relationship to. `aria-labelledby` closes that: it points at the span, so a
  // screen reader announces whatever is actually rendered, string or not.
  const generatedId = useId();
  const labelId = label != null && typeof label !== "string" ? `${generatedId}-label` : undefined;
  const box = (
    <button
      type="button"
      id={id}
      role="checkbox"
      aria-checked={checked}
      aria-label={typeof label === "string" ? label : undefined}
      aria-labelledby={labelId}
      disabled={disabled}
      onClick={toggle}
      className={classNames(
        styles.box,
        checked && styles.checked,
        checked && tone === "brand" && styles.checkedBrand,
        "touch-target-overlay",
      )}
    >
      {checked && <Icon name="check" size={13} strokeWidth={2.6} />}
    </button>
  );

  if (label == null) return <span className={className}>{box}</span>;
  return (
    <span className={classNames(styles.wrap, className)}>
      {box}
      <span id={labelId} className={styles.label} onClick={toggle}>{label}</span>
    </span>
  );
}
