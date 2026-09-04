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
  /**
   * Does this reader have anywhere with rooms in it?
   *
   * Everything below about rooms — the sentence explaining that they are separate
   * calendars, and the link to manage them — is VENUE furniture, and it used to
   * render for everybody. A performer opening their calendar was told "a venue's
   * rooms are separate calendars — two rooms can hold two shows on the same
   * night" and offered "+ Manage rooms", for a building they do not have
   * (ClickUp 86cbcgw46). It reads as the app mistaking them for a venue, which
   * is exactly what it was doing.
   *
   * `some`, not `every`: an operator who also performs has both kinds of profile,
   * and the rooms half is still true and useful for the venue among them.
   */
  const hasVenue = groups.some((group) => group.isVenue);

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
        Shows in {periodTitle}.
        {hasVenue
          ? " A venue's rooms are separate calendars — two rooms can hold two shows on the same night."
          : ""}
      </p>
      {hasVenue && (
        <button
          type="button"
          onClick={onManageRooms}
          // Touch: 324x19. The overlay rather than growth — this is the last line
          // of a card, and a 44px-tall link would put 25px of dead space between
          // it and the paragraph it follows. Nothing else in the card is
          // interactive, so the halo cannot steal anyone's tap.
          className="touch-target-overlay"
          style={{
            all: "unset",
            // `all: unset` is an inline declaration, so it beats the utility's
            // own `position: relative` and would leave the ::after positioning
            // against some ancestor instead of this button. Restoring it here is
            // what keeps the halo centred on the link. (The pseudo-element itself
            // is untouched by `all`.)
            position: "relative",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "var(--brand-red)",
            fontWeight: 500,
          }}
        >
          <Icon name="plus" size={12} />
          Manage rooms
        </button>
      )}
    </Card>
  );
}
