import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  HOUR_PAGE_STEP,
  MAXIMUM_HOUR,
  MAXIMUM_MINUTE,
  MINUTES_PER_HOUR,
  MINUTE_PAGE_STEP,
  MINUTE_STEP,
  formatWallClock,
  parseWallClock,
  stepHours,
  stepMinutes,
  withHour,
  withMinute,
} from "./timePickerValue";

export type TimeSegment = "hour" | "minute";

export interface TimePickerControlOptions {
  /** `hh:mm`, or `""` when no time has been chosen yet. */
  value: string;
  onChange: (next: string) => void;
  /** Enter inside a segment — "I'm finished here" (the popover closes). */
  onDone?: () => void;
  /** Put the caret in the hour segment (the keyboard route into the picker). */
  autoFocus?: boolean;
}

/**
 * All the behaviour behind `TimePickerControl`: two typeable segments that also
 * answer to the arrow keys, and the stepper buttons beside them.
 *
 * The committed value is the single source of truth; `editing` only holds the
 * DIGITS SO FAR of the segment being typed into, so that a half-typed hour
 * shows as "1" rather than being padded to "01" under the caret. It is dropped
 * on blur, at which point the segment goes back to rendering the value.
 */
export function useTimePickerControl({
  value,
  onChange,
  onDone,
  autoFocus = false,
}: TimePickerControlOptions) {
  const hourRef = useRef<HTMLInputElement>(null);
  const minuteRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<{ segment: TimeSegment; text: string } | null>(null);

  const minutes = parseWallClock(value);
  // An arrow press on an empty field has to start somewhere; midnight is the
  // only neutral answer, and it is immediately visible in the segments.
  const base = minutes ?? 0;

  const commit = useCallback(
    (nextMinutes: number) => {
      onChange(formatWallClock(nextMinutes));
    },
    [onChange],
  );

  const focusSegment = useCallback((segment: TimeSegment) => {
    const input = segment === "hour" ? hourRef.current : minuteRef.current;
    input?.focus();
    input?.select();
  }, []);

  /** A step key: commit and drop the typing buffer, so the segments re-render
   * padded from the new value. */
  const apply = useCallback(
    (nextMinutes: number) => {
      setEditing(null);
      commit(nextMinutes);
    },
    [commit],
  );

  const typeSegment = useCallback(
    (segment: TimeSegment, raw: string) => {
      const digits = raw.replace(/\D/g, "");
      if (digits === "") {
        // Cleared under the caret: show it empty, but keep the committed value
        // until an actual digit replaces it.
        setEditing({ segment, text: "" });
        return;
      }
      const maximum = segment === "hour" ? MAXIMUM_HOUR : MAXIMUM_MINUTE;
      // Prefer the last two digits ("1" then "9" → 19); when that pair is out of
      // range, the new digit starts a fresh segment ("19" then "3" → 3), which
      // is how a native segmented field behaves.
      const pair = digits.slice(-2);
      const text = Number(pair) <= maximum ? pair : digits.slice(-1);
      const numeric = Number(text);
      setEditing({ segment, text });
      commit(segment === "hour" ? withHour(base, numeric) : withMinute(base, numeric));
      // The hour is finished once it cannot grow: two digits typed, or a first
      // digit above 2, which no two-digit hour can start with.
      if (segment === "hour" && (text.length === 2 || numeric > 2)) focusSegment("minute");
    },
    [base, commit, focusSegment],
  );

  const handleKeyDown = useCallback(
    (segment: TimeSegment, event: KeyboardEvent<HTMLInputElement>) => {
      const isHour = segment === "hour";
      const steps: Record<string, number | undefined> = {
        ArrowUp: isHour ? stepHours(base, 1) : stepMinutes(base, MINUTE_STEP),
        ArrowDown: isHour ? stepHours(base, -1) : stepMinutes(base, -MINUTE_STEP),
        PageUp: isHour ? stepHours(base, HOUR_PAGE_STEP) : stepMinutes(base, MINUTE_PAGE_STEP),
        PageDown: isHour ? stepHours(base, -HOUR_PAGE_STEP) : stepMinutes(base, -MINUTE_PAGE_STEP),
        Home: isHour ? withHour(base, 0) : withMinute(base, 0),
        End: isHour ? withHour(base, MAXIMUM_HOUR) : withMinute(base, MAXIMUM_MINUTE),
      };
      const next = steps[event.key];
      if (next !== undefined) {
        event.preventDefault();
        apply(next);
        return;
      }
      // Left/Right walk between the two segments. A two-character segment has no
      // meaningful caret travel, so the keys are worth more as navigation.
      if (event.key === "ArrowRight" && isHour) {
        event.preventDefault();
        focusSegment("minute");
        return;
      }
      if ((event.key === ":" || event.key === " ") && isHour) {
        event.preventDefault();
        focusSegment("minute");
        return;
      }
      if (event.key === "ArrowLeft" && !isHour) {
        event.preventDefault();
        focusSegment("hour");
        return;
      }
      if (event.key === "Enter") {
        // The panel is portalled to <body>, so these inputs belong to no form and
        // Enter cannot submit one — but it should still mean "done here".
        event.preventDefault();
        onDone?.();
      }
      // Escape is deliberately untouched: the popover's document-level CAPTURE
      // listener closes the picker (and only the picker) before anything else.
    },
    [base, apply, focusSegment, onDone],
  );

  const stepByMinutes = useCallback(
    (delta: number) => {
      apply(stepMinutes(base, delta));
      // The buttons must not steal focus from whichever segment has it, so the
      // caret stays where the user left it after a nudge.
    },
    [apply, base],
  );

  useEffect(() => {
    if (autoFocus) focusSegment("hour");
  }, [autoFocus, focusSegment]);

  const pad = (part: number) => String(part).padStart(2, "0");
  const hourText =
    editing?.segment === "hour"
      ? editing.text
      : minutes === null
        ? ""
        : pad(Math.floor(minutes / MINUTES_PER_HOUR));
  const minuteText =
    editing?.segment === "minute"
      ? editing.text
      : minutes === null
        ? ""
        : pad(minutes % MINUTES_PER_HOUR);

  return {
    hourRef,
    minuteRef,
    hourText,
    minuteText,
    /** Whether the field is still blank — the segments show their `--` hint. */
    isEmpty: minutes === null,
    typeSegment,
    handleKeyDown,
    stepByMinutes,
    focusSegment,
    /** Drop the typing buffer so the segment renders its padded value again. */
    endEditing: useCallback(() => setEditing(null), []),
  };
}
