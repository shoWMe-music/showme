/**
 * Date and time formatting utilities that respect user preferences.
 *
 * Usage:
 *   import { formatDate, formatTime } from "@/lib/dateFormat";
 *   formatDate("2026-04-29", "DD/MM/YYYY")  // "29/04/2026"
 *   formatTime("14:30", "12h")              // "2:30 PM"
 */

export type DateFormat = "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
export type TimeFormat = "24h" | "12h";

/**
 * Format a date string (YYYY-MM-DD) according to the given format preference.
 */
export function formatDate(dateStr: string, format: DateFormat = "DD/MM/YYYY"): string {
  if (!dateStr) return "";
  // Parse YYYY-MM-DD
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr; // can't parse, return as-is
  const [year, month, day] = parts;
  switch (format) {
    case "DD/MM/YYYY": return `${day}/${month}/${year}`;
    case "MM/DD/YYYY": return `${month}/${day}/${year}`;
    case "YYYY-MM-DD": return dateStr;
    default: return dateStr;
  }
}

/**
 * Format a time string (HH:MM or HH:MM:SS) according to the given format preference.
 */
export function formatTime(timeStr: string, format: TimeFormat = "24h"): string {
  if (!timeStr) return "";
  const parts = timeStr.split(":");
  if (parts.length < 2) return timeStr;
  const hour = parseInt(parts[0], 10);
  const minute = parts[1];
  if (format === "24h") return `${String(hour).padStart(2, "0")}:${minute}`;
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${minute} ${period}`;
}
