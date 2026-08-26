import type { ProfileRole } from "@showme/auth";
import type { schema } from "@showme/db";

type ProfileRow = typeof schema.profiles.$inferSelect;
type ProfileLocationRow = typeof schema.profileLocations.$inferSelect;
type VenueDetailsRow = typeof schema.venueDetails.$inferSelect;

/**
 * Where the profile is. Read from `profile_locations`, which is the one place
 * that holds it — event timezones, agent territory, deal authority and profile
 * search all join this table, so anything else claiming to be "the location" is
 * by definition a second copy that will drift. It used to: the editor wrote a
 * string to `details.location` while the seed wrote a `profile_locations` row,
 * and the screen read the string, so a venue with a location showed none.
 */
export interface SerializedProfileLocation {
  city: string | null;
  country: string | null;
}

/**
 * The venue-specific facts (capacity, PA, curfew, amenities, logistics). Present
 * only for a profile that has a `venue_details` row.
 *
 * NOTE the two logistics fields and the contact pair: these are the private half
 * of the profile. This shape is for AUTHENTICATED members of the profile, who are
 * the venue's own team and may see all of it. The unauthenticated public page
 * gets a different, much smaller projection (`serialize/public.ts`) — never this
 * one.
 */
export interface SerializedVenueDetails {
  capacity: number | null;
  soundSystem: string | null;
  curfew: string | null;
  amenities: string[];
  dealTypes: string[];
  cateringNotes: string | null;
  accommodationNotes: string | null;
  artistLogisticsNotes: string | null;
  audienceLogisticsNotes: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

export interface SerializedProfile {
  id: string;
  kind: string;
  type: string | null;
  ownerUserId: string;
  name: string;
  slug: string;
  isPublic: boolean;
  bio: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  details: unknown;
  /** Primary location, or null when the profile has no location row. */
  location?: SerializedProfileLocation | null;
  /** Venue facts, or null when this profile has none recorded. */
  venueDetails?: SerializedVenueDetails | null;
  /** Legal/tax/invoicing identity — owner/admin only. */
  billing?: unknown;
  createdAt: string;
  updatedAt: string;
}

/** The joined rows a full profile projection needs beyond the profile itself. */
export interface ProfileRelations {
  location?: ProfileLocationRow | null;
  venueDetails?: VenueDetailsRow | null;
}

/** Roles that may see the profile's private billing identity. */
const BILLING_ROLES: ProfileRole[] = ["owner", "admin"];

function serializeVenueDetails(row: VenueDetailsRow): SerializedVenueDetails {
  return {
    capacity: row.capacity,
    soundSystem: row.soundSystem,
    curfew: row.curfew,
    amenities: row.amenities ?? [],
    dealTypes: row.dealTypes ?? [],
    cateringNotes: row.cateringNotes,
    accommodationNotes: row.accommodationNotes,
    artistLogisticsNotes: row.artistLogisticsNotes,
    audienceLogisticsNotes: row.audienceLogisticsNotes,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
  };
}

/**
 * Shape a profile by the caller's per-profile role — the field-level serializer,
 * server-side (not UI hiding). Everyone with any membership sees the profile's
 * public face; only owner/admin see the private `billing` identity (legal name,
 * VAT, invoice sequence). `role` omitted → treat as unprivileged.
 *
 * `location` and `venueDetails` are only emitted when the caller passed the
 * joined rows. An ABSENT key means "not loaded on this route"; an explicit `null`
 * means "loaded, and there is nothing recorded" — the same absent-vs-empty
 * distinction the event serializer uses for `extras`, so a screen can tell "no
 * capacity set" apart from "this endpoint doesn't carry capacity".
 */
export function serializeProfile(
  profile: ProfileRow,
  role?: ProfileRole,
  relations?: ProfileRelations,
): SerializedProfile {
  const base: SerializedProfile = {
    id: profile.id,
    kind: profile.kind,
    type: profile.type,
    ownerUserId: profile.ownerUserId,
    name: profile.name,
    slug: profile.slug,
    isPublic: profile.isPublic,
    bio: profile.bio,
    avatarUrl: profile.avatarUrl,
    bannerUrl: profile.bannerUrl,
    details: profile.details,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
  if (relations && "location" in relations) {
    base.location = relations.location
      ? { city: relations.location.city, country: relations.location.country }
      : null;
  }
  if (relations && "venueDetails" in relations) {
    base.venueDetails = relations.venueDetails
      ? serializeVenueDetails(relations.venueDetails)
      : null;
  }
  if (role && BILLING_ROLES.includes(role)) {
    base.billing = profile.billing;
  }
  return base;
}
