import { Button } from "@showme/design-system";
import type { KeyboardEventHandler, RefObject } from "react";
import { MiniMonthCalendar } from "./MiniMonthCalendar";
import { PickerPopoverPanel } from "./PickerPopoverPanel";
import { TimePickerControl } from "./TimePickerControl";
import { dayKey } from "./calendarGrid";

const PANEL_WIDTH = 268;
/** Enough for a 6-row month plus header and footer. */
const CALENDAR_HEIGHT = 330;
/** What the wall-clock row adds when the field also picks a time. */
const TIME_ROW_HEIGHT = 58;

/** The wall-clock half, present only for a `datetime-local` field. */
export interface DatePickerPopoverTime {
  /** `hh:mm`, or `""` when no time has been chosen yet. */
  value: string;
  onChange: (next: string) => void;
}

export interface DatePickerPopoverProps {
  /** The field's rectangle, so the panel hangs off it like the native popup did. */
  anchor: DOMRect;
  panelRef: RefObject<HTMLDialogElement | null>;
  /** Selected day, `yyyy-mm-dd` (empty when the field has no value yet). */
  selected: string;
  /** Any date inside the month on show. */
  month: Date;
  /** Roving-focus day, `yyyy-mm-dd`. */
  focusedDay: string;
  /** Whether the grid should hold DOM focus (keyboard route) or leave it in the
   * field (the user clicked in and may still be typing). */
  keyboardActive: boolean;
  onSelect: (dayKey: string) => void;
  onNavigate: (offset: number) => void;
  onGridKeyDown: KeyboardEventHandler<HTMLDivElement>;
  onClear: () => void;
  /** Dismiss the panel — the "Done" action once there is a time to finish. */
  onDone?: () => void;
  time?: DatePickerPopoverTime;
}

/**
 * The in-app replacement for the browser's native calendar popup: the same
 * `MiniMonthCalendar` the Requests rail uses, floated against the date field so
 * it inherits the app's surfaces, type and brand-red selection in both themes.
 *
 * For a `datetime-local` field a `TimePickerControl` joins it below the grid —
 * one panel for the whole value, because a day and a wall clock chosen in two
 * different popups is how you end up with a time attached to the wrong day.
 * Purely presentational — `useDatePickerPopover` owns the state.
 */
export function DatePickerPopover({
  anchor,
  panelRef,
  selected,
  month,
  focusedDay,
  keyboardActive,
  onSelect,
  onNavigate,
  onGridKeyDown,
  onClear,
  onDone,
  time,
}: DatePickerPopoverProps) {
  return (
    <PickerPopoverPanel
      anchor={anchor}
      panelRef={panelRef}
      width={PANEL_WIDTH}
      estimatedHeight={CALENDAR_HEIGHT + (time ? TIME_ROW_HEIGHT : 0)}
      label={time ? "Choose a date and time" : "Choose a date"}
      // With a time control the panel holds several stops; without one the grid
      // is the only stop and Tab is handled in the grid itself (it closes).
      containTab={Boolean(time)}
    >
      <MiniMonthCalendar
        month={month}
        selected={selected || undefined}
        focusedDay={focusedDay}
        autoFocusDay={keyboardActive}
        onSelect={onSelect}
        onNavigate={onNavigate}
        onGridKeyDown={onGridKeyDown}
        style={{ boxShadow: "var(--shadow-lg)", background: "var(--surface)" }}
        footer={
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              paddingTop: 10,
              borderTop: "1px solid var(--border)",
            }}
          >
            {/* Never auto-focused: the grid keeps the keyboard when the panel
                opens, and Tab walks from it into the segments. */}
            {time && (
              <TimePickerControl value={time.value} onChange={time.onChange} onDone={onDone} />
            )}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <Button variant="ghost" onClick={onClear}>
                Clear
              </Button>
              {time ? (
                // A day click can't dismiss the panel here — the time still has
                // to be set — so the panel needs its own way out.
                <Button variant="ghost" onClick={onDone}>
                  Done
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => onSelect(dayKey(new Date()))}>
                  Today
                </Button>
              )}
            </div>
          </div>
        }
      />
    </PickerPopoverPanel>
  );
}
