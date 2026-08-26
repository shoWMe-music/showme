import { Card, Icon } from "@showme/design-system";
import type { CalendarInventoryGroup } from "../lib/calendarInventory";
import { Eyebrow } from "./primitives";

/**
 * MY CALENDARS — the venues you run, the rooms inside them, and what is booked.
 *
 * It used to be three checkboxes labelled "Promoter events / Performer shows /
 * Venue bookings", copied verbatim from the design prototype. Two things were
 * wrong with them. They were not calendars: they name the acting profile's ROLE
 * on an event, and a role is not a thing that can be double-booked. And they
 * filtered nothing — the state they wrote was never read anywhere, so ticking one
 * changed the screen not at all.
 *
 * This is the honest replacement: the calendars that actually exist, with the
 * shows each is holding in the period on screen. It is READ-ONLY on purpose — the
 * "Rooms" chip in the filter row is the filter, and one control that works beats
 * two that half do.
 */

export interface MyCalendarsCardProps {
  groups: CalendarInventoryGroup[];
  /** The period the counts are for, e.g. "September 2026". */
  periodTitle: string;
  onManageRooms: () => void;
}

function CalendarRow({ label, count, muted }: { label: string; count: number; muted?: boolean }) {
  return (
    <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 12.5,
          color: muted ? "var(--muted)" : "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 12, color: "var(--dim)", fontFamily: "var(--font-mono)" }}>
        {count}
      </span>
    </span>
  );
}

export function MyCalendarsCard({ groups, periodTitle, onManageRooms }: MyCalendarsCardProps) {
  return (
    <Card padding="md" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Eyebrow>My calendars</Eyebrow>
      {groups.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>No profiles yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {groups.map((group) => (
            <div key={group.profileId} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {group.heading && (
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>
                  {group.heading}
                </span>
              )}
              {group.rows.map((row) => (
                <span key={row.key} style={{ paddingLeft: group.heading ? 10 : 0 }}>
                  <CalendarRow label={row.label} count={row.count} muted={Boolean(group.heading)} />
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
      <p style={{ margin: 0, fontSize: 11.5, color: "var(--dim)" }}>
        Shows in {periodTitle}. A venue's rooms are separate calendars — two rooms can hold two
        shows on the same night.
      </p>
      <button
        type="button"
        onClick={onManageRooms}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          color: "#EE5746",
          fontWeight: 500,
        }}
      >
        <Icon name="plus" size={12} />
        Manage rooms
      </button>
    </Card>
  );
}
