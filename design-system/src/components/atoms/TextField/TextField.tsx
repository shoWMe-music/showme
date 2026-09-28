import type { InputHTMLAttributes, ReactNode } from "react";
import { forwardRef, useId } from "react";
import { classNames } from "@/lib/classNames";
import styles from "./TextField.module.css";

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Mono uppercase label rendered above the field. */
  label?: ReactNode;
  /**
   * One line under the field — what the field expects, or why it is refusing.
   *
   * The same prop, class and markup `TagInput` already has. It is here so the two
   * sibling text atoms agree rather than one screen hand-rolling a muted span at
   * 12px, which is the divergence that drifts (CLAUDE.md, review gate). Wired to
   * the input through `aria-describedby`, so a screen reader hears the reason a
   * field is not accepted rather than only seeing a disabled button.
   */
  hint?: ReactNode;
}

/** The app's form text field (distinct from the inset search `Input`): an
 * `--elevated` fill with a hairline border on 10px radius; focus swaps the
 * border to primary red. Optional label above. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, id, className, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  return (
    <div className={classNames(styles.field, className)}>
      {label && <label htmlFor={inputId} className={styles.label}>{label}</label>}
      <input
        ref={ref}
        id={inputId}
        className={styles.input}
        aria-describedby={hint ? hintId : undefined}
        {...rest}
      />
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
    </div>
  );
});
