import { Button, Icon, TextField } from "@showme/design-system";
import { useState } from "react";
import { CardHeader, RemovableChip, SectionCard } from "./eventUi";
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
 * The card itself is unchanged from the one that was on Event Details, down to
 * the duplicate-guard, because it worked; only its home and its title moved. It
 * owns its own `useEventExtrasEditor` rather than being handed one, so the Deals
 * tab does not have to thread extras state it otherwise has no use for.
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

export function EventHospitalityCard({ event, canEdit }: EventHospitalityCardProps) {
  const extrasEditor = useEventExtrasEditor(event);
  const extras = extrasEditor.extras;
  const amenities = extras.amenities ?? [];
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
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {amenities.length === 0 && (
          <div style={{ color: "var(--dim)", fontSize: 13 }}>Nothing recorded yet.</div>
        )}
        {amenities.map((amenity, index) => (
          <RemovableChip
            key={amenity}
            label={amenity}
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
    </SectionCard>
  );
}
