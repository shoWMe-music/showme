import type { InputHTMLAttributes, ReactNode } from "react";
import { forwardRef, useId } from "react";
import { classNames } from "@/lib/classNames";
import styles from "./TextField.module.css";

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Mono uppercase label rendered above the field. */
  label?: ReactNode;
}

/** The app's form text field (distinct from the inset search `Input`): an
 * `--elevated` fill with a hairline border on 10px radius; focus swaps the
 * border to primary red. Optional label above. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, id, className, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <div className={classNames(styles.field, className)}>
      {label && <label htmlFor={inputId} className={styles.label}>{label}</label>}
      <input ref={ref} id={inputId} className={styles.input} {...rest} />
    </div>
  );
});
