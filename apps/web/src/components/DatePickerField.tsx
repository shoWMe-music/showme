import { Icon, TextField, type TextFieldProps } from "@showme/design-system";
import { type MouseEvent, useRef } from "react";
import styles from "./DatePickerField.module.css";
import { DatePickerPopover } from "./DatePickerPopover";
import { useDatePickerPopover } from "./useDatePickerPopover";

export type DatePickerFieldProps = Omit<TextFieldProps, "type">;

/**
 * Right-hand padding that keeps a long value clear of the calendar trigger.
 *
 * It lives here rather than in the stylesheet because callers restyle the field
 * with an inline `style` to match their surroundings (the create-event wizard's
 * roomier fields, for one), and an inline `padding` shorthand beats any
 * stylesheet rule — the glyph would end up sitting on top of the date.
 */
const TRIGGER_RESERVE_PX = 40;

/**
 * A `yyyy-mm-dd` field whose calendar is OURS, not the browser's — same surfaces,
 * type and brand-red selection as the modal it opens in, in both themes.
 *
 * The input stays a real `type="date"`, so typing, form semantics and `min`/`max`
 * keep working exactly as before; only the popup changes. A picked day is written
 * back through the native value setter so the parent's `onChange` fires as if it
 * had been typed — the value never leaves `yyyy-mm-dd` string form, and so never
 * shifts a day across the UTC boundary.
 */
export function DatePickerField({
  onClick,
  onKeyDown,
  disabled,
  style,
  ...rest
}: DatePickerFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const value = typeof rest.value === "string" ? rest.value : undefined;
  const picker = useDatePickerPopover({ value, inputRef });

  const commitDay = (nextValue: string) => {
    const input = inputRef.current;
    if (!input) return;
    // React installs its own `value` setter on the input and remembers the last
    // value it saw; assigning `input.value` would update the DOM but look like a
    // no-op to React, so no change event would reach the parent. Writing through
    // the prototype's setter and dispatching `input` is the way to make a
    // programmatic edit indistinguishable from a typed one.
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    nativeValueSetter?.call(input, nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const selectDay = (dayKey: string) => {
    commitDay(dayKey);
    picker.closePopover(true);
  };

  const handleClick = (event: MouseEvent<HTMLInputElement>) => {
    onClick?.(event);
    // Clicking the field opens the calendar but leaves the caret where it landed,
    // so the segments stay typeable while the popover is up.
    if (!disabled) picker.openPopover(false);
  };

  return (
    <div ref={picker.wrapperRef} className={styles.field}>
      <TextField
        {...rest}
        ref={inputRef}
        type="date"
        disabled={disabled}
        style={{ ...style, paddingRight: TRIGGER_RESERVE_PX }}
        onClick={handleClick}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          picker.handleInputKeyDown(event);
        }}
      />
      <button
        type="button"
        className={styles.trigger}
        disabled={disabled}
        aria-label={picker.open ? "Close calendar" : "Open calendar"}
        aria-expanded={picker.open}
        onClick={() => picker.togglePopover(true)}
      >
        <Icon name="calendar" size={16} />
      </button>
      {picker.open && picker.anchorRect && (
        <DatePickerPopover
          anchor={picker.anchorRect}
          panelRef={picker.panelRef}
          selected={value ?? inputRef.current?.value ?? ""}
          month={picker.visibleMonth}
          focusedDay={picker.focusedDay}
          keyboardActive={picker.keyboardActive}
          onSelect={selectDay}
          onNavigate={picker.navigateMonth}
          onGridKeyDown={picker.handleGridKeyDown}
          onClear={() => selectDay("")}
        />
      )}
    </div>
  );
}
