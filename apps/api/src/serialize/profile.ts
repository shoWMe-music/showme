import type { ProfileRole } from "@showme/auth";
import type { schema } from "@showme/db";
import { isPlaceProfile } from "@showme/shared";
import { z } from "zod";

type ProfileRow = typeof schema.profiles.$inferSelect;
type ProfileLocationRow = typeof schema.profileLocations.$inferSelect;
type VenueDetailsRow = typeof schema.venueDetails.$inferSelect;
type SocialLinkRow = typeof schema.profileSocialLinks.$inferSelect;
type MediaRow = typeof schema.profileMedia.$inferSelect;

/**
 * Where the profile is. Read from `profile_locations`, which is the one place
 * that holds it — event timezones, agent territory, deal authority and profile
 * search all join this table, so anything else claiming to be "the location" is
 * by definition a second copy that will drift. It used to: the editor wrote a
 * string to `details.location` while the seed wrote a `profile_locations` row,
 * and the screen read the string, so a venue with a location showed none.
 *
 * `street` / `postcode` / `lat` / `lng` (migration 0014) are the precise half.
 * A MEMBER of the profile always sees them — it is their own address. The public
 * projection below decides separately, and differently, per kind.
 */
export interface SerializedProfileLocation {
  street: string | null;
  postcode: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
}

/**
 * The venue-specific facts (capacity, PA, curfew, amenities, logistics). Present
 * only for a profile that has a `venue_details` row.
 *
 * NOTE the two logistics fields and the contact pair: these are the private half
 * of the profile. This shape is for AUTHENTICATED members of the profile, who are
 * the venue's own team and may see all of it. The unauthenticated public page
 * gets a different, much smaller projection (`serializePublicProfile`) — never
 * this one.
 */
export interface SerializedVenueDetails {
  capacity: number | null;
  soundSystem: string | null;
  curfew: string | null;
  amenities: string[];
  dealTypes: string[];
  /** Named seating/standing configurations — see `VenueCapacitySetup`. */
  capacitySetups: VenueCapacitySetup[];
  cateringNotes: string | null;
  accommodationNotes: string | null;
  artistLogisticsNotes: string | null;
  audienceLogisticsNotes: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

/**
 * One named way of arranging the room — "Theater seating", "Standing only",
 * "Mixed". Ported from the previous app's `venueCapacitySetups`
 * (`../showme-settle-fast/src/pages/ProfileEditPage.tsx:605`), where exactly one
 * setup carried `isMain` and became the headline capacity.
 *
 * Stored in `venue_details.capacity_setups` (jsonb) because these are read with
 * their parent row and never filtered on — the headline number that a promoter
 * *does* search by is the plain `capacity` column beside it.
 */
export interface VenueCapacitySetup {
  id: string;
  name: string;
  capacitySitting: number | null;
  capacityStanding: number | null;
  isMain: boolean;
  notes: string | null;
}

/** A link the owner put on their profile — "Spotify" → an https URL. */
export interface SerializedSocialLink {
  platform: string;
  url: string;
}

/**
 * One performer line-up — "Solo", "Duo", "Full Band" — and how many people come
 * with it. Ported from the previous app's `setups`
 * (`../showme-settle-fast/src/pages/ProfileEditPage.tsx:478`), which an operator
 * reads to size the stage, the rider and the travel party before offering.
 *
 * Lives in `profiles.details` jsonb, not a table: it is a read-with-parent leaf
 * of a profile and nothing queries across it. (`venue_details` would be the wrong
 * home — a band is not a room.)
 */
export interface SerializedPerformerSetup {
  name: string;
  headcount: number | null;
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
  /** External links, in the order the owner arranged them. */
  socialLinks?: SerializedSocialLink[];
  /** Gallery image URLs, ordered. */
  photos?: string[];
  /** Video URLs (YouTube/Vimeo/anything), ordered. */
  videos?: string[];
  /** Legal/tax/invoicing identity — owner/admin only. */
  billing?: unknown;
  createdAt: string;
  updatedAt: string;
}

/** The joined rows a full profile projection needs beyond the profile itself. */
export interface ProfileRelations {
  location?: ProfileLocationRow | null;
  venueDetails?: VenueDetailsRow | null;
  socialLinks?: SocialLinkRow[];
  media?: MediaRow[];
}

/** Roles that may see the profile's private billing identity. */
const BILLING_ROLES: ProfileRole[] = ["owner", "admin"];

/* ------------------------------------------------------------- jsonb readers */

/**
 * `details` and `capacity_setups` are jsonb: whatever was written last is what
 * comes back, including shapes an older client wrote. Every reader below is
 * defensive and returns a well-formed value or nothing — a malformed row must
 * render as "not set", never crash the response serializer.
 */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function readOptionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Genres — a plain string list on `details`, written by the profile editor. */
export function readGenres(details: unknown): string[] {
  const list = asRecord(details).genres;
  if (!Array.isArray(list)) return [];
  return list.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
}

/** Performer setups — `details.setups`, each `{ name, headcount }`. */
export function readPerformerSetups(details: unknown): SerializedPerformerSetup[] {
  const list = asRecord(details).setups;
  if (!Array.isArray(list)) return [];
  const setups: SerializedPerformerSetup[] = [];
  for (const entry of list) {
    const record = asRecord(entry);
    const name = readOptionalString(record.name);
    if (!name) continue;
    setups.push({ name, headcount: readOptionalNumber(record.headcount) });
  }
  return setups;
}

/** Capacity setups — `venue_details.capacity_setups`. */
export function readCapacitySetups(value: unknown): VenueCapacitySetup[] {
  if (!Array.isArray(value)) return [];
  const setups: VenueCapacitySetup[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    const name = readOptionalString(record.name);
    if (!name) continue;
    setups.push({
      id: readOptionalString(record.id) ?? name,
      name,
      capacitySitting: readOptionalNumber(record.capacitySitting),
      capacityStanding: readOptionalNumber(record.capacityStanding),
      isMain: record.isMain === true,
      notes: readOptionalString(record.notes),
    });
  }
  return setups;
}

/* ---------------------------------------------------------- member-facing */

function serializeLocation(row: ProfileLocationRow): SerializedProfileLocation {
  return {
    street: row.street,
    postcode: row.postcode,
    city: row.city,
    country: row.country,
    lat: row.lat,
    lng: row.lng,
  };
}

function serializeVenueDetails(row: VenueDetailsRow): SerializedVenueDetails {
  return {
    capacity: row.capacity,
    soundSystem: row.soundSystem,
    curfew: row.curfew,
    amenities: row.amenities ?? [],
    dealTypes: row.dealTypes ?? [],
    capacitySetups: readCapacitySetups(row.capacitySetups),
    cateringNotes: row.cateringNotes,
    accommodationNotes: row.accommodationNotes,
    artistLogisticsNotes: row.artistLogisticsNotes,
    audienceLogisticsNotes: row.audienceLogisticsNotes,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
  };
}

/** Media rows are one table for photos and videos; `position` is the order. */
function mediaUrls(media: MediaRow[], kind: "photo" | "video"): string[] {
  return media
    .filter((row) => row.kind === kind)
    .sort((left, right) => (left.position ?? 0) - (right.position ?? 0))
    .map((row) => row.url);
}

/**
 * Shape a profile by the caller's per-profile role — the field-level serializer,
 * server-side (not UI hiding). Everyone with any membership sees the profile's
 * public face; only owner/admin see the private `billing` identity (legal name,
 * VAT, invoice sequence). `role` omitted → treat as unprivileged.
 *
 * `location`, `venueDetails`, `socialLinks`, `photos` and `videos` are only
 * emitted when the caller passed the joined rows. An ABSENT key means "not loaded
 * on this route"; an explicit `null` means "loaded, and there is nothing
 * recorded" — the same absent-vs-empty distinction the event serializer uses for
 * `extras`, so a screen can tell "no capacity set" apart from "this endpoint
 * doesn't carry capacity".
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
    base.location = relations.location ? serializeLocation(relations.location) : null;
  }
  if (relations && "venueDetails" in relations) {
    base.venueDetails = relations.venueDetails
      ? serializeVenueDetails(relations.venueDetails)
      : null;
  }
  if (relations?.socialLinks) {
    base.socialLinks = relations.socialLinks.map((row) => ({
      platform: row.platform,
      url: row.url,
    }));
  }
  if (relations?.media) {
    base.photos = mediaUrls(relations.media, "photo");
    base.videos = mediaUrls(relations.media, "video");
  }
  if (role && BILLING_ROLES.includes(role)) {
    base.billing = profile.billing;
  }
  return base;
}

/* ------------------------------------------------------------ public-facing */

/**
 * THE PUBLIC PROJECTION — the single place that decides what a stranger sees.
 *
 * One function, two callers: the anonymous `GET /public/profiles/:slug` (which
 * additionally requires `is_public`) and the owner's in-app **Preview**
 * (`GET /profiles/:id/public-preview`, which runs the same projection over an
 * unpublished profile so the owner can look before publishing). Because both go
 * through here, a preview cannot flatter the profile with a field the open web
 * would not get — which is exactly what the old "Public view" tab did.
 *
 * It is an ALLOWLIST, not a redaction: fields are named in, never taken out, so a
 * column added to `profiles` tomorrow is private by default.
 *
 * WHAT IS PUBLIC, and where the rule comes from. The inventory is ported from the
 * previous app's public page (`../showme-settle-fast/src/pages/PublicProfilePage.tsx`),
 * which is the only record of what these fields were actually FOR:
 *
 *   name · type/kind · bio · avatarUrl · bannerUrl   PublicProfilePage.tsx:186-257
 *   genres                                           :218
 *   socialLinks                                      :229
 *   photos · videos                                  :275, :286
 *   performer setups (name + headcount)              :308
 *   venue capacity (+ named setups)                  :329
 *   city · country                                   :220
 *   street · postcode · lat/lng — PLACES ONLY        :261-273, :367
 *
 * The last line is a ported RULE, not an omission: that page printed a venue's
 * street address and map pin and gave a performer city + country only
 * (`formatPerformerLocation` vs `formatLocation`). A venue nobody can find is a
 * venue nobody attends; a band's home address is not a listing. `isPlaceProfile`
 * draws the same line here, server-side, so it holds however the page is
 * rendered.
 *
 * Venue specs (`soundSystem`, `curfew`, `amenities`, `dealTypes`, catering and
 * accommodation notes) go out too. That is this repo's own later decision, not
 * the old app's — `packages/shared/src/venue.ts` states deal types are "shown on
 * its profile so a promoter knows before asking", migration 0010 marks amenities
 * as the searchable half of "find me a room", and `apps/marketing/src/profile.ts`
 * already renders all of them. Later decisions override the reference app
 * (CLAUDE.md), so they stay public.
 *
 * WHAT IS NEVER PUBLIC, and why each one:
 *   artistLogisticsNotes  load-in, back entrance, door code, artist parking —
 *                         `docs/decisions.md` #16.7 puts artist logistics on the
 *                         private side and audience logistics on the public one.
 *                         The two are separate COLUMNS precisely so this
 *                         function can publish one and cannot reach the other.
 *   contactEmail/Phone    an open page that prints a booker's mailbox is a
 *                         scraper's gift (migration 0010).
 *   billing               legal name, VAT id, invoice sequence.
 *   details (raw)         a jsonb blob whose future keys nobody has vetted. Only
 *                         the two leaves read out by name (`genres`, `setups`)
 *                         are published; the blob itself never is.
 *   ownerUserId           who owns it is membership, not a listing.
 *   isPublic              a published page saying "published" tells the reader
 *                         nothing and tells a prober something.
 *
 * NOTE the return type carries `id` and `slug`. Both are already public — the id
 * is how a "request a date" form addresses its target, and the slug IS the URL.
 */
export interface PublicProfile {
  id: string;
  slug: string;
  name: string;
  type: string | null;
  kind: string;
  bio: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  genres: string[];
  setups: SerializedPerformerSetup[];
  socialLinks: SerializedSocialLink[];
  photos: string[];
  videos: string[];
  location: PublicProfileLocation | null;
  venueDetails: PublicVenueDetails | null;
}

/** A public location. `street`/`postcode`/`lat`/`lng` are null for a non-place. */
export interface PublicProfileLocation {
  street: string | null;
  postcode: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
}

/** The venue facts a stranger may read. No artist logistics, no contact. */
export interface PublicVenueDetails {
  capacity: number | null;
  soundSystem: string | null;
  curfew: string | null;
  amenities: string[];
  dealTypes: string[];
  capacitySetups: VenueCapacitySetup[];
  cateringNotes: string | null;
  accommodationNotes: string | null;
  audienceLogisticsNotes: string | null;
}

function serializePublicLocation(
  row: ProfileLocationRow,
  publishesAddress: boolean,
): PublicProfileLocation {
  return {
    // The doorstep half is emitted for a place and nulled for everyone else.
    // Nulled rather than omitted so the shape is one shape: a reader never has
    // to ask "is street missing because it is private or because it is unset".
    street: publishesAddress ? row.street : null,
    postcode: publishesAddress ? row.postcode : null,
    city: row.city,
    country: row.country,
    lat: publishesAddress ? row.lat : null,
    lng: publishesAddress ? row.lng : null,
  };
}

function serializePublicVenueDetails(row: VenueDetailsRow): PublicVenueDetails {
  return {
    capacity: row.capacity,
    soundSystem: row.soundSystem,
    curfew: row.curfew,
    amenities: row.amenities ?? [],
    dealTypes: row.dealTypes ?? [],
    capacitySetups: readCapacitySetups(row.capacitySetups),
    cateringNotes: row.cateringNotes,
    accommodationNotes: row.accommodationNotes,
    // artistLogisticsNotes / contactEmail / contactPhone are NOT here. Their
    // absence is the feature — see the docstring above.
    audienceLogisticsNotes: row.audienceLogisticsNotes,
  };
}

/**
 * The WIRE schema for the projection above — deliberately declared next to it,
 * not in a route file.
 *
 * Two routes serve this body (`GET /public/profiles/:slug` for strangers,
 * `GET /profiles/:id/public-preview` for the owner's Preview), and a Fastify
 * response schema is not documentation: it STRIPS anything not named in it. Two
 * copies of it in two route files would be two independently-editable definitions
 * of "what is public", and the day they disagree one route silently publishes a
 * field the other withholds. One schema, imported by both, next to the function
 * that fills it, so a field can only become public in one place.
 */
const VenueCapacitySetupSchema = z.object({
  id: z.string(),
  name: z.string(),
  capacitySitting: z.number().nullable(),
  capacityStanding: z.number().nullable(),
  isMain: z.boolean(),
  notes: z.string().nullable(),
});

export const PublicProfileSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  type: z.string().nullable(),
  kind: z.string(),
  bio: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  bannerUrl: z.string().nullable(),
  genres: z.array(z.string()),
  setups: z.array(z.object({ name: z.string(), headcount: z.number().nullable() })),
  socialLinks: z.array(z.object({ platform: z.string(), url: z.string() })),
  photos: z.array(z.string()),
  videos: z.array(z.string()),
  location: z
    .object({
      street: z.string().nullable(),
      postcode: z.string().nullable(),
      city: z.string().nullable(),
      country: z.string().nullable(),
      lat: z.number().nullable(),
      lng: z.number().nullable(),
    })
    .nullable(),
  // No `artistLogisticsNotes`, no `contactEmail`, no `contactPhone`. A field with
  // no slot here cannot be published by a careless line in a handler.
  venueDetails: z
    .object({
      capacity: z.number().nullable(),
      soundSystem: z.string().nullable(),
      curfew: z.string().nullable(),
      amenities: z.array(z.string()),
      dealTypes: z.array(z.string()),
      capacitySetups: z.array(VenueCapacitySetupSchema),
      cateringNotes: z.string().nullable(),
      accommodationNotes: z.string().nullable(),
      audienceLogisticsNotes: z.string().nullable(),
    })
    .nullable(),
});

/**
 * One show on a public profile's bill — the same shape wherever it is served.
 *
 * Only what a stranger may already read off the public event page. Nothing about
 * tickets: `events` has no price column and no ticket link anything reads, so a
 * public page says when and where and does not invent what a ticket costs.
 */
export const PublicShowSchema = z.object({
  id: z.string(),
  title: z.string(),
  eventDate: z.string().nullable(),
  venueName: z.string().nullable(),
  doorTime: z.string().nullable(),
  startTime: z.string().nullable(),
});

/**
 * The public profile AS PUBLISHED — the projection plus the bill.
 *
 * ONE schema, used by the anonymous route and by the owner's preview, because a
 * preview whose job is "what a stranger sees" that is assembled separately is a
 * second projection waiting to drift. `profiles.test.ts` asserts the two agree
 * field for field, and this is what makes that cheap to keep true.
 */
export const PublishedProfileSchema = PublicProfileSchema.extend({
  upcomingShows: z.array(PublicShowSchema),
});

export function serializePublicProfile(
  profile: ProfileRow,
  relations?: ProfileRelations,
): PublicProfile {
  const publishesAddress = isPlaceProfile(profile.kind, profile.type);
  const media = relations?.media ?? [];
  return {
    id: profile.id,
    slug: profile.slug,
    name: profile.name,
    type: profile.type,
    kind: profile.kind,
    bio: profile.bio,
    avatarUrl: profile.avatarUrl,
    bannerUrl: profile.bannerUrl,
    genres: readGenres(profile.details),
    setups: readPerformerSetups(profile.details),
    socialLinks: (relations?.socialLinks ?? []).map((row) => ({
      platform: row.platform,
      url: row.url,
    })),
    photos: mediaUrls(media, "photo"),
    videos: mediaUrls(media, "video"),
    location: relations?.location
      ? serializePublicLocation(relations.location, publishesAddress)
      : null,
    venueDetails: relations?.venueDetails
      ? serializePublicVenueDetails(relations.venueDetails)
      : null,
  };
}
