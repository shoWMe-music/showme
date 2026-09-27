import { Button, Checkbox, Icon, Input, Modal, Select } from "@showme/design-system";
import type { ReactNode } from "react";
import type { CalendarChoice } from "../lib/calendarChoice";
import { DateTimeField } from "./DateTimeField";
import { Eyebrow } from "./primitives";

/** The Check & Share Availability modal (§2, shot 02). Presentational shell over
 * the DS `Modal`: every field is controlled and the computed available dates +
 * share link are supplied by the screen. */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Sentence-case field label (Calendar / From / To) — the design uses these for
 * inputs, and reserves the uppercase `Eyebrow` for section headers. */
function FieldLabel({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{children}</span>;
}

export interface AvailabilityShareModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * VENUE, THEN ROOM — the two selects, and what each may offer (`lib/calendarChoice.ts`).
   *
   * It used to be ONE select carrying both, venue names as disabled headings with rooms
   * indented under them. Everything was reachable and nothing was operable: an indent is
   * not a hierarchy you can use.
   *
   * (Before that it was three strings — "Promoter events / Performer shows / Venue
   * bookings" — which named the acting profile's role rather than any calendar at all. A
   * calendar is a thing that can be double-booked, which for a venue is a room: two rooms
   * hold two shows on the same Friday, so "are you free on the 12th?" is answered per
   * room.)
   */
  choice: CalendarChoice;
  /** The chosen calendar — `CalendarSource.value`, which BOTH selects write. */
  calendar: string;
  /** "The Nest · Basement": what the dates below are actually about. */
  calendarLabel?: string;
  onCalendarChange?: (calendar: string) => void;
  from: string;
  to: string;
  onFromChange?: (value: string) => void;
  onToChange?: (value: string) => void;
  showConfirmed: boolean;
  onShowConfirmedChange?: (next: boolean) => void;
  showHeld: boolean;
  onShowHeldChange?: (next: boolean) => void;
  /** Selected weekday indices, Monday = 0 … Sunday = 6. */
  selectedWeekdays: number[];
  onToggleWeekday?: (index: number) => void;
  /** Pre-formatted available-date labels, e.g. "Fri, 11 Jul 2026". */
  availableDates: string[];
  onCopyDates?: () => void;
  shareLink: string;
  /** True while the link is being minted (ClickUp `123qy9rpqn0`). */
  isCreatingLink?: boolean;
  onCopyLink?: () => void;
  helperText?: string;
}

export function AvailabilityShareModal({
  open,
  onClose,
  choice,
  calendar,
  calendarLabel,
  onCalendarChange,
  from,
  to,
  onFromChange,
  onToChange,
  showConfirmed,
  onShowConfirmedChange,
  showHeld,
  onShowHeldChange,
  selectedWeekdays,
  onToggleWeekday,
  availableDates,
  onCopyDates,
  shareLink,
  isCreatingLink = false,
  onCopyLink,
  helperText = "Availabilities may change. This link reflects availability as of when it was generated.",
}: AvailabilityShareModalProps) {
  const selected = new Set(selectedWeekdays);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Check & Share Availability"
      width={560}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {/* Venue, then room — the same two-step the calendar's own filter uses, and both
            halves write the ONE `calendar` value: a venue row means "this venue, all
            rooms". There is no "All venues" row, because this names the subject of the
            share rather than narrowing a view. */}
        <div
          style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <FieldLabel>Calendar</FieldLabel>
            <Select
              value={choice.calendarValue}
              onChange={(value) => onCalendarChange?.(value)}
              options={choice.calendarOptions}
              aria-label="Calendar"
              placeholder="No calendars yet"
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <FieldLabel>Room / stage</FieldLabel>
            {/* Disabled says WHY: a performer has one schedule, a venue may have no rooms
                recorded, and a venue with exactly one room is named rather than offered —
                "All rooms" and "Main Room" are the same set of nights. */}
            <Select
              value={calendar}
              onChange={(value) => onCalendarChange?.(value)}
              options={choice.roomOptions}
              disabled={choice.roomsDisabled}
              aria-label="Room or stage"
              placeholder={choice.roomPlaceholder}
            />
          </div>
        </div>

        {/* `minmax(0, 1fr)`, not `1fr`: a bare `1fr` is `minmax(auto, 1fr)` and a
            date input's min-content is its intrinsic size, which is a floor the
            field's own `width: 100%` cannot lower. */}
        <div
          style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <FieldLabel>From</FieldLabel>
            <DateTimeField
              type="date"
              aria-label="From"
              value={from}
              onChange={(event) => onFromChange?.(event.target.value)}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <FieldLabel>To</FieldLabel>
            <DateTimeField
              type="date"
              aria-label="To"
              value={to}
              onChange={(event) => onToChange?.(event.target.value)}
            />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Eyebrow>Show as unavailable</Eyebrow>
          <Checkbox
            checked={showConfirmed}
            onChange={onShowConfirmedChange}
            tone="brand"
            // "Booked", not "Confirmed": since 86cbceux0 this hides every night
            // an act has ACCEPTED, signed or not. A box labelled "Confirmed
            // events" that also hides pending ones is a control lying about what
            // it does, on the screen where the cost of being wrong is a promoter
            // being offered a night that is gone.
            label="Booked dates"
          />
          <Checkbox
            checked={showHeld}
            onChange={onShowHeldChange}
            tone="brand"
            label="Dates on hold"
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Eyebrow>Days of the week</Eyebrow>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {WEEKDAYS.map((day, index) => {
              const active = selected.has(index);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onToggleWeekday?.(index)}
                  // Touch: 28px tall, seven of them 6px apart in a wrapping row
                  // — a 44px halo would reach 8px into the neighbouring day and
                  // block Saturday when the reader meant Friday. They grow: the
                  // row is a `flex-wrap` strip with nothing under it, so the
                  // extra height simply pushes the section below down.
                  className="touch-target"
                  style={{
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: active ? "none" : "1px solid var(--border)",
                    background: active ? "var(--brand-red)" : "transparent",
                    color: active ? "#fff" : "var(--muted)",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Named, not just "Available dates": with a room picker above it, a
              bare heading leaves the reader to remember which room these are. */}
          <Eyebrow>
            {calendarLabel ? `Available dates — ${calendarLabel}` : "Available dates in range"}
          </Eyebrow>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              padding: 12,
              borderRadius: 12,
              background: "var(--card)",
              border: "1px solid var(--border)",
            }}
          >
            {availableDates.length === 0 ? (
              <span style={{ color: "var(--muted)", fontSize: 13 }}>
                No available dates in range.
              </span>
            ) : (
              availableDates.map((date) => (
                <span
                  key={date}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 999,
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "var(--text)",
                  }}
                >
                  {date}
                </span>
              ))
            )}
          </div>
          {onCopyDates && (
            <button
              type="button"
              onClick={onCopyDates}
              // Touch: 85x16, alone at the end of the date list with the panel's
              // own padding under it — the clear space an overlay needs, and
              // growing it would put 28px of nothing between the dates and the
              // action that copies them.
              className="touch-target-overlay"
              style={{
                alignSelf: "flex-end",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                border: "none",
                background: "transparent",
                color: "var(--brand-red)",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                padding: 0,
              }}
            >
              <Icon name="copy" size={14} />
              Copy dates
            </button>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Eyebrow>Shareable link</Eyebrow>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {/* `minWidth: 0` is the whole fix, and it is not decoration. A flex
                item defaults to `min-width: auto`, so this box could not shrink
                below the INPUT's min-content — the browser's own `size="20"`
                intrinsic width, measured in whatever font actually rendered —
                and the "Copy" button beside it was pushed out of a panel that
                clips. Measured at 360px with the self-hosted woff2 blocked so
                the fallback face renders: 336px of content in a 334px panel,
                against 379-in-334 on Ubuntu CI. `flex: 1` alone left the floor
                in place; `minWidth: 0` removes it, so the row fits at any font
                width rather than fitting this machine's. */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* EMPTY UNTIL THE LINK EXISTS (ClickUp `123qy9rpqn0`). A link is a token
                  now, minted by the API when the operator asks for one — so before that
                  there is genuinely nothing to show, and the placeholder says which press
                  produces it rather than leaving an unexplained empty field. It empties
                  again the moment the form describes something else, because the token
                  would then point at a snapshot that is no longer on screen. */}
              <Input
                value={shareLink}
                readOnly
                placeholder="Create a link to share these dates"
                aria-label="Shareable link"
                leftIcon={<Icon name="link" size={14} />}
              />
            </div>
            {onCopyLink && (
              <Button
                variant="secondary"
                leftIcon={<Icon name={shareLink ? "copy" : "link"} size={14} />}
                onClick={onCopyLink}
                disabled={isCreatingLink}
              >
                {isCreatingLink ? "Creating…" : shareLink ? "Copy" : "Create link"}
              </Button>
            )}
          </div>
          <span style={{ color: "var(--muted)", fontSize: 12 }}>{helperText}</span>
        </div>
      </div>
    </Modal>
  );
}
