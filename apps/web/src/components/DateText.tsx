import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { dayKey, formatDay, formatDayWithWeekday } from "../lib/format";

/**
 * A date a person reads — and, by default, the way back to it on the calendar.
 *
 * Two problems collapse into one component. Dates used to be formatted at ~19
 * call sites across three locales, so the same show read "Sep 13" on one screen
 * and "13 Sept" on the next and carried a year on neither. And no date anywhere
 * navigated, so moving between "my events" and "that night" meant finding the
 * month by hand.
 *
 * Rendering the date and linking it are the same act, so they live together:
 * anything that prints a day gets the house format and the hop to the calendar
 * for free. Pass `link={false}` where a link would be wrong — inside another
 * clickable row (a nested link is not a thing), or on a date that names a
 * deadline rather than a day in the schedule.
 */
export interface DateTextProps {
  /** `yyyy-mm-dd`, `yyyy-mm-ddThh:mm`, or a full ISO timestamp. */
  value: string | null | undefined;
  /** Put the weekday in front — "Mon, 2 Nov 2026". */
  weekday?: boolean;
  /** Link to this day on the calendar. Off inside an already-clickable row. */
  link?: boolean;
  style?: CSSProperties;
  className?: string;
  /** Rendered instead of the date when there is no parseable value. */
  fallback?: string;
}

export function DateText({
  value,
  weekday = false,
  link = true,
  style,
  className,
  fallback = "—",
}: DateTextProps) {
  const text = weekday ? formatDayWithWeekday(value) : formatDay(value);
  const key = dayKey(value);

  if (text === "—") {
    return (
      <span style={style} className={className}>
        {fallback}
      </span>
    );
  }

  if (!link || !key) {
    return (
      <span style={style} className={className}>
        {text}
      </span>
    );
  }

  return (
    <Link
      to="/calendar"
      search={{ date: key }}
      title={`Show ${text} on the calendar`}
      className={className}
      style={{
        color: "inherit",
        textDecoration: "none",
        borderBottom: "1px solid var(--rule, transparent)",
        ...style,
      }}
    >
      {text}
    </Link>
  );
}
