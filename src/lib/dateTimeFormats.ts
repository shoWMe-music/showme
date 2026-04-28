import type { DateFormatOption, TimeFormatOption } from "./db";

/**
 * Format a date string (ISO "YYYY-MM-DD" or full ISO 8601) according to the
 * user's preferred date format.
 *
 * Returns the original value unchanged when parsing fails.
 */
export function formatDate(date: string, format: DateFormatOption = "YYYY-MM-DD"): string {
  // Extract the YYYY-MM-DD portion (handles both "2024-03-15" and "2024-03-15T10:00:00Z")
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return date;

  const [, year, month, day] = match;

  switch (format) {
    case "DD/MM/YYYY":
      return `${day}/${month}/${year}`;
    case "MM/DD/YYYY":
      return `${month}/${day}/${year}`;
    case "YYYY-MM-DD":
    default:
      return `${year}-${month}-${day}`;
  }
}

/**
 * Format a time string ("HH:mm" 24-hour) according to the user's preferred
 * time format.
 *
 * Returns the original value unchanged when parsing fails.
 */
export function formatTime(time: string, format: TimeFormatOption = "24h"): string {
  const match = time.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return time;

  const hours = parseInt(match[1], 10);
  const minutes = match[2];

  if (format === "12h") {
    const period = hours >= 12 ? "PM" : "AM";
    const h12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    return `${h12}:${minutes} ${period}`;
  }

  // 24h — normalise to two-digit hour
  return `${String(hours).padStart(2, "0")}:${minutes}`;
}
