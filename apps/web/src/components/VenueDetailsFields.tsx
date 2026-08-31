import { TextField } from "@showme/design-system";
import { VENUE_AMENITIES, VENUE_DEAL_TYPES, amenityLabel, dealTypeLabel } from "@showme/shared";
import { AUDIENCE_ORDER, AudienceSection, type FieldAudience } from "./FieldAudience";
import { VenueChipSelectField } from "./VenueChipSelectField";
import { VenueNotesField } from "./VenueNotesField";

/**
 * The editable venue facts. Mirrors `venue_details`, minus `capacity` — that is
 * entered on a ROOM now (`ProfileRoomsCard`), and the column is a derived mirror
 * of the venue's largest one. It was here as well, and in the capacity-setups
 * list, and on every room: three boxes for one number on one screen.
 */
export interface VenueDetailsDraft {
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

type VenueFieldName = keyof VenueDetailsDraft;

/**
 * WHO SEES EACH FIELD, and how wide it sits. This table is the form's spine:
 * the sections below are GENERATED from it, so a field cannot be rendered
 * anywhere except under the audience declared here.
 *
 * `satisfies Record<VenueFieldName, …>` is the part that resists drift. Add a
 * field to `VenueDetailsDraft` and this object stops compiling until you have
 * said who reads it — there is no "forgot the label" path, because there is no
 * label to forget. Declaration order is display order within a section.
 *
 * The tiers were decided 2026-08-31. Note that amenities, deal types, catering
 * and accommodation notes MOVED here from the open web; `serialize/profile.ts`
 * is the half that enforces it.
 */
const VENUE_FIELDS = {
  soundSystem: { audience: "public", span: "half" },
  curfew: { audience: "public", span: "half" },
  audienceLogisticsNotes: { audience: "public", span: "full" },
  amenities: { audience: "industry", span: "full" },
  dealTypes: { audience: "industry", span: "full" },
  cateringNotes: { audience: "industry", span: "full" },
  accommodationNotes: { audience: "industry", span: "full" },
  artistLogisticsNotes: { audience: "private", span: "full" },
  contactEmail: { audience: "private", span: "half" },
  contactPhone: { audience: "private", span: "half" },
} as const satisfies Record<VenueFieldName, { audience: FieldAudience; span: "half" | "full" }>;

const FIELD_NAMES = Object.keys(VENUE_FIELDS) as VenueFieldName[];

export interface VenueDetailsFieldsProps {
  value: VenueDetailsDraft;
  onChange: (next: VenueDetailsDraft) => void;
  /**
   * The street address, rendered FIRST inside the public section.
   *
   * It is a slot rather than a field here because the address lives in
   * `profile_locations`, not `venue_details` — a different table, a different
   * PATCH field, and the screen owns it. What it must not be is a lone control
   * further up the form under no heading at all: a doorstep is published, and
   * the only place that says so is a group that names its audience.
   */
  addressField?: React.ReactNode;
}

/**
 * What a promoter needs to know about a room, edited in one place — grouped by
 * WHO WILL READ IT, never by topic.
 *
 * Presentational by design: it owns no fetching and no save. The screen holds
 * the draft and decides when to PATCH, which keeps this component testable and
 * lets the same fields be reused (a create wizard, a settings tab) later.
 *
 * The privacy split is not decoration. `decisions.md` #16.7 separates artist
 * logistics from audience logistics precisely because one is private to booked
 * parties and the other is published — so the form has to make that visible, or
 * a venue types the door code into the box that goes on the open internet.
 */
export function VenueDetailsFields({ value, onChange, addressField }: VenueDetailsFieldsProps) {
  const set = <Key extends VenueFieldName>(key: Key, next: VenueDetailsDraft[Key]) =>
    onChange({ ...value, [key]: next });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
      {AUDIENCE_ORDER.map((audience) => (
        <AudienceSection key={audience} audience={audience}>
          {/* One responsive grid per section: paired short fields sit side by
              side above ~460px and stack below it, and prose spans the row.
              `auto-fit` + `minmax` rather than a media query, because the form
              lives in a card whose width is not the viewport's. */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 14,
            }}
          >
            {audience === "public" && addressField && (
              <div style={{ gridColumn: "1 / -1", minWidth: 0 }}>{addressField}</div>
            )}
            {FIELD_NAMES.filter((name) => VENUE_FIELDS[name].audience === audience).map((name) => (
              <div
                key={name}
                style={{
                  gridColumn: VENUE_FIELDS[name].span === "full" ? "1 / -1" : undefined,
                  minWidth: 0,
                }}
              >
                <VenueField name={name} value={value} onSet={set} />
              </div>
            ))}
          </div>
        </AudienceSection>
      ))}
    </div>
  );
}

/**
 * One field, chosen by name. Exhaustive on purpose: the `never` fallthrough
 * means a new key in `VenueDetailsDraft` fails to compile here as well as in
 * `VENUE_FIELDS`, so a field cannot exist in the draft, be saved by the screen,
 * and quietly never appear on the form.
 */
function VenueField({
  name,
  value,
  onSet,
}: {
  name: VenueFieldName;
  value: VenueDetailsDraft;
  onSet: <Key extends VenueFieldName>(key: Key, next: VenueDetailsDraft[Key]) => void;
}) {
  switch (name) {
    case "soundSystem":
      return (
        <TextField
          label="Sound system"
          value={value.soundSystem}
          placeholder="e.g. Funktion-One"
          onChange={(event) => onSet("soundSystem", event.target.value)}
        />
      );
    case "curfew":
      return (
        <TextField
          label="Curfew"
          value={value.curfew}
          placeholder="e.g. 02:00"
          onChange={(event) => onSet("curfew", event.target.value)}
        />
      );
    case "audienceLogisticsNotes":
      return (
        <VenueNotesField
          label="Audience logistics"
          value={value.audienceLogisticsNotes}
          placeholder="Public entrance, parking, transit, accessibility"
          onChange={(next) => onSet("audienceLogisticsNotes", next)}
        />
      );
    case "amenities":
      return (
        <VenueChipSelectField
          label="Amenities"
          options={VENUE_AMENITIES}
          value={value.amenities}
          onChange={(next) => onSet("amenities", next)}
          toLabel={amenityLabel}
          addPlaceholder="Add your own, e.g. Green Room"
        />
      );
    case "dealTypes":
      return (
        <VenueChipSelectField
          label="Deals you'll sign"
          options={VENUE_DEAL_TYPES}
          value={value.dealTypes}
          onChange={(next) => onSet("dealTypes", next)}
          toLabel={dealTypeLabel}
        />
      );
    case "cateringNotes":
      return (
        <VenueNotesField
          label="Catering notes"
          value={value.cateringNotes}
          placeholder="What you lay on, and what you don't"
          onChange={(next) => onSet("cateringNotes", next)}
        />
      );
    case "accommodationNotes":
      return (
        <VenueNotesField
          label="Accommodation notes"
          value={value.accommodationNotes}
          placeholder="Rooms, nearby hotels, who books them"
          onChange={(next) => onSet("accommodationNotes", next)}
        />
      );
    case "artistLogisticsNotes":
      return (
        <VenueNotesField
          label="Artist logistics"
          value={value.artistLogisticsNotes}
          placeholder="Load-in, back entrance, artist parking, travel party size"
          onChange={(next) => onSet("artistLogisticsNotes", next)}
        />
      );
    case "contactEmail":
      return (
        <TextField
          label="Booking contact email"
          type="email"
          value={value.contactEmail}
          placeholder="booking@yourvenue.com"
          onChange={(event) => onSet("contactEmail", event.target.value)}
        />
      );
    case "contactPhone":
      return (
        <TextField
          label="Booking contact phone"
          value={value.contactPhone}
          placeholder="+46 …"
          onChange={(event) => onSet("contactPhone", event.target.value)}
        />
      );
    default: {
      const unhandled: never = name;
      return unhandled;
    }
  }
}
