import { Button, Icon, TextField } from "@showme/design-system";
import { amenityLabel } from "@showme/shared";
import { useState } from "react";
import { VenueNotesField } from "./VenueNotesField";
import { CardHeader, Eyebrow, OutlineButton, RemovableChip, SectionCard } from "./eventUi";
import { useEventExtrasEditor } from "./useEventExtrasEditor";

/**
 * ACCOMMODATION & AMENITIES — what the venue provides the people working the show.
 *
 * It lived on Event Details until the 2026-08 settlements meeting moved it: the
 * Deals tab is to cover *"financial agreements, accommodations and amenities"*
 * (01:53:36–01:59:41) while *"Event Details keeps general information"*. That is
 * the right cut on the merits too — what a party is given is part of what was
 * agreed with them, not a fact about the event.
 *
 * It owns its own `useEventExtrasEditor` rather than being handed one, so the
 * Deals tab does not have to thread extras state it otherwise has no use for.
 *
 * WHAT THE VENUE LENT, AND WHY IT IS SHOWN AS SUCH (ClickUp 86cbaxvku). Placing
 * a show at a venue profile COPIES what that room has already written down about
 * itself — amenities, its PA, its catering, its rooms, its load-in — onto the
 * event (`apps/api/src/routes/events.ts`, "Venue-profile prefill"). It is a copy
 * and never a live view: an agreement freezes at confirmation, so a venue that
 * sells its PA in March must not rewrite what it promised in January.
 *
 * That is exactly why the receipt at the top of this card is not decoration. A
 * value that appeared on its own and cannot be explained is worse than a blank
 * field, so the card says which room these came from, when, and offers to take
 * them back off. Everything below is an ordinary editable field afterwards —
 * the venue's wording is a starting point, not a term.
 *
 * Note on scope: `docs/decisions.md` #16.7 specifies accommodation as a RECORD —
 * type, date range, location, notes — that also lands on every relevant party's
 * calendar. That does not exist yet, here or anywhere, and is deliberately not
 * stubbed: a card of dead fields would claim the feature is built.
 */
export interface EventHospitalityCardProps {
  event: { id: string; version: number; extras?: Record<string, unknown> | null };
  canEdit: boolean;
}

/** What the venue wrote, and the words this card puts on each one. */
const VENUE_NOTES = [
  {
    leaf: "soundSystem",
    label: "House sound system",
    placeholder: "e.g. d&b audiotechnik V-Series",
    rows: 2,
  },
  {
    leaf: "cateringNotes",
    label: "Catering",
    placeholder: "What the room feeds the touring party, and when.",
    rows: 3,
  },
  {
    leaf: "accommodationNotes",
    label: "Accommodation",
    placeholder: "Rooms held, where, for how many.",
    rows: 3,
  },
  {
    leaf: "artistLogisticsNotes",
    label: "Artist logistics",
    placeholder: "Load-in, back entrance, artist parking, travel party.",
    rows: 3,
  },
] as const;

/** The `extras` leaves this card is responsible for — what its Remove clears. */
const CARD_LEAVES: readonly string[] = ["amenities", ...VENUE_NOTES.map((note) => note.leaf)];

interface VenueCarryOver {
  profileId: string;
  venueName: string;
  copiedAt: string;
  fields: string[];
}

export function EventHospitalityCard({ event, canEdit }: EventHospitalityCardProps) {
  const extrasEditor = useEventExtrasEditor(event);
  const extras = extrasEditor.extras;
  const amenities = extras.amenities ?? [];
  const carryOver = extras.venueCarryOver as VenueCarryOver | undefined;
  const [draft, setDraft] = useState("");

  const save = (next: string[]) => extrasEditor.save({ ...extras, amenities: next });

  const add = () => {
    const value = draft.trim();
    if (!value) return;
    // Adding the same amenity twice would collide on the render key and say
    // nothing new — treat it as already added.
    if (amenities.includes(value)) {
      setDraft("");
      return;
    }
    save([...amenities, value]);
    setDraft("");
  };

  /**
   * Take back everything this card got from the venue, and nothing else.
   *
   * The receipt also names fields that live on the event ROW (its name, its
   * capacity, its curfew), which this card does not draw and must not silently
   * clear — so it is narrowed rather than dropped, and survives to keep
   * explaining those.
   */
  const removeVenueCopy = () => {
    if (!carryOver) return;
    const next = { ...extras };
    for (const leaf of CARD_LEAVES) {
      if (carryOver.fields.includes(leaf)) delete next[leaf];
    }
    const remaining = carryOver.fields.filter((field) => !CARD_LEAVES.includes(field));
    next.venueCarryOver = remaining.length > 0 ? { ...carryOver, fields: remaining } : undefined;
    extrasEditor.save(next);
  };

  const carriedHere = carryOver?.fields.filter((field) => CARD_LEAVES.includes(field)) ?? [];

  return (
    <SectionCard>
      <CardHeader
        icon={<Icon name="star" size={17} />}
        iconColor="#6FC97A"
        title="Accommodation & amenities"
      />
      <div style={{ color: "var(--muted)", fontSize: 12.5, marginBottom: 12 }}>
        What the room provides the parties on this event — rooms, parking, catering, backline.
      </div>

      {carriedHere.length > 0 && (
        <VenueCopyReceipt
          venueName={carryOver?.venueName ?? ""}
          copiedAt={carryOver?.copiedAt ?? ""}
          onRemove={canEdit ? removeVenueCopy : undefined}
        />
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {amenities.length === 0 && (
          <div style={{ color: "var(--dim)", fontSize: 13 }}>Nothing recorded yet.</div>
        )}
        {amenities.map((amenity, index) => (
          <RemovableChip
            key={amenity}
            // The stored value is the stable KEY (`pa_system`); the label is
            // resolved at render, and a venue's own free-text entry falls
            // through unchanged — `@showme/shared/venue` owns that rule.
            label={amenityLabel(amenity)}
            onRemove={
              canEdit
                ? () => save(amenities.filter((_, position) => position !== index))
                : undefined
            }
          />
        ))}
      </div>
      {canEdit && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <TextField
              aria-label="New amenity"
              value={draft}
              onChange={(changeEvent) => setDraft(changeEvent.target.value)}
              onKeyDown={(keyEvent) => keyEvent.key === "Enter" && add()}
              placeholder="Add accommodation or amenity…"
            />
          </div>
          <Button
            variant="secondary"
            aria-label="Add amenity"
            onClick={add}
            disabled={draft.trim() === ""}
          >
            + Add
          </Button>
        </div>
      )}

      {/* The prose the venue writes once and every show used to retype. Read-only
          for a party who cannot edit the event — the words still matter to them.
          `onBlur` sits on the wrapper rather than on each field: React's blur is
          a bubbling focusout, so one commit here saves the field the operator
          just left without a write per keystroke (`useEventExtrasEditor`). */}
      <div
        style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 22 }}
        onBlur={extrasEditor.commit}
      >
        <Eyebrow>The room</Eyebrow>
        {VENUE_NOTES.map((note) => {
          const value = (extras[note.leaf] as string | null | undefined) ?? "";
          if (!canEdit) {
            return value.trim() === "" ? null : (
              <div key={note.leaf}>
                <Eyebrow>{note.label}</Eyebrow>
                <p
                  style={{
                    margin: "6px 0 0",
                    fontSize: 13.5,
                    lineHeight: 1.55,
                    color: "var(--text)",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {value}
                </p>
              </div>
            );
          }
          return (
            <VenueNotesField
              key={note.leaf}
              label={note.label}
              value={value}
              rows={note.rows}
              placeholder={note.placeholder}
              onChange={(next) => extrasEditor.change({ ...extras, [note.leaf]: next })}
            />
          );
        })}
      </div>
    </SectionCard>
  );
}

/**
 * The receipt for a copy — which room lent these, and when.
 *
 * It is deliberately worded as history rather than as a link. Saying "from The
 * Lantern Hall's profile" invites the reader to believe the two stay in step;
 * saying it was copied on a date says the opposite, which is the truth and the
 * whole point of the rule.
 */
function VenueCopyReceipt({
  venueName,
  copiedAt,
  onRemove,
}: {
  venueName: string;
  copiedAt: string;
  onRemove?: () => void;
}) {
  const copiedOn = copiedAt ? new Date(copiedAt).toLocaleDateString() : "";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        padding: "10px 14px",
        marginBottom: 14,
        borderRadius: 11,
        border: "1px solid var(--border)",
        background: "var(--elevated)",
      }}
    >
      <Icon name="building" size={15} />
      <span style={{ flex: 1, minWidth: 180, fontSize: 12.5, color: "var(--muted)" }}>
        Copied from {venueName || "the venue"}
        {copiedOn ? ` on ${copiedOn}` : ""}. These are this show&rsquo;s own values now — a later
        change to the venue&rsquo;s profile will not rewrite them.
      </span>
      {onRemove && <OutlineButton onClick={onRemove}>Remove these</OutlineButton>}
    </div>
  );
}
