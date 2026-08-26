import { classNames } from "@/lib/classNames";
import type { InputHTMLAttributes, ReactNode } from "react";
import { forwardRef, useId } from "react";
import styles from "./NumberField.module.css";
import { useNumberField } from "./useNumberField";

export interface NumberFieldProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "value" | "defaultValue" | "onChange" | "type" | "min" | "max" | "step"
  > {
  /** Mono uppercase label rendered above the field (matches TextField). */
  label?: ReactNode;
  /**
   * The number, or `null`/`undefined` for **nothing entered** — which renders
   * an empty field showing its placeholder. `0` is a real value and renders as
   * `0`; the two states are never conflated.
   */
  value: number | null | undefined;
  /** Receives `null` while the field is empty — never a stand-in `0`. */
  onChange: (value: number | null) => void;
  /** Fired on blur and on Enter with the settled, clamped value. */
  onCommit?: (value: number | null) => void;
  min?: number;
  max?: number;
  /** Arrow-key increment. Default 1. */
  step?: number;
  /** Decimal places accepted. `0` makes the field integers-only. Default 2. */
  decimals?: number;
  /** Default false — most figures here are money, capacities and counts. */
  allowNegative?: boolean;
  /** Inline adornment before the number (a currency symbol, typically).
   * Named to match `Input`'s adornment vocabulary. */
  leftIcon?: ReactNode;
  /** Inline adornment after the number (a unit, typically). */
  trailing?: ReactNode;
  /** Figures usually read better right-aligned in a table. Default "left". */
  align?: "left" | "right";
  className?: string;
}

/**
 * The app's numeric field.
 *
 * Its whole reason to exist is that "no value entered" and "the value zero" are
 * different states, and a number input must be able to express both: an empty
 * field stays empty and shows its placeholder instead of parking a `0` the user
 * has to select and delete before typing.
 *
 * It is a text input rather than `type="number"` on purpose — a native number
 * input reports `""` for half-typed fragments like `"-"` and `"1."`, which is
 * exactly the ambiguity this component removes. The numeric affordances are
 * kept deliberately: `inputMode` still raises the numeric keypad, arrow keys
 * still step, `min`/`max` still clamp, and the control still exposes
 * `role="spinbutton"` so screen readers announce it as a number.
 */
export const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(function NumberField(
  {
    label,
    value,
    onChange,
    onCommit,
    min,
    max,
    step = 1,
    decimals = 2,
    allowNegative = false,
    leftIcon,
    trailing,
    align = "left",
    id,
    className,
    disabled,
    placeholder,
    onBlur,
    onKeyDown,
    ...rest
  },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const { text, isEmpty, handleChange, handleKeyDown, settle } = useNumberField({
    value,
    onChange,
    onCommit,
    min,
    max,
    step,
    decimals,
    allowNegative,
  });

  return (
    <div className={classNames(styles.field, className)}>
      {label && (
        <label htmlFor={inputId} className={styles.label}>
          {label}
        </label>
      )}
      <div className={classNames(styles.control, disabled && styles.controlDisabled)}>
        {leftIcon && <span className={styles.affix}>{leftIcon}</span>}
        <input
          ref={ref}
          id={inputId}
          type="text"
          inputMode={decimals > 0 ? "decimal" : "numeric"}
          autoComplete="off"
          role="spinbutton"
          aria-valuenow={isEmpty ? undefined : (value ?? undefined)}
          aria-valuemin={min}
          aria-valuemax={max}
          // Without this, an empty spinbutton is announced as if it held a
          // value. Empty must sound empty.
          aria-valuetext={isEmpty ? "Empty" : undefined}
          className={classNames(styles.input, align === "right" && styles.inputRight)}
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(changeEvent) => handleChange(changeEvent.target.value)}
          onKeyDown={(keyEvent) => {
            handleKeyDown(keyEvent);
            onKeyDown?.(keyEvent);
          }}
          onBlur={(focusEvent) => {
            settle();
            onBlur?.(focusEvent);
          }}
          {...rest}
        />
        {trailing && <span className={styles.affix}>{trailing}</span>}
      </div>
    </div>
  );
});
