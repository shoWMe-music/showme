import {
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { dayKey } from "./calendarGrid";
import { usePickerPopover } from "./usePickerPopover";

/**
 * Parse a `yyyy-mm-dd` day into a LOCAL date at midnight. A `datetime-local`
 * stamp (`yyyy-mm-ddThh:mm`) is accepted too and its clock half ignored — the
 * calendar only ever cares which day it is looking at.
 *
 * Never `new Date(value)`: the ISO date form is parsed as UTC, so west of
 * Greenwich it lands on the previous wall-clock day — the exact bug that once
 * shifted stored dates here. A calendar day is a wall-clock day; it only ever
 * travels as its `yyyy-mm-dd` string, and `dayKey()` (also local) is the way
 * back out. Nothing in this picker touches `toISOString()`.
 */
export function parseDayKey(value: string | undefined | null): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2})?)?$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function isSameMonth(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth();
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** How far each navigation key moves the roving focus, in days. */
const DAY_STEPS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

export interface DatePickerPopoverOptions {
  /** The field's current `yyyy-mm-dd` (or `yyyy-mm-ddThh:mm`) value; undefined
   * for an uncontrolled field, where the input's own DOM value is read instead. */
  value?: string;
  inputRef: RefObject<HTMLElement | null>;
  /** Whether the panel has controls after the grid (the wall-clock row of a
   * `datetime-local` field). When it does, Tab must walk INTO them rather than
   * closing the panel, and `PickerPopoverPanel` wraps it at the far end. */
  panelHasMoreStops?: boolean;
}

/**
 * All the state and keyboard behaviour behind `DatePickerPopover`, kept out of
 * the components so both stay presentational. The open/close/dismiss half lives
 * in `usePickerPopover`, which the time-only field shares.
 */
/**
 * The text in the anchor, when the anchor is a field at all. A button anchor
 * (`CalendarJumpToDate`) has no `value`, and asking for one is not an error —
 * it just means the picker falls through to its next source for which month to
 * open on.
 */
function anchorFieldValue(anchor: HTMLElement | null | undefined): string | undefined {
  return anchor instanceof HTMLInputElement ? anchor.value : undefined;
}

export function useDatePickerPopover({
  value,
  inputRef,
  panelHasMoreStops = false,
}: DatePickerPopoverOptions) {
  const shell = usePickerPopover({ inputRef });
  const { open, closePopover, setKeyboardActive } = shell;

  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(new Date()));
  const [focusedDay, setFocusedDay] = useState(() => dayKey(new Date()));
  /** The day this hook last pointed the calendar at, so it can tell a real day
   * change from the value merely being rewritten. */
  const seededDay = useRef<string | null>(null);

  // Keep the calendar pointed at whatever the field says — including days typed
  // straight into the input while the popover is open. Runs on open too, which
  // is what seeds the month and the roving focus.
  //
  // LAYOUT effect, not a passive one: a passive effect runs after paint, so the
  // panel would show one frame of TODAY's month before jumping to the field's —
  // a visible flick every time a December date is opened in August.
  useLayoutEffect(() => {
    if (!open) {
      seededDay.current = null;
      return;
    }
    const target =
      parseDayKey(value) ?? parseDayKey(anchorFieldValue(inputRef.current)) ?? new Date();
    const targetDay = dayKey(target);
    // Only a change of DAY may move the roving focus. On a `datetime-local`
    // field this effect re-runs every time the user nudges the clock, and
    // re-seeding then would yank the roving day back to the value's — dragging
    // real DOM focus out of the wall-clock segments with it, so the next arrow
    // press would silently step the wrong thing.
    if (seededDay.current === targetDay) return;
    seededDay.current = targetDay;
    setFocusedDay(targetDay);
    setVisibleMonth((current) => (isSameMonth(current, target) ? current : startOfMonth(target)));
  }, [open, value, inputRef]);

  const moveFocus = useCallback(
    (next: Date) => {
      setFocusedDay(dayKey(next));
      setVisibleMonth((current) => (isSameMonth(current, next) ? current : startOfMonth(next)));
      setKeyboardActive(true);
    },
    [setKeyboardActive],
  );

  const navigateMonth = useCallback((offset: number) => {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }, []);

  /** Arrow/Home/End/PageUp/PageDown inside the day grid. Enter and Space need no
   * handling — every day is a real `<button>`, which they activate natively. */
  const handleGridKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const anchorDay = parseDayKey(focusedDay) ?? new Date();
      const step = DAY_STEPS[event.key];
      if (step !== undefined) {
        event.preventDefault();
        moveFocus(addDays(anchorDay, step));
        return;
      }
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        // Monday-first week, matching the grid's own column order.
        const weekdayIndex = (anchorDay.getDay() + 6) % 7;
        const offset = event.key === "Home" ? -weekdayIndex : 6 - weekdayIndex;
        moveFocus(addDays(anchorDay, offset));
        return;
      }
      if (event.key === "PageUp" || event.key === "PageDown") {
        event.preventDefault();
        const monthOffset = event.key === "PageUp" ? -1 : 1;
        moveFocus(
          new Date(
            anchorDay.getFullYear(),
            anchorDay.getMonth() + monthOffset,
            anchorDay.getDate(),
          ),
        );
        return;
      }
      if (event.key === "Tab" && !panelHasMoreStops) {
        // The calendar is portalled to the end of <body>, so a real Tab would
        // jump out of the modal entirely. Hand focus back to the field instead.
        // When the panel has a wall-clock row below the grid, Tab is left alone:
        // DOM order takes it there, and the panel wraps it at the far end.
        event.preventDefault();
        closePopover(true);
      }
    },
    [focusedDay, moveFocus, closePopover, panelHasMoreStops],
  );

  return {
    wrapperRef: shell.wrapperRef,
    panelRef: shell.panelRef,
    open: shell.open,
    anchorRect: shell.anchorRect,
    keyboardActive: shell.keyboardActive,
    openPopover: shell.openPopover,
    closePopover: shell.closePopover,
    togglePopover: shell.togglePopover,
    handleInputKeyDown: shell.handleInputKeyDown,
    visibleMonth,
    focusedDay,
    navigateMonth,
    handleGridKeyDown,
  };
}
