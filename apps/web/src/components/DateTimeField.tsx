import { TextField, type TextFieldProps } from "@showme/design-system";
import { type MouseEvent, useRef } from "react";
import { DatePickerField } from "./DatePickerField";

export interface DateTimeFieldProps extends Omit<TextFieldProps, "type"> {
  /** Which picker to open. Defaults to a date *and* time picker. */
  type?: "date" | "datetime-local" | "month" | "time" | "week";
}

/**
 * A date/time `TextField` whose picker opens on a click anywhere in the field.
 *
 * Natively only the small indicator glyph at the far right opens the calendar —
 * a click anywhere else merely moves the caret between the `yyyy`/`mm`/`dd`
 * segments, so to a user the field reads as "the date picker doesn't open".
 * Making the whole field the hit target is the fix.
 *
 * For a plain `date` the picker is OURS (`DatePickerField`), drawn in the page
 * with design-system tokens: the browser's popup is chrome no CSS can reach, so
 * it renders in system colors and typography and looks alien inside our modals.
 * The other types keep the native picker — a time/week/month popover would be a
 * second, half-built widget, and the native one at least behaves correctly now
 * that `color-scheme` follows the app theme (see `app.css`).
 */
export function DateTimeField({ type = "datetime-local", ...rest }: DateTimeFieldProps) {
  if (type === "date") return <DatePickerField {...rest} />;
  return <NativePickerField {...rest} type={type} />;
}

function NativePickerField({
  type,
  onClick,
  ...rest
}: DateTimeFieldProps & { type: Exclude<DateTimeFieldProps["type"], "date" | undefined> }) {
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
