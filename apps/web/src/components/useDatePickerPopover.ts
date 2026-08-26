import {
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { dayKey } from "./calendarGrid";

/**
 * Parse a `yyyy-mm-dd` day into a LOCAL date at midnight.
 *
 * Never `new Date(value)`: the ISO date form is parsed as UTC, so west of
 * Greenwich it lands on the previous wall-clock day — the exact bug that once
 * shifted stored dates here. A calendar day is a wall-clock day; it only ever
 * travels as its `yyyy-mm-dd` string, and `dayKey()` (also local) is the way
 * back out. Nothing in this picker touches `toISOString()`.
 */
export function parseDayKey(value: string | undefined | null): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
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
  /** The field's current `yyyy-mm-dd` value; undefined for an uncontrolled
   * field, where the input's own DOM value is read instead. */
  value?: string;
  inputRef: RefObject<HTMLInputElement | null>;
}

/**
 * All the state and keyboard behaviour behind `DatePickerPopover`, kept out of
 * the components so both stay presentational.
 */
export function useDatePickerPopover({ value, inputRef }: DatePickerPopoverOptions) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDialogElement>(null);

  const [open, setOpen] = useState(false);
  // Whether the calendar (rather than the text field) currently holds the
  // keyboard: only then does the grid pull DOM focus onto the roving day.
  const [keyboardActive, setKeyboardActive] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(new Date()));
  const [focusedDay, setFocusedDay] = useState(() => dayKey(new Date()));
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const measureAnchor = useCallback(() => {
    const rect = inputRef.current?.getBoundingClientRect();
    if (rect) setAnchorRect(rect);
  }, [inputRef]);

  const openPopover = useCallback(
    (withKeyboard: boolean) => {
      measureAnchor();
      setKeyboardActive(withKeyboard);
      setOpen(true);
    },
    [measureAnchor],
  );

  const closePopover = useCallback(
    (returnFocus: boolean) => {
      setOpen(false);
      setKeyboardActive(false);
      if (returnFocus) inputRef.current?.focus();
    },
    [inputRef],
  );

  const togglePopover = useCallback(
    (withKeyboard: boolean) => {
      if (open) closePopover(true);
      else openPopover(withKeyboard);
    },
    [open, openPopover, closePopover],
  );

  // Keep the calendar pointed at whatever the field says — including days typed
  // straight into the input while the popover is open. Runs on open too, which
  // is what seeds the month and the roving focus.
  useEffect(() => {
    if (!open) return;
    const target = parseDayKey(value) ?? parseDayKey(inputRef.current?.value) ?? new Date();
    setFocusedDay(dayKey(target));
    setVisibleMonth(startOfMonth(target));
  }, [open, value, inputRef]);

  // Escape must close the POPOVER only. The design-system Modal listens for
  // Escape on `document` in the bubble phase, so a document-level CAPTURE
  // listener here runs first and stops the event before the modal ever sees it —
  // one Escape closes the calendar, the next closes the modal.
  useEffect(() => {
    if (!open) return;
    const onKeyDownCapture = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closePopover(true);
    };
    document.addEventListener("keydown", onKeyDownCapture, true);
    return () => document.removeEventListener("keydown", onKeyDownCapture, true);
  }, [open, closePopover]);

  // Dismiss when the pointer or the focus lands anywhere outside the field and
  // its calendar (no click-catcher overlay: one would swallow the first click on
  // the modal behind it, and as a <button> it would sit in the tab order).
  useEffect(() => {
    if (!open) return;
    const isOutside = (target: EventTarget | null) => {
      const node = target instanceof Node ? target : null;
      if (!node) return true;
      return !wrapperRef.current?.contains(node) && !panelRef.current?.contains(node);
    };
    const onPointerDown = (event: MouseEvent) => {
      if (isOutside(event.target)) closePopover(false);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (isOutside(event.target)) closePopover(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [open, closePopover]);

  // The field moves with the modal body's scroll, so re-measure rather than let
  // the panel drift away from it.
  useEffect(() => {
    if (!open) return;
    const onViewportChange = () => measureAnchor();
    window.addEventListener("resize", onViewportChange);
    document.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      document.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open, measureAnchor]);

  const moveFocus = useCallback((next: Date) => {
    setFocusedDay(dayKey(next));
    setVisibleMonth((current) =>
      current.getFullYear() === next.getFullYear() && current.getMonth() === next.getMonth()
        ? current
        : startOfMonth(next),
    );
    setKeyboardActive(true);
  }, []);

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
      if (event.key === "Tab") {
        // The calendar is portalled to the end of <body>, so a real Tab would
        // jump out of the modal entirely. Hand focus back to the field instead.
        event.preventDefault();
        closePopover(true);
      }
    },
    [focusedDay, moveFocus, closePopover],
  );

  /** Alt+ArrowDown is the standard "open the picker" chord — and in Chrome it is
   * one of the gestures that would otherwise summon the NATIVE calendar. */
  const handleInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.altKey && event.key === "ArrowDown") {
        event.preventDefault();
        openPopover(true);
      }
    },
    [openPopover],
  );

  return {
    wrapperRef,
    panelRef,
    open,
    anchorRect,
    visibleMonth,
    focusedDay,
    keyboardActive,
    openPopover,
    closePopover,
    togglePopover,
    navigateMonth,
    handleGridKeyDown,
    handleInputKeyDown,
  };
}
