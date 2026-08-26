import { TextField } from "@showme/design-system";
import { VENUE_AMENITIES, VENUE_DEAL_TYPES, amenityLabel, dealTypeLabel } from "@showme/shared";
import { VenueChipSelectField } from "./VenueChipSelectField";
import { VenueNotesField } from "./VenueNotesField";

/**
 * The editable venue facts. Mirrors `venue_details` one-for-one, minus the
 * columns nothing edits yet (`capacitySetups`).
 */
export interface VenueDetailsDraft {
  capacity: string;
  soundSystem: string;
  curfew: string;
  amenities: string[];
  dealTypes: string[];
  cateringNotes: string;
  accommodationNotes: string;
  artistLogisticsNotes: string;
  audienceLogisticsNotes: string;
  contactEmail: string;
  contactPhone: string;
}

export const EMPTY_VENUE_DETAILS: VenueDetailsDraft = {
  capacity: "",
  soundSystem: "",
  curfew: "",
  amenities: [],
  dealTypes: [],
  cateringNotes: "",
  accommodationNotes: "",
  artistLogisticsNotes: "",
  audienceLogisticsNotes: "",
  contactEmail: "",
  contactPhone: "",
};

export interface VenueDetailsFieldsProps {
  value: VenueDetailsDraft;
  onChange: (next: VenueDetailsDraft) => void;
}

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <h4
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 15,
          fontWeight: 600,
          color: "var(--text)",
          margin: 0,
        }}
      >
        {title}
      </h4>
      {children}
    </div>
  );
}

/**
 * What a promoter needs to know about a room, edited in one place.
 *
 * Presentational by design — it owns no fetching and no save. The screen holds
 * the draft and decides when to PATCH, which keeps this component testable and
 * lets the same fields be reused (a create wizard, a settings tab) later.
 *
 * The two logistics fields are deliberately separated and separately labelled.
 * `decisions.md` #16.7 splits artist logistics from audience logistics precisely
 * because one is private to booked parties and the other is published — so the
 * form has to make that visible, or a venue will type the door code into the box
 * that goes on the open internet.
 */
export function VenueDetailsFields({ value, onChange }: VenueDetailsFieldsProps) {
  const set = <Key extends keyof VenueDetailsDraft>(key: Key, next: VenueDetailsDraft[Key]) =>
    onChange({ ...value, [key]: next });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      <FieldGroup title="The room">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 14,
          }}
        >
          <TextField
            label="Capacity"
            type="number"
            min={0}
            inputMode="numeric"
            value={value.capacity}
            placeholder="e.g. 400"
            onChange={(event) => set("capacity", event.target.value)}
          />
          <TextField
            label="Sound system"
            value={value.soundSystem}
            placeholder="e.g. Funktion-One"
            onChange={(event) => set("soundSystem", event.target.value)}
          />
          <TextField
            label="Curfew"
            value={value.curfew}
            placeholder="e.g. 02:00"
            onChange={(event) => set("curfew", event.target.value)}
          />
        </div>
      </FieldGroup>

      <FieldGroup title="What you provide">
        <VenueChipSelectField
          label="Amenities"
          options={VENUE_AMENITIES}
          value={value.amenities}
          onChange={(next) => set("amenities", next)}
          toLabel={amenityLabel}
          addPlaceholder="Add your own, e.g. Green Room"
        />
        <VenueNotesField
          label="Catering notes"
          value={value.cateringNotes}
          placeholder="What you lay on, and what you don't"
          onChange={(next) => set("cateringNotes", next)}
        />
        <VenueNotesField
          label="Accommodation notes"
          value={value.accommodationNotes}
          placeholder="Rooms, nearby hotels, who books them"
          onChange={(next) => set("accommodationNotes", next)}
        />
      </FieldGroup>

      <FieldGroup title="Deals you'll sign">
        <VenueChipSelectField
          label="Deal types"
          options={VENUE_DEAL_TYPES}
          value={value.dealTypes}
          onChange={(next) => set("dealTypes", next)}
          toLabel={dealTypeLabel}
        />
      </FieldGroup>

      <FieldGroup title="Getting in">
        <VenueNotesField
          label="Artist logistics — private"
          value={value.artistLogisticsNotes}
          placeholder="Load-in, back entrance, artist parking, travel party size"
          hint="Only parties booked on an event see this. Never published."
          onChange={(next) => set("artistLogisticsNotes", next)}
        />
        <VenueNotesField
          label="Audience logistics — public"
          value={value.audienceLogisticsNotes}
          placeholder="Public entrance, parking, transit, accessibility"
          hint="Shown on your public profile page to anyone."
          onChange={(next) => set("audienceLogisticsNotes", next)}
        />
      </FieldGroup>

      <FieldGroup title="Booking contact — private">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 14,
          }}
        >
          <TextField
            label="Contact email"
            type="email"
            value={value.contactEmail}
            placeholder="booking@yourvenue.com"
            onChange={(event) => set("contactEmail", event.target.value)}
          />
          <TextField
            label="Contact phone"
            value={value.contactPhone}
            placeholder="+46 …"
            onChange={(event) => set("contactPhone", event.target.value)}
          />
        </div>
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--dim)" }}>
          Kept off your public page — an open page would hand these straight to scrapers.
        </p>
      </FieldGroup>
    </div>
  );
}
