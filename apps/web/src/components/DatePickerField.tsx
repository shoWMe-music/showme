import { Icon, TextField, type TextFieldProps } from "@showme/design-system";
import { type MouseEvent, useRef, useState } from "react";
import styles from "./DatePickerField.module.css";
import { DatePickerPopover } from "./DatePickerPopover";
import { commitFieldValue } from "./fieldValueCommit";
import { joinLocalDateTime, splitLocalDateTime } from "./timePickerValue";
import { useDatePickerPopover } from "./useDatePickerPopover";

export interface DatePickerFieldProps extends Omit<TextFieldProps, "type"> {
  /** Pick a wall clock as well as a day — the input becomes `datetime-local`
   * and the popover grows a `TimePickerControl` under the grid. */
  withTime?: boolean;
}

/**
 * Right-hand padding that keeps a long value clear of the calendar trigger.
 *
 * It lives here rather than in the stylesheet because callers restyle the field
 * with an inline `style` to match their surroundings (the create-event wizard's
 * roomier fields, for one), and an inline `padding` shorthand beats any
 * stylesheet rule — the glyph would end up sitting on top of the date.
 *
 * Kept as tight as the 24px trigger allows (`right: 5px` + 22px wide + a hair of
 * gap): the Event Schedule's Time field is 190px, and a `datetime-local` value
 * renders as the full "2026-12-05, 19:00" — a more generous reserve clips the
 * last digit of the clock.
 */
const TRIGGER_RESERVE_PX = 30;

/** The wall clock a day gets when it is picked before any time is set. Midnight
 * is the only neutral answer, and picking a day makes it VISIBLE in the segments
 * straight away, so nobody saves an hour they never saw. */
const MIDNIGHT = "00:00";

/**
 * A `yyyy-mm-dd` (or `yyyy-mm-ddThh:mm`) field whose picker is OURS, not the
 * browser's — same surfaces, type and brand-red selection as the modal it opens
 * in, in both themes.
 *
 * The input stays a real `date` / `datetime-local`, so typing, form semantics
 * and `min`/`max` keep working exactly as before; only the popup changes. A
 * picked day or time is written back through the native value setter so the
 * parent's `onChange` fires as if it had been typed.
 *
 * The value NEVER leaves its string form. The day travels as `yyyy-mm-dd` and
 * the clock as `hh:mm`, joined by position — no `Date`, no UTC instant, so a
 * 19:00 curfew cannot shift an hour or a day between here and Postgres.
 */
export function DatePickerField({
  onClick,
  onKeyDown,
  disabled,
  style,
  withTime = false,
  ...rest
}: DatePickerFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const value = typeof rest.value === "string" ? rest.value : undefined;
  const picker = useDatePickerPopover({ value, inputRef, panelHasMoreStops: withTime });

  const currentValue = value ?? inputRef.current?.value ?? "";
  const { day, time } = splitLocalDateTime(currentValue);
  // A `datetime-local` input rejects a half value, so a clock chosen before any
  // day has to wait here until there is a day to attach it to.
  const [timeWithoutDay, setTimeWithoutDay] = useState("");
  const chosenTime = time || timeWithoutDay;

  const commit = (nextValue: string) => commitFieldValue(inputRef.current, nextValue);

  const selectDay = (nextDay: string) => {
    if (!withTime) {
      commit(nextDay);
      picker.closePopover(true);
      return;
    }
    commit(joinLocalDateTime(nextDay, chosenTime || MIDNIGHT));
    // The panel stays up: the day is only half the value, and shutting it now
    // would send the user back through the field to set the time.
  };

  const selectTime = (nextTime: string) => {
    if (day) commit(joinLocalDateTime(day, nextTime));
    else setTimeWithoutDay(nextTime);
  };

  const clear = () => {
    commit("");
    setTimeWithoutDay("");
    picker.closePopover(true);
  };

  const handleClick = (event: MouseEvent<HTMLInputElement>) => {
    onClick?.(event);
    // Clicking the field opens the picker but leaves the caret where it landed,
    // so the segments stay typeable while the popover is up.
    if (!disabled) picker.openPopover(false);
  };

  return (
    <div ref={picker.wrapperRef} className={styles.field}>
      <TextField
        {...rest}
        ref={inputRef}
        type={withTime ? "datetime-local" : "date"}
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
          selected={day}
          month={picker.visibleMonth}
          focusedDay={picker.focusedDay}
          keyboardActive={picker.keyboardActive}
          onSelect={selectDay}
          onNavigate={picker.navigateMonth}
          onGridKeyDown={picker.handleGridKeyDown}
          onClear={clear}
          onDone={() => picker.closePopover(true)}
          time={withTime ? { value: chosenTime, onChange: selectTime } : undefined}
        />
      )}
    </div>
  );
}
