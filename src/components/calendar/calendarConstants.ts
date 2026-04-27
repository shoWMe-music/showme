import { CheckSquare, Clock, StickyNote } from "lucide-react";
import React from "react";
import { EventStatus, CalendarItemType } from "@/lib/models";

// ── Color maps ──

export const EVENT_STATUS_COLORS: Record<EventStatus, string> = {
  draft: "bg-[hsl(var(--event-draft)/0.12)] text-[hsl(var(--event-draft))] border-[hsl(var(--event-draft)/0.3)]",
  suggested: "bg-[hsl(var(--event-suggested)/0.12)] text-[hsl(var(--event-suggested))] border-[hsl(var(--event-suggested)/0.3)]",
  pending: "bg-[hsl(var(--event-pending)/0.12)] text-[hsl(var(--event-pending))] border-[hsl(var(--event-pending)/0.3)]",
  confirmed: "bg-[hsl(var(--event-confirmed)/0.12)] text-[hsl(var(--event-confirmed))] border-[hsl(var(--event-confirmed)/0.3)]",
  on_hold: "bg-[hsl(var(--event-on-hold)/0.12)] text-[hsl(var(--event-on-hold))] border-[hsl(var(--event-on-hold)/0.3)]",
  concluded: "bg-[hsl(var(--event-concluded)/0.12)] text-[hsl(var(--event-concluded))] border-[hsl(var(--event-concluded)/0.3)]",
  cancelled: "bg-[hsl(var(--event-cancelled)/0.12)] text-[hsl(var(--event-cancelled))] border-[hsl(var(--event-cancelled)/0.3)]",
};

export const EVENT_STATUS_DOT: Record<EventStatus, string> = {
  draft: "bg-[hsl(var(--event-draft))]",
  suggested: "bg-[hsl(var(--event-suggested))]",
  pending: "bg-[hsl(var(--event-pending))]",
  confirmed: "bg-[hsl(var(--event-confirmed))]",
  on_hold: "bg-[hsl(var(--event-on-hold))]",
  concluded: "bg-[hsl(var(--event-concluded))]",
  cancelled: "bg-[hsl(var(--event-cancelled))]",
};

export const CALENDAR_ITEM_COLORS: Record<CalendarItemType, string> = {
  task: "bg-[hsl(var(--calendar-task)/0.12)] text-[hsl(var(--calendar-task))] border-[hsl(var(--calendar-task)/0.3)]",
  appointment: "bg-[hsl(var(--calendar-appointment)/0.12)] text-[hsl(var(--calendar-appointment))] border-[hsl(var(--calendar-appointment)/0.3)]",
  note: "bg-[hsl(var(--calendar-note)/0.12)] text-[hsl(var(--calendar-note))] border-[hsl(var(--calendar-note)/0.3)]",
};

export const CALENDAR_ITEM_DOT: Record<CalendarItemType, string> = {
  task: "bg-[hsl(var(--calendar-task))]",
  appointment: "bg-[hsl(var(--calendar-appointment))]",
  note: "bg-[hsl(var(--calendar-note))]",
};

export const CALENDAR_ITEM_ICONS: Record<CalendarItemType, React.ReactNode> = {
  task: React.createElement(CheckSquare, { className: "h-4 w-4" }),
  appointment: React.createElement(Clock, { className: "h-4 w-4" }),
  note: React.createElement(StickyNote, { className: "h-4 w-4" }),
};

// Calendar entity color palette
export const CALENDAR_ENTITY_COLORS = [
  "hsl(220, 70%, 55%)", // blue
  "hsl(340, 70%, 55%)", // pink
  "hsl(160, 60%, 45%)", // green
  "hsl(30, 80%, 55%)",  // orange
  "hsl(270, 60%, 55%)", // purple
  "hsl(190, 70%, 45%)", // teal
  "hsl(50, 80%, 50%)",  // yellow
  "hsl(0, 65%, 55%)",   // red
  "hsl(130, 50%, 50%)", // emerald
  "hsl(300, 50%, 55%)", // magenta
];

// ── Types ──

export type ViewMode = "month" | "week" | "day";
export type PopupItemType = { kind: "event"; data: import("@/lib/models").Event } | { kind: "calItem"; data: import("@/lib/models").CalendarItem };

export interface CalendarEntity {
  name: string;
  displayName?: string;
  type: "venue" | "artist" | "room" | "festival" | "promoter" | "organizer";
  color: string;
  parentVenue?: string;
}
