import { Icon } from "@showme/design-system";
import { type CSSProperties, useRef } from "react";
import { DatePickerPopover } from "./DatePickerPopover";
import { dayKey } from "./calendarGrid";
import { useDatePickerPopover } from "./useDatePickerPopover";

/**
 * "Jump to date" — the calendar's own navigation, spelled out.
 *
 * A labelled button rather than a date FIELD, for two reasons. It changes where
 * the reader is, so it belongs beside Today and the month arrows and must not
 * read as a fourth filter. And an `<input type="date">` renders its value in the
 * browser's locale — a US reader saw `mm/dd/yyyy` on a screen that prints every
 * other date day-first — while this button carries a word instead of a value.
 *
 * The panel is the app's own picker, the same one every date field opens.
 */
export interface CalendarJumpToDateProps {
  /** The day the calendar is currently pointed at, `yyyy-mm-dd`: the picker
   * opens on its month with that day already under the keyboard. */
  value: string;
  onSelect: (dayKey: string) => void;
  /** Supplied by the toolbar so the trigger matches the controls beside it. */
  style?: CSSProperties;
}

export function CalendarJumpToDate({ value, onSelect, style }: CalendarJumpToDateProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const picker = useDatePickerPopover({
    value,
    inputRef: triggerRef,
  });

  const jumpTo = (day: string) => {
    onSelect(day);
    picker.closePopover(true);
  };

  return (
    <div ref={picker.wrapperRef} style={{ display: "inline-flex" }}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={picker.open}
        // `true`: there is no field to type into here, so the grid takes the
        // keyboard as soon as the panel opens.
        onClick={() => picker.togglePopover(true)}
        // The toolbar owns this trigger's whole appearance (`style`), so it has
        // to own its touch floor too: `.touch-target` here is what puts the
        // 36px pill on the same 44px footing as the Today and arrow buttons it
        // sits between on a coarse pointer.
        className="touch-target"
        style={style}
      >
        <Icon name="calendar" size={15} />
        Jump to date
      </button>

      {picker.open && picker.anchorRect && (
        <DatePickerPopover
          anchor={picker.anchorRect}
          panelRef={picker.panelRef}
          selected={value}
          month={picker.visibleMonth}
          focusedDay={picker.focusedDay}
          keyboardActive={picker.keyboardActive}
          onSelect={jumpTo}
          onNavigate={picker.navigateMonth}
          onGridKeyDown={picker.handleGridKeyDown}
          // The calendar is always pointed at SOME day, so there is no value to
          // empty: clearing a jump means going back to today.
          onClear={() => jumpTo(dayKey(new Date()))}
        />
      )}
    </div>
  );
}
