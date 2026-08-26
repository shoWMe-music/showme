/**
 * The venue vocabulary — what a room offers, and the deal shapes it will sign.
 *
 * Ported verbatim from the previous production app's `AmenityKey` enum
 * (`../showme-settle-fast/src/lib/models.ts:862`), which is the strongest
 * evidence available for what a real venue actually filled in. It is deliberately
 * NOT a database enum: venues also type their own ("Green Room", "Loading Dock",
 * "Wheelchair Accessible" were all free text in the old app's seed data), so the
 * stored value is a plain string array and this list is the *offered* set, not the
 * *allowed* set.
 *
 * THE KEY/LABEL RULE, and why it is written down: the old app stored the LABEL
 * from the profile editor but the KEY from the event editor
 * (`ProfileEditPage.tsx:820` vs `EventDetailsTab.tsx:1393`), so the same amenity
 * existed under two spellings and the event screen classified half of them as
 * "custom". We store the **key** everywhere and resolve the label at render time
 * via `amenityLabel`, which falls back to the raw string so a venue's own wording
 * still renders exactly as typed.
 */

export interface AmenityOption {
  /** Stable stored value — never shown to a user. */
  key: string;
  /** What a human reads. */
  label: string;
}

/** The ten standard amenities, in the order the old app's checkbox set used. */
export const VENUE_AMENITIES: readonly AmenityOption[] = [
  { key: "backline", label: "Full Backline" },
  { key: "partial_backline", label: "Partial Backline" },
  { key: "no_backline", label: "No Backline" },
  { key: "pa_system", label: "PA System" },
  { key: "sound_engineer", label: "Sound Engineer" },
  { key: "lighting", label: "Lighting" },
  { key: "light_engineer", label: "Light Engineer" },
  { key: "parking", label: "Parking" },
  { key: "accommodation", label: "Accommodation" },
  { key: "catering", label: "Catering" },
] as const;

const AMENITY_LABEL_BY_KEY = new Map(
  VENUE_AMENITIES.map((amenity) => [amenity.key, amenity.label]),
);

/**
 * Human label for a stored amenity value. An unknown value is a venue's own
 * custom entry — return it unchanged rather than hiding it or showing a key.
 */
export function amenityLabel(value: string): string {
  return AMENITY_LABEL_BY_KEY.get(value) ?? value;
}

/** True when the value is one of the ten standard amenities (not a custom one). */
export function isStandardAmenity(value: string): boolean {
  return AMENITY_LABEL_BY_KEY.has(value);
}

/**
 * The deal shapes a venue is willing to sign, shown on its profile so a promoter
 * knows before asking. Ported from `../showme-settle-fast/ProfileEditPage.tsx:704`.
 * These mirror the settlement engine's deal structures but are only a *preference*
 * advertised on the profile — the authoritative terms live on the deal itself.
 */
export const VENUE_DEAL_TYPES: readonly AmenityOption[] = [
  { key: "door_split", label: "Door Split" },
  { key: "guarantee_plus_door_split", label: "Guarantee + Door Split" },
  { key: "rental", label: "Rental" },
  { key: "guarantee", label: "Guarantee" },
] as const;

const DEAL_TYPE_LABEL_BY_KEY = new Map(
  VENUE_DEAL_TYPES.map((dealType) => [dealType.key, dealType.label]),
);

/** Human label for a stored deal-type value; unknown values pass through. */
export function dealTypeLabel(value: string): string {
  return DEAL_TYPE_LABEL_BY_KEY.get(value) ?? value;
}

/**
 * Which profile `type`s each account kind may create.
 *
 * The account **kind** is fixed at signup and is one per account (CLAUDE.md,
 * story.md) — it is never a choice on a profile form, it is inherited. What a
 * user does choose is the finer **type**, and the legal set depends on the kind:
 * an operator account makes venues and promoters, never bands.
 *
 * This is a *relation* between kind and type, which is exactly why
 * `profiles.type` is not a flat Postgres enum — a single enum would happily
 * accept `band` on an operator profile and enforce nothing that matters here.
 * The pairing is enforced in the API (`apps/api/src/routes/profiles.ts`) and
 * drives the picker in the app.
 *
 * Vocabulary source: `docs/story.md` § "The account kinds" — operator is
 * "a venue, promoter, organizer, or festival"; performer is "a band, DJ, or solo
 * artist"; team_and_crew is "sound, lighting, catering, security, stage". The
 * agent set comes from `docs/story.md` § Agent plus the seeded `agency` type.
 */
export const PROFILE_TYPES_BY_KIND: Record<string, readonly AmenityOption[]> = {
  operator: [
    { key: "venue", label: "Venue" },
    { key: "promoter", label: "Promoter" },
    { key: "organizer", label: "Event Organizer" },
    { key: "festival", label: "Festival" },
  ],
  performer: [
    { key: "band", label: "Band" },
    { key: "dj", label: "DJ" },
    { key: "solo_artist", label: "Solo Artist" },
  ],
  team_and_crew: [
    { key: "sound", label: "Sound" },
    { key: "lighting", label: "Lighting" },
    { key: "catering", label: "Catering" },
    { key: "security", label: "Security" },
    { key: "stage", label: "Stage" },
    { key: "crew", label: "General Crew" },
  ],
  agent: [
    { key: "agency", label: "Booking Agency" },
    { key: "independent_agent", label: "Independent Agent" },
  ],
};

/** The types an account of this kind may give a profile; unknown kind → empty. */
export function profileTypesForKind(kind: string): readonly AmenityOption[] {
  return PROFILE_TYPES_BY_KIND[kind] ?? [];
}

/**
 * Whether `type` is legal for `kind`. A null/absent type is always allowed — a
 * profile may be untyped, and every profile created before this vocabulary
 * existed is (`type` has been free text since 0000).
 */
export function isProfileTypeForKind(kind: string, type: string | null | undefined): boolean {
  if (type === null || type === undefined || type === "") return true;
  return profileTypesForKind(kind).some((option) => option.key === type);
}

/**
 * Only a place has a capacity, a load-in and a green room. A promoter or booking
 * agency is an organisation, not a room, so the venue-details editor and the
 * event prefill are offered for these types alone.
 */
export const PLACE_PROFILE_TYPES: readonly string[] = ["venue", "festival"];

/**
 * True when this profile is a physical place that can hold venue details. An
 * operator who has not chosen a type yet counts — hiding the editor from someone
 * mid-setup is worse than offering it to a promoter who will ignore it.
 */
export function isPlaceProfile(kind: string, type: string | null | undefined): boolean {
  if (kind !== "operator") return false;
  if (!type) return true;
  return PLACE_PROFILE_TYPES.includes(type);
}
