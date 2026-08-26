import { TextField, type TextFieldProps } from "@showme/design-system";
import { type MouseEvent, useRef } from "react";

export interface DateTimeFieldProps extends Omit<TextFieldProps, "type"> {
  /** Which native picker to open. Defaults to a date *and* time picker. */
  type?: "date" | "datetime-local" | "month" | "time" | "week";
}

/**
 * A date/time `TextField` that opens the browser's picker when the field is
 * clicked.
 *
 * Natively only the small indicator glyph at the far right opens the calendar —
 * a click anywhere else merely moves the caret between the `yyyy`/`mm`/`dd`
 * segments, so to a user the field reads as "the date picker doesn't open".
 * Making the whole field the hit target is the fix; the glyph stays as a
 * secondary affordance.
 */
export function DateTimeField({ type = "datetime-local", onClick, ...rest }: DateTimeFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = (event: MouseEvent<HTMLInputElement>) => {
    onClick?.(event);
    openNativePicker(inputRef.current);
  };

  return <TextField {...rest} ref={inputRef} type={type} onClick={handleClick} />;
}

/**
 * `showPicker()` is the standard way to open a native picker programmatically.
 * It is guarded twice over: it does not exist in every browser, and it throws
 * (`NotAllowedError`) when there is no transient user activation or the browser
 * has no picker for this input type. Either way the field still accepts a typed
 * value, so a failure is silent by design.
 */
function openNativePicker(input: HTMLInputElement | null) {
  if (!input || typeof input.showPicker !== "function") return;
  try {
    input.showPicker();
  } catch {
    // Nothing to recover: the field remains typeable.
  }
}
