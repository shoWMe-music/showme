import { schema } from "@showme/db";
import { isPlaceProfile, isProfileTypeForKind, profileTypesForKind } from "@showme/shared";
import { and, asc, eq, ilike, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, conflict, forbidden, isUniqueViolation, notFound } from "../errors";
import { type Transaction, writeAudit } from "../lib/audit";
import { requireProfileRole } from "../lib/authorize";
import { readProfileBusyTime } from "../lib/availability";
import { validateTemplatePayload } from "../lib/budget-template-payload";
import { assertProfileAdminGrantAllows } from "../lib/entitlements";
import { withIdempotency } from "../plugins/idempotency";
import {
  type ProfileRelations,
  PublishedProfileSchema,
  serializeProfile,
  serializePublicProfile,
} from "../serialize/profile";
import { loadPublicShows } from "./public";

const ProfileParams = z.object({ id: z.string().uuid() });
const MemberParams = z.object({ id: z.string().uuid(), mid: z.string().uuid() });
const TemplateParams = z.object({ id: z.string().uuid(), tid: z.string().uuid() });
const StageParams = z.object({ id: z.string().uuid(), sid: z.string().uuid() });

const accountKind = z.enum(["operator", "performer", "team_and_crew", "agent"]);
const memberRole = z.enum(["owner", "admin", "editor", "viewer", "crew"]);
const templateCategory = z.enum([
  "budget",
  "deal",
  "rider",
  "terms",
  "schedule",
  "crew",
  "settlement_overview",
  "settlement_deal",
]);

/**
 * A profile's location, as the owner edits it. City and country travel together
 * because they describe one place — `country` is the ISO code the territory and
 * timezone engines read, so it is not free text.
 */
const ProfileLocationBody = z.object({
  // The doorstep half (migration 0014). Optional for everyone and asked for only
  // where it means something — a band has a home city, not a front door.
  street: z.string().max(300).nullable().optional(),
  postcode: z.string().max(30).nullable().optional(),
  city: z.string().max(200).nullable().optional(),
  country: z.string().max(2).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
});

/**
 * A named arrangement of the room. Ported from the previous app's
 * `venueCapacitySetups` (`../showme-settle-fast/src/pages/ProfileEditPage.tsx:605`):
 * "Theater seating" / "Standing only" / "Mixed", one of them the headline.
 *
 * `isMain` is accepted per row rather than as an index because that is how the
 * old data is shaped; the route below enforces the invariant the old UI only
 * enforced by convention — at most one main, and if any setup exists exactly one.
 */
const VenueCapacitySetupBody = z.object({
  id: z.string().min(1).max(100).optional(),
  name: z.string().min(1).max(200),
  capacitySitting: z.number().int().min(0).max(5_000_000).nullable().optional(),
  capacityStanding: z.number().int().min(0).max(5_000_000).nullable().optional(),
  isMain: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

/**
 * The external links on a profile. Sent as a whole list, not patched one at a
 * time: the owner reorders and deletes them in one form, and a partial protocol
 * would need ids the UI has no reason to carry.
 *
 * `url` must parse as a URL. The old app accepted free text here and its data has
 * bare "instagram.com/…" strings that render as broken relative links on the
 * public page — the one place the value is actually used.
 */
const SocialLinkBody = z.object({
  platform: z.string().min(1).max(60),
  url: z.string().url().max(2000),
});

/** A performer line-up: "Full Band", 5. Stored on `details.setups`. */
const PerformerSetupBody = z.object({
  name: z.string().min(1).max(200),
  headcount: z.number().int().min(0).max(1000).nullable().optional(),
});

/**
 * The venue facts. Amenities and deal types are plain strings, not enums: the
 * offered vocabulary lives in `@showme/shared`, but a venue may always type its
 * own (the previous app's real data is full of "Green Room" and "Loading Dock"),
 * and rejecting those would lose the very information the field exists to hold.
 * They are bounded and de-duplicated instead.
 */
const VenueDetailsBody = z.object({
  capacity: z.number().int().min(0).max(5_000_000).nullable().optional(),
  soundSystem: z.string().max(200).nullable().optional(),
  curfew: z.string().max(50).nullable().optional(),
  amenities: z.array(z.string().min(1).max(100)).max(100).optional(),
  dealTypes: z.array(z.string().min(1).max(100)).max(50).optional(),
  capacitySetups: z.array(VenueCapacitySetupBody).max(50).optional(),
  cateringNotes: z.string().max(5000).nullable().optional(),
  accommodationNotes: z.string().max(5000).nullable().optional(),
  artistLogisticsNotes: z.string().max(5000).nullable().optional(),
  audienceLogisticsNotes: z.string().max(5000).nullable().optional(),
  contactEmail: z.string().email().max(254).nullable().optional(),
  contactPhone: z.string().max(50).nullable().optional(),
});

/**
 * `kind` is NOT accepted here. An account's kind is fixed at signup and one per
 * account (CLAUDE.md, story.md), and a profile inherits its owner's — so it was
 * never a choice on this form. It used to be accepted and then checked for
 * equality with the user's kind, which is the same rule stated as a rejection
 * instead of an inference; asking for a value whose only legal answer is already
 * known is how a UI ends up offering "Performer" to a venue.
 */
const CreateProfileBody = z.object({
  type: z.string().min(1).optional(),
  name: z.string().min(1),
  slug: z.string().min(1),
});

const UpdateProfileBody = z.object({
  name: z.string().min(1).optional(),
  bio: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  isPublic: z.boolean().optional(),
  avatarUrl: z.string().nullable().optional(),
  bannerUrl: z.string().nullable().optional(),
  details: z.unknown().optional(),
  location: ProfileLocationBody.optional(),
  venueDetails: VenueDetailsBody.optional(),
  // Whole-list replacements, each backed by its own table. Absent = leave alone;
  // an empty array = "I removed them all", which is a thing an owner does.
  socialLinks: z.array(SocialLinkBody).max(30).optional(),
  photos: z.array(z.string().url().max(2000)).max(60).optional(),
  videos: z.array(z.string().url().max(2000)).max(30).optional(),
  /** Performer line-ups. Merged into `details.setups`, not a table — see the
   * serializer. Sent as its own field so the client never has to hand-merge the
   * jsonb blob. */
  setups: z.array(PerformerSetupBody).max(30).optional(),
});

const CreateMemberBody = z
  .object({
    userId: z.string().optional(),
    email: z.string().email().optional(),
    role: memberRole,
    displayName: z.string().min(1).optional(),
  })
  .refine((body) => body.userId !== undefined || body.email !== undefined, {
    message: "A member needs a userId or an email",
  });

const UpdateMemberBody = z.object({
  role: memberRole.optional(),
  displayName: z.string().min(1).nullable().optional(),
});

const UnavailabilityEntry = z.object({
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  reason: z.string().nullable().optional(),
});
const ReplaceUnavailabilityBody = z.object({ entries: z.array(UnavailabilityEntry) });

/**
 * A room of a venue. `capacity` is this room's own — a 400-cap main hall and a
 * 90-cap basement are two different bookings — and is separate from
 * `venue_details.capacity`, which is the building's headline number.
 */
const StageBody = z.object({
  name: z.string().min(1).max(200),
  capacity: z.number().int().min(0).max(5_000_000).nullable().optional(),
});

/** Every field optional: renaming a room must not require restating its capacity. */
const UpdateStageBody = z.object({
  name: z.string().min(1).max(200).optional(),
  capacity: z.number().int().min(0).max(5_000_000).nullable().optional(),
});

const CreateTemplateBody = z.object({
  category: templateCategory,
  name: z.string().min(1),
  payload: z.unknown(),
});
const UpdateTemplateBody = z.object({
  category: templateCategory.optional(),
  name: z.string().min(1).optional(),
  payload: z.unknown().optional(),
});

const ProfileLocationResponse = z.object({
  street: z.string().nullable(),
  postcode: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
});

const VenueCapacitySetupResponse = z.object({
  id: z.string(),
  name: z.string(),
  capacitySitting: z.number().nullable(),
  capacityStanding: z.number().nullable(),
  isMain: z.boolean(),
  notes: z.string().nullable(),
});

const SocialLinkResponse = z.object({
  platform: z.string(),
  url: z.string(),
});

const VenueDetailsResponse = z.object({
  capacity: z.number().nullable(),
  soundSystem: z.string().nullable(),
  curfew: z.string().nullable(),
  amenities: z.array(z.string()),
  dealTypes: z.array(z.string()),
  capacitySetups: z.array(VenueCapacitySetupResponse),
  cateringNotes: z.string().nullable(),
  accommodationNotes: z.string().nullable(),
  artistLogisticsNotes: z.string().nullable(),
  audienceLogisticsNotes: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
});

const PublicPreviewResponse = z.object({
  /**
   * EXACTLY what the anonymous route serves, bill included — same schema, not a
   * lookalike. `profiles.test.ts` asserts the two bodies are equal field for
   * field; sharing the schema is what keeps that true without vigilance.
   */
  profile: PublishedProfileSchema,
  /** False → this page is not reachable by anyone yet. The preview still renders
   * (that is the point of a preview), and the screen says so. */
  isPublic: z.boolean(),
});

const ProfileResponse = z.object({
  id: z.string(),
  kind: z.string(),
  type: z.string().nullable(),
  ownerUserId: z.string(),
  name: z.string(),
  slug: z.string(),
  isPublic: z.boolean(),
  bio: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  bannerUrl: z.string().nullable(),
  details: z.unknown().optional(),
  // Nullable AND optional, and the difference carries meaning: absent = this
  // route does not load it, null = loaded and nothing is recorded.
  location: ProfileLocationResponse.nullable().optional(),
  venueDetails: VenueDetailsResponse.nullable().optional(),
  socialLinks: z.array(SocialLinkResponse).optional(),
  photos: z.array(z.string()).optional(),
  videos: z.array(z.string()).optional(),
  billing: z.unknown().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const MemberResponse = z.object({
  id: z.string(),
  profileId: z.string(),
  userId: z.string().nullable(),
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  role: z.string(),
  status: z.string().nullable(),
});

const UnavailabilityResponse = z.object({
  id: z.string(),
  profileId: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  reason: z.string().nullable(),
});

/**
 * The in-app answer to "when is this profile free" — the SAME union the public
 * page gets, from the same module, so a share window and a public link can never
 * disagree. Deliberately identical in shape to the public response and not a
 * superset: a member can already read the underlying rows through
 * `GET /profiles/:id/unavailability` and `GET /calendar`, so widening this one
 * would only give two ways to ask the same question.
 */
const AvailabilityResponse = z.object({
  unavailability: z.array(z.object({ startDate: z.string(), endDate: z.string() })),
  busyTimes: z.array(z.object({ date: z.string(), startTime: z.string(), endTime: z.string() })),
});

const StageResponse = z.object({
  id: z.string(),
  venueProfileId: z.string(),
  name: z.string(),
  capacity: z.number().nullable(),
  /** How many events are placed in this room — what a delete would unassign. */
  eventCount: z.number(),
});

const DeleteStageResponse = z.object({
  deleted: z.boolean(),
  /** Events that kept their date and lost their room (`ON DELETE SET NULL`). */
  unassignedEvents: z.number(),
});

const TemplateResponse = z.object({
  id: z.string(),
  profileId: z.string(),
  category: z.string(),
  name: z.string(),
  payload: z.unknown(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

type MemberRow = typeof schema.profileMembers.$inferSelect;
type TemplateRow = typeof schema.templates.$inferSelect;

/** Shape a membership row for the wire (no Date columns leak through). */
function serializeMember(member: MemberRow): z.infer<typeof MemberResponse> {
  return {
    id: member.id,
    profileId: member.profileId,
    userId: member.userId,
    email: member.email,
    displayName: member.displayName,
    role: member.role,
    status: member.status,
  };
}

function serializeTemplate(template: TemplateRow): z.infer<typeof TemplateResponse> {
  return {
    id: template.id,
    profileId: template.profileId,
    category: template.category,
    name: template.name,
    payload: template.payload,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}

/**
 * The room, or a 404. Scoped by `venue_profile_id` as well as by id, so a room id
 * guessed from another venue cannot be edited through a profile the caller does
 * happen to belong to.
 */
async function loadStage(
  database: FastifyInstance["database"],
  venueProfileId: string,
  stageId: string,
): Promise<typeof schema.stages.$inferSelect> {
  const [stage] = await database
    .select()
    .from(schema.stages)
    .where(and(eq(schema.stages.id, stageId), eq(schema.stages.venueProfileId, venueProfileId)));
  if (!stage) throw notFound("Room not found");
  return stage;
}

/** How many events sit in this room — the number a delete would unassign. */
async function countEventsInStage(
  database: FastifyInstance["database"],
  stageId: string,
): Promise<number> {
  const [row] = await database
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.events)
    .where(eq(schema.events.stageId, stageId));
  return row?.total ?? 0;
}

const ANY_ROLE = ["owner", "admin", "editor", "viewer", "crew"] as const;
const WRITE_ROLES = ["owner", "admin", "editor"] as const;
const MANAGE_ROLES = ["owner", "admin"] as const;

const ProfileSearchQuery = z.object({
  // Optional — empty `q` lists performers to browse (not just search-on-type).
  q: z.string().optional(),
  kind: accountKind.default("performer"),
  // The picker grows the limit by 5 per "load more" (default first page = 5).
  limit: z.coerce.number().int().min(1).max(100).default(5),
  offset: z.coerce.number().int().min(0).default(0),
  // A per-session seed → STABLE pseudo-random order (so growing the limit / paging
  // never reshuffles). Absent → alphabetical.
  seed: z.coerce.number().int().optional(),
});

/** A discovery card projection — the public face of a searchable profile plus
 * the fields the picker needs (slug to open /p/:slug, city, claimed state). */
const ProfileSearchResult = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  kind: z.string(),
  type: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  bio: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  claimed: z.boolean(),
});

const ProfileSearchResponse = z.object({
  items: z.array(ProfileSearchResult),
  hasMore: z.boolean(),
});

// Reads run on either the request's database or an open transaction — the PATCH
// re-reads inside its own transaction so the audit records what it actually
// wrote, not a value another request could have changed in between.
type Database = FastifyInstance["database"] | Transaction;

/**
 * Load the two rows a full profile projection needs. Both are optional 1:1
 * extensions, so both may legitimately be missing — the caller gets `null`, which
 * the serializer turns into "loaded, nothing recorded" rather than "not loaded".
 *
 * `is_primary` picks the location because a profile may hold several (a promoter
 * with two cities, a seasonal open-air with dated rows); the primary is the one
 * every other reader of this table already uses.
 */
async function loadProfileRelations(
  database: Database,
  profileId: string,
): Promise<Required<ProfileRelations>> {
  const [locations, venues, socialLinks, media] = await Promise.all([
    database
      .select()
      .from(schema.profileLocations)
      .where(
        and(
          eq(schema.profileLocations.profileId, profileId),
          eq(schema.profileLocations.isPrimary, true),
        ),
      ),
    database.select().from(schema.venueDetails).where(eq(schema.venueDetails.profileId, profileId)),
    // Ordered by the position the owner arranged them in — `id` is a random
    // uuid, so without this the row of links reshuffles on every read.
    database
      .select()
      .from(schema.profileSocialLinks)
      .where(eq(schema.profileSocialLinks.profileId, profileId))
      .orderBy(asc(schema.profileSocialLinks.position)),
    database
      .select()
      .from(schema.profileMedia)
      .where(eq(schema.profileMedia.profileId, profileId))
      .orderBy(asc(schema.profileMedia.position)),
  ]);
  return {
    location: locations[0] ?? null,
    venueDetails: venues[0] ?? null,
    socialLinks,
    media,
  };
}

/**
 * The same joins for a whole list, in a fixed number of queries instead of 4N.
 * The list screen renders a location on every card, so N+1 here would be a round
 * trip per profile the moment anyone holds more than a couple.
 */
async function loadProfileRelationsBatch(
  database: Database,
  profileIds: string[],
): Promise<Map<string, Required<ProfileRelations>>> {
  const byProfile = new Map<string, Required<ProfileRelations>>(
    profileIds.map((profileId) => [
      profileId,
      { location: null, venueDetails: null, socialLinks: [], media: [] },
    ]),
  );
  if (profileIds.length === 0) return byProfile;

  const [locations, venues, socialLinks, media] = await Promise.all([
    database
      .select()
      .from(schema.profileLocations)
      .where(
        and(
          inArray(schema.profileLocations.profileId, profileIds),
          eq(schema.profileLocations.isPrimary, true),
        ),
      ),
    database
      .select()
      .from(schema.venueDetails)
      .where(inArray(schema.venueDetails.profileId, profileIds)),
    database
      .select()
      .from(schema.profileSocialLinks)
      .where(inArray(schema.profileSocialLinks.profileId, profileIds))
      .orderBy(asc(schema.profileSocialLinks.position)),
    database
      .select()
      .from(schema.profileMedia)
      .where(inArray(schema.profileMedia.profileId, profileIds))
      .orderBy(asc(schema.profileMedia.position)),
  ]);
  for (const location of locations) {
    const entry = byProfile.get(location.profileId);
    if (entry) entry.location = location;
  }
  for (const venue of venues) {
    const entry = byProfile.get(venue.profileId);
    if (entry) entry.venueDetails = venue;
  }
  for (const link of socialLinks) {
    byProfile.get(link.profileId)?.socialLinks.push(link);
  }
  for (const item of media) {
    byProfile.get(item.profileId)?.media.push(item);
  }
  return byProfile;
}

/**
 * Reject a profile type its account kind cannot create. The legal pairs live in
 * `@showme/shared` (`PROFILE_TYPES_BY_KIND`), sourced from story.md's definition
 * of each kind — an operator is "a venue, promoter, organizer, or festival", so
 * `band` is not a thing an operator profile can be.
 *
 * This is validated in code rather than as a Postgres enum on `profiles.type` on
 * purpose: the constraint that matters is the PAIRING of kind and type, and a
 * flat enum cannot express it — it would accept `band` on an operator profile
 * and enforce precisely nothing we care about. Existing untyped profiles stay
 * legal (`type` has been nullable free text since 0000).
 */
function assertProfileTypeAllowed(kind: string, type: string | null | undefined): void {
  if (isProfileTypeForKind(kind, type)) return;
  const allowed = profileTypesForKind(kind)
    .map((option) => option.key)
    .join(", ");
  throw badRequest(`A ${kind} profile cannot be of type "${type}". Allowed: ${allowed}`);
}

/**
 * Give the capacity setups stable ids and exactly one headline.
 *
 * "Exactly one main" is the invariant the old app's UI enforced by convention and
 * never in storage (`ProfileEditPage.tsx:626` set the flag on click, `:637`
 * repaired it on delete) — so its data has rows with two mains and rows with
 * none, and "the venue's headline capacity" was whichever one rendered first.
 * Here it is enforced on write: the first setup flagged main wins, and if none is
 * flagged the first setup becomes it, so a non-empty list always has an answer.
 *
 * Ids are minted from the position when the client did not send one. They only
 * have to be stable within the row, which is why a jsonb array can carry them at
 * all — nothing outside this blob ever references a setup.
 */
function normalizeCapacitySetups(
  setups: {
    id?: string;
    name: string;
    capacitySitting?: number | null;
    capacityStanding?: number | null;
    isMain?: boolean;
    notes?: string | null;
  }[],
): {
  id: string;
  name: string;
  capacitySitting: number | null;
  capacityStanding: number | null;
  isMain: boolean;
  notes: string | null;
}[] {
  const named = setups
    .map((setup, index) => ({ ...setup, name: setup.name.trim(), index }))
    .filter((setup) => setup.name !== "");
  const mainIndex = named.findIndex((setup) => setup.isMain === true);
  const headline = mainIndex === -1 ? 0 : mainIndex;
  return named.map((setup, position) => ({
    id: setup.id?.trim() || `VCS-${setup.index + 1}`,
    name: setup.name,
    capacitySitting: setup.capacitySitting ?? null,
    capacityStanding: setup.capacityStanding ?? null,
    isMain: position === headline,
    notes: setup.notes?.trim() || null,
  }));
}

/**
 * Venue details belong to a PLACE.
 *
 * The editor for them is already gated in the browser on `isPlaceProfile`
 * (`routes/Profiles.tsx`), but the route was not, so a performer who owns their own
 * profile could PATCH a capacity, a curfew and a green room onto it and `GET` would
 * hand it all back — `VenueSpecsCard` then renders a room on a band. Hiding a form
 * while the route still answers is not a boundary.
 *
 * Gated on the SAME predicate the browser reads, imported from `@showme/shared`, so
 * the two halves cannot drift into disagreeing about what a place is. Not a
 * capability: the catalog in `packages/shared/src/capabilities.ts` is event-scoped
 * and hangs off `event_participants`, while `venue_details` hangs off a profile —
 * authority here is already settled by `requireProfileRole` one line earlier. What
 * is left is whether this surface EXISTS for this profile, which is a kind/type
 * fact of exactly the shape `assertProfileTypeAllowed` above already handles.
 *
 * Note it tracks the PLACE, not the account kind: an operator typed `promoter` is
 * refused too, because a promoter is an organisation, not a building.
 *
 * `type` is judged AFTER the patch, not before — one request may retype the profile
 * and describe the room, and the rule has to judge what the profile is about to be.
 */
function assertVenueDetailsAllowed(kind: string, type: string | null | undefined): void {
  if (isPlaceProfile(kind, type)) return;
  throw forbidden("Venue details belong to a venue or festival profile.");
}

/** Drop blanks and duplicates from a chip list, preserving the order given. */
function normalizeStringList(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed === "" || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

export async function profileRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Discovery search over PUBLIC profiles by name — the performer picker's source.
  // Any authenticated user may search; only `is_public` profiles are returned, so
  // unclaimed stubs (private) never leak. Static path wins over `/profiles/:id`.
  app.get(
    "/profiles/search",
    {
      schema: { querystring: ProfileSearchQuery, response: { 200: ProfileSearchResponse } },
    },
    async (request) => {
      const { database } = request.server;
      const { q, kind, limit, offset, seed } = request.query;
      const term = q?.trim();

      // Stable pseudo-random order keyed by the session seed (so paging/growing
      // never reshuffles); alphabetical when no seed is given.
      const order =
        seed !== undefined
          ? sql`md5(${schema.profiles.id}::text || ${String(seed)})`
          : asc(schema.profiles.name);

      // Fetch one extra row to know whether a "load more" is worthwhile.
      const rows = await database
        .select({
          id: schema.profiles.id,
          name: schema.profiles.name,
          slug: schema.profiles.slug,
          kind: schema.profiles.kind,
          type: schema.profiles.type,
          avatarUrl: schema.profiles.avatarUrl,
          bio: schema.profiles.bio,
          claimedAt: schema.profiles.claimedAt,
          city: schema.profileLocations.city,
          country: schema.profileLocations.country,
        })
        .from(schema.profiles)
        // Primary location (if any) for the card's city line — a queryable field.
        .leftJoin(
          schema.profileLocations,
          and(
            eq(schema.profileLocations.profileId, schema.profiles.id),
            eq(schema.profileLocations.isPrimary, true),
          ),
        )
        .where(
          and(
            eq(schema.profiles.isPublic, true),
            eq(schema.profiles.kind, kind),
            term ? ilike(schema.profiles.name, `%${term}%`) : undefined,
          ),
        )
        .orderBy(order)
        .limit(limit + 1)
        .offset(offset);

      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        kind: row.kind,
        type: row.type,
        avatarUrl: row.avatarUrl,
        bio: row.bio,
        city: row.city,
        country: row.country,
        claimed: row.claimedAt != null,
      }));
      return { items, hasMore };
    },
  );

  // List the caller's profiles — resolved from their memberships, no scan.
  app.get(
    "/profiles",
    { schema: { response: { 200: z.array(ProfileResponse) } } },
    async (request) => {
      const { database } = request.server;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const ids = principal.memberships.map((membership) => membership.profileId);
      if (ids.length === 0) return [];

      const rows = await database
        .select()
        .from(schema.profiles)
        .where(inArray(schema.profiles.id, ids));
      const roleByProfile = new Map(
        principal.memberships.map((membership) => [membership.profileId, membership.role]),
      );
      // The cards on this screen show a location and a capacity, so the list has
      // to carry them — batched, not per row.
      const relations = await loadProfileRelationsBatch(
        database,
        rows.map((row) => row.id),
      );
      return rows.map((row) =>
        serializeProfile(row, roleByProfile.get(row.id), relations.get(row.id)),
      );
    },
  );

  // Create a profile of the caller's own account kind, plus its owner membership,
  // in one transaction. The requested kind MUST equal the user's kind.
  app.post(
    "/profiles",
    { schema: { body: CreateProfileBody, response: { 201: ProfileResponse } } },
    async (request, reply) => {
      const { database } = request.server;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const [user] = await database
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, principal.userId));
      if (!user) throw new Error("user row missing for authenticated principal");
      // The kind is the account's, full stop — inherited, never submitted. The
      // caller only chooses the finer type, and only from that kind's vocabulary.
      const kind = user.kind;
      assertProfileTypeAllowed(kind, request.body.type);

      const { statusCode, body } = await withIdempotency(request, "POST /profiles", async () => {
        let created: z.infer<typeof ProfileResponse>;
        try {
          created = await database.transaction(async (tx) => {
            const [profile] = await tx
              .insert(schema.profiles)
              .values({
                kind,
                type: request.body.type ?? null,
                ownerUserId: principal.userId,
                createdBy: principal.userId,
                name: request.body.name,
                slug: request.body.slug,
              })
              .returning();
            if (!profile) throw new Error("profile create failed");

            await tx.insert(schema.profileMembers).values({
              profileId: profile.id,
              userId: principal.userId,
              role: "owner",
              status: "active",
              seatConsumed: true,
              addedBy: principal.userId,
            });

            const serialized = serializeProfile(profile, "owner", {
              location: null,
              venueDetails: null,
            });
            await writeAudit(tx, request, {
              capability: "profile.edit",
              action: "profile.create",
              targetKind: "profile",
              targetId: profile.id,
              after: serialized,
            });
            return serialized;
          });
        } catch (error) {
          if (isUniqueViolation(error)) throw conflict("That slug is already taken");
          throw error;
        }
        return { statusCode: 201, body: created };
      });

      return reply.status(statusCode as 201).send(body);
    },
  );

  // Read one profile — any member may view; owner/admin additionally see billing.
  app.get(
    "/profiles/:id",
    { schema: { params: ProfileParams, response: { 200: ProfileResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      const membership = requireProfileRole(request, id, [...ANY_ROLE]);
      const [profile] = await database
        .select()
        .from(schema.profiles)
        .where(eq(schema.profiles.id, id));
      if (!profile) throw notFound("Profile not found");
      const relations = await loadProfileRelations(database, id);
      return serializeProfile(profile, membership.role, relations);
    },
  );

  /**
   * PREVIEW — what a stranger sees on this profile's public page.
   *
   * The screen's Edit/Preview switch reads this. It exists because the honest
   * answer to "what does the public see" cannot be computed in the browser: the
   * client holds the MEMBER projection (which carries the booking contact, the
   * artist logistics and every draft event), so any client-side "public view" is
   * a guess dressed as a fact. That is precisely what the previous switcher was —
   * its "Public view" tab rendered draft events under a "PUBLIC" heading.
   *
   * So the preview is a server round trip through the SAME
   * `serializePublicProfile` the anonymous route uses, plus the same event
   * visibility rule. The only difference from `GET /public/profiles/:slug` is the
   * `is_public` gate: that route 404s an unpublished profile, and previewing
   * before publishing is the entire point of a preview. `isPublic` rides along so
   * the screen can say "nobody can reach this yet" instead of implying otherwise.
   *
   * Authorization is ordinary: any member of the profile may look. It reveals
   * strictly less than `GET /profiles/:id`, which they can already call.
   */
  app.get(
    "/profiles/:id/public-preview",
    { schema: { params: ProfileParams, response: { 200: PublicPreviewResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      requireProfileRole(request, id, [...ANY_ROLE]);
      const [profile] = await database
        .select()
        .from(schema.profiles)
        .where(eq(schema.profiles.id, id));
      if (!profile) throw notFound("Profile not found");

      const relations = await loadProfileRelations(database, id);
      // The SAME loader the anonymous page uses. The old `loadPublicUpcomingEvents`
      // filtered on `events.venue_profile_id` alone, so a performer — who is never
      // named that way, only through `event_participants` — previewed an empty bill
      // no matter how many shows they were confirmed on.
      const upcomingShows = await loadPublicShows(database, id);
      return {
        profile: { ...serializePublicProfile(profile, relations), upcomingShows },
        isPublic: profile.isPublic,
      };
    },
  );

  // Edit a profile (owner/admin).
  app.patch(
    "/profiles/:id",
    {
      schema: {
        params: ProfileParams,
        body: UpdateProfileBody,
        response: { 200: ProfileResponse },
      },
    },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      const membership = requireProfileRole(request, id, [...MANAGE_ROLES]);
      const [before] = await database
        .select()
        .from(schema.profiles)
        .where(eq(schema.profiles.id, id));
      if (!before) throw notFound("Profile not found");

      // The type must stay inside the account kind's vocabulary. `kind` itself is
      // not editable here at all — it is the account's and is not on the body.
      if (request.body.type !== undefined) {
        assertProfileTypeAllowed(before.kind, request.body.type);
      }
      // Refused BEFORE the transaction, so a rejected request writes nothing at all —
      // not the name in the same body, not a half-saved profile.
      if (request.body.venueDetails !== undefined) {
        const nextType = request.body.type !== undefined ? request.body.type : before.type;
        assertVenueDetailsAllowed(before.kind, nextType);
      }

      const fields: Partial<typeof schema.profiles.$inferInsert> = {};
      if (request.body.name !== undefined) fields.name = request.body.name;
      if (request.body.bio !== undefined) fields.bio = request.body.bio;
      if (request.body.type !== undefined) fields.type = request.body.type;
      if (request.body.isPublic !== undefined) fields.isPublic = request.body.isPublic;
      if (request.body.avatarUrl !== undefined) fields.avatarUrl = request.body.avatarUrl;
      if (request.body.bannerUrl !== undefined) fields.bannerUrl = request.body.bannerUrl;
      if (request.body.details !== undefined) fields.details = request.body.details;

      // ---- Performer setups -------------------------------------------------
      // `setups` is a first-class field on the body but a leaf inside the
      // `details` jsonb, so it is merged here rather than in the client. Sending
      // `details` and `setups` together is legal and `setups` wins: the caller
      // named the specific field, which is the more specific intent. Doing this
      // in the client instead is how `details` blobs lose keys — every caller has
      // to remember to spread the old object.
      if (request.body.setups !== undefined) {
        const carried =
          request.body.details !== undefined ? request.body.details : (before.details ?? {});
        const baseDetails =
          carried && typeof carried === "object" && !Array.isArray(carried)
            ? (carried as Record<string, unknown>)
            : {};
        fields.details = {
          ...baseDetails,
          setups: request.body.setups.map((setup) => ({
            name: setup.name.trim(),
            headcount: setup.headcount ?? null,
          })),
        };
      }

      const relationsBefore = await loadProfileRelations(database, id);

      const updated = await database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.profiles)
          .set({ ...fields, updatedAt: new Date() })
          .where(eq(schema.profiles.id, id))
          .returning();
        if (!after) throw notFound("Profile not found");

        // ---- Location ------------------------------------------------------
        // Written to `profile_locations`, the table every other reader already
        // joins (event timezone, agent territory, deal authority, search). The
        // editor used to put a free-text string in `details.location` instead,
        // which is why a seeded venue with a Stockholm row rendered "No location
        // set" — two sources, one of them invisible to every query.
        if (request.body.location !== undefined) {
          const {
            street = null,
            postcode = null,
            city = null,
            country = null,
            lat = null,
            lng = null,
          } = request.body.location;
          // Uppercased because the territory checks compare ISO codes literally.
          const countryCode = country ? country.toUpperCase() : null;
          const locationFields = { street, postcode, city, country: countryCode, lat, lng };
          const existing = relationsBefore.location;
          if (existing) {
            await tx
              .update(schema.profileLocations)
              .set(locationFields)
              .where(eq(schema.profileLocations.id, existing.id));
          } else if (Object.values(locationFields).some((value) => value !== null)) {
            // Only create a row when there is something to say — an empty
            // location row would make `location` non-null and claim otherwise.
            await tx
              .insert(schema.profileLocations)
              .values({ profileId: id, ...locationFields, isPrimary: true });
          }
        }

        // ---- Social links --------------------------------------------------
        // Replaced wholesale, in the order given. The owner edits them as one
        // list (add / reorder / delete in a single form), so a per-row protocol
        // would need ids the form has no reason to carry — and a reorder would
        // become N requests that can half-apply.
        if (request.body.socialLinks !== undefined) {
          await tx
            .delete(schema.profileSocialLinks)
            .where(eq(schema.profileSocialLinks.profileId, id));
          const links = request.body.socialLinks;
          if (links.length > 0) {
            await tx.insert(schema.profileSocialLinks).values(
              links.map((link, position) => ({
                profileId: id,
                platform: link.platform.trim(),
                url: link.url.trim(),
                position,
              })),
            );
          }
        }

        // ---- Photos and videos ---------------------------------------------
        // One `profile_media` table, two kinds. Each kind is replaced
        // independently: sending photos must not wipe the videos, because the
        // two are separate cards in the editor and a screen that only touched
        // one of them sends only that one.
        for (const [kind, urls] of [
          ["photo", request.body.photos],
          ["video", request.body.videos],
        ] as const) {
          if (urls === undefined) continue;
          await tx
            .delete(schema.profileMedia)
            .where(and(eq(schema.profileMedia.profileId, id), eq(schema.profileMedia.kind, kind)));
          if (urls.length > 0) {
            await tx.insert(schema.profileMedia).values(
              urls.map((url, position) => ({
                profileId: id,
                kind,
                url: url.trim(),
                position,
              })),
            );
          }
        }

        // ---- Venue details -------------------------------------------------
        // Upserted, because the row is created lazily: a profile has no
        // venue_details until someone first fills one in.
        if (request.body.venueDetails !== undefined) {
          const body = request.body.venueDetails;
          const venueFields: Partial<typeof schema.venueDetails.$inferInsert> = {};
          if (body.capacity !== undefined) venueFields.capacity = body.capacity;
          if (body.soundSystem !== undefined) venueFields.soundSystem = body.soundSystem;
          if (body.curfew !== undefined) venueFields.curfew = body.curfew;
          if (body.amenities !== undefined) {
            venueFields.amenities = normalizeStringList(body.amenities);
          }
          if (body.dealTypes !== undefined) {
            venueFields.dealTypes = normalizeStringList(body.dealTypes);
          }
          if (body.capacitySetups !== undefined) {
            venueFields.capacitySetups = normalizeCapacitySetups(body.capacitySetups);
          }
          if (body.cateringNotes !== undefined) venueFields.cateringNotes = body.cateringNotes;
          if (body.accommodationNotes !== undefined) {
            venueFields.accommodationNotes = body.accommodationNotes;
          }
          if (body.artistLogisticsNotes !== undefined) {
            venueFields.artistLogisticsNotes = body.artistLogisticsNotes;
          }
          if (body.audienceLogisticsNotes !== undefined) {
            venueFields.audienceLogisticsNotes = body.audienceLogisticsNotes;
          }
          if (body.contactEmail !== undefined) venueFields.contactEmail = body.contactEmail;
          if (body.contactPhone !== undefined) venueFields.contactPhone = body.contactPhone;

          await tx
            .insert(schema.venueDetails)
            .values({ profileId: id, ...venueFields })
            .onConflictDoUpdate({
              target: schema.venueDetails.profileId,
              set: { ...venueFields, updatedAt: new Date() },
            });
        }

        const relationsAfter = await loadProfileRelations(tx, id);
        const serialized = serializeProfile(after, membership.role, relationsAfter);
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: "profile.update",
          targetKind: "profile",
          targetId: id,
          before: serializeProfile(before, membership.role, relationsBefore),
          after: serialized,
        });
        return serialized;
      });

      return updated;
    },
  );

  // Delete a profile (owner only).
  app.delete(
    "/profiles/:id",
    { schema: { params: ProfileParams, response: { 200: z.object({ deleted: z.boolean() }) } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      requireProfileRole(request, id, ["owner"]);
      const [before] = await database
        .select()
        .from(schema.profiles)
        .where(eq(schema.profiles.id, id));
      if (!before) throw notFound("Profile not found");

      await database.transaction(async (tx) => {
        const [deleted] = await tx
          .delete(schema.profiles)
          .where(eq(schema.profiles.id, id))
          .returning();
        if (!deleted) throw notFound("Profile not found");
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: "profile.delete",
          targetKind: "profile",
          targetId: id,
          before: serializeProfile(before, "owner"),
        });
      });

      return { deleted: true };
    },
  );

  // ---- Members ------------------------------------------------------------

  // List a profile's members (any member).
  app.get(
    "/profiles/:id/members",
    { schema: { params: ProfileParams, response: { 200: z.array(MemberResponse) } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      requireProfileRole(request, id, [...ANY_ROLE]);
      const members = await database
        .select()
        .from(schema.profileMembers)
        .where(eq(schema.profileMembers.profileId, id));
      return members.map(serializeMember);
    },
  );

  // Add a member (owner/admin). A duplicate (profile, user) surfaces as 409.
  app.post(
    "/profiles/:id/members",
    {
      schema: { params: ProfileParams, body: CreateMemberBody, response: { 201: MemberResponse } },
    },
    async (request, reply) => {
      const { database } = request.server;
      const { id } = request.params;

      requireProfileRole(request, id, [...MANAGE_ROLES]);
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      // Entitlement gate (decisions #4/§C, #12): granting admin consumes a seat and
      // is a paid-plan feature. Composed AFTER authorization, always a fresh read.
      await assertProfileAdminGrantAllows(database, { profileId: id, nextRole: request.body.role });

      let created: MemberRow;
      try {
        created = await database.transaction(async (tx) => {
          const [member] = await tx
            .insert(schema.profileMembers)
            .values({
              profileId: id,
              userId: request.body.userId ?? null,
              email: request.body.email ?? null,
              displayName: request.body.displayName ?? null,
              role: request.body.role,
              status: "active",
              seatConsumed: request.body.role === "admin",
              addedBy: principal.userId,
            })
            .returning();
          if (!member) throw new Error("member create failed");
          await writeAudit(tx, request, {
            capability: "members.manage",
            action: "member.add",
            targetKind: "profile_member",
            targetId: member.id,
            after: serializeMember(member),
          });
          return member;
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict("That user is already a member of this profile");
        }
        throw error;
      }

      return reply.status(201).send(serializeMember(created));
    },
  );

  // Update a member (owner/admin). The owner row is protected.
  app.patch(
    "/profiles/:id/members/:mid",
    { schema: { params: MemberParams, body: UpdateMemberBody, response: { 200: MemberResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id, mid } = request.params;

      requireProfileRole(request, id, [...MANAGE_ROLES]);
      const [before] = await database
        .select()
        .from(schema.profileMembers)
        .where(and(eq(schema.profileMembers.id, mid), eq(schema.profileMembers.profileId, id)));
      if (!before) throw notFound("Member not found");
      if (before.role === "owner") {
        throw forbidden("The owner membership cannot be changed");
      }

      // Promoting to admin is gated (and consumes a seat) — same paid-plan rule as add.
      await assertProfileAdminGrantAllows(database, {
        profileId: id,
        nextRole: request.body.role,
        currentRole: before.role,
      });

      const fields: Partial<typeof schema.profileMembers.$inferInsert> = {};
      if (request.body.role !== undefined) {
        fields.role = request.body.role;
        fields.seatConsumed = request.body.role === "admin";
      }
      if (request.body.displayName !== undefined) fields.displayName = request.body.displayName;

      const updated = await database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.profileMembers)
          .set({ ...fields, updatedAt: new Date() })
          .where(eq(schema.profileMembers.id, mid))
          .returning();
        if (!after) throw notFound("Member not found");
        await writeAudit(tx, request, {
          capability: "members.manage",
          action: "member.update",
          targetKind: "profile_member",
          targetId: mid,
          before: serializeMember(before),
          after: serializeMember(after),
        });
        return after;
      });

      return serializeMember(updated);
    },
  );

  // Remove a member (owner/admin). The owner row is protected.
  app.delete(
    "/profiles/:id/members/:mid",
    { schema: { params: MemberParams, response: { 200: z.object({ deleted: z.boolean() }) } } },
    async (request) => {
      const { database } = request.server;
      const { id, mid } = request.params;

      requireProfileRole(request, id, [...MANAGE_ROLES]);
      const [before] = await database
        .select()
        .from(schema.profileMembers)
        .where(and(eq(schema.profileMembers.id, mid), eq(schema.profileMembers.profileId, id)));
      if (!before) throw notFound("Member not found");
      if (before.role === "owner") {
        throw forbidden("The owner membership cannot be removed");
      }

      await database.transaction(async (tx) => {
        const [deleted] = await tx
          .delete(schema.profileMembers)
          .where(eq(schema.profileMembers.id, mid))
          .returning();
        if (!deleted) throw notFound("Member not found");
        await writeAudit(tx, request, {
          capability: "members.manage",
          action: "member.remove",
          targetKind: "profile_member",
          targetId: mid,
          before: serializeMember(before),
        });
      });

      return { deleted: true };
    },
  );

  // ---- Unavailability -----------------------------------------------------

  // Read a profile's blocked dates (any member).
  app.get(
    "/profiles/:id/unavailability",
    { schema: { params: ProfileParams, response: { 200: z.array(UnavailabilityResponse) } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      requireProfileRole(request, id, [...ANY_ROLE]);
      const rows = await database
        .select()
        .from(schema.profileUnavailability)
        .where(eq(schema.profileUnavailability.profileId, id));
      return rows.map((row) => ({
        id: row.id,
        profileId: row.profileId,
        startDate: row.startDate,
        endDate: row.endDate,
        reason: row.reason,
      }));
    },
  );

  /**
   * The computed availability for a profile: hand-made blocks UNIONED with the
   * days and hours taken by entries imported from a connected calendar.
   *
   * WHY A ROUTE AND NOT CLIENT-SIDE ARITHMETIC. The share modal used to derive
   * "free days" from the events it happened to have on screen, which meant the
   * rule lived in a React hook, ran over a month's worth of data for a window
   * that routinely runs past the month edge, and never subtracted recorded
   * unavailability at all. That is three ways for the app to advertise a date it
   * cannot honour. The rule belongs in one framework-agnostic module
   * (`lib/availability.ts`); this is its authenticated door.
   *
   * No title, no reason, no ids — same as the public shape. A member who wants
   * detail reads the calendar itself, where the serializer applies the
   * owner-only-title rule.
   */
  app.get(
    "/profiles/:id/availability",
    {
      schema: {
        params: ProfileParams,
        querystring: z.object({
          from: z.string().min(1).optional(),
          to: z.string().min(1).optional(),
        }),
        response: { 200: AvailabilityResponse },
      },
    },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      requireProfileRole(request, id, [...ANY_ROLE]);
      const busy = await readProfileBusyTime(database, id, request.query);
      return { unavailability: busy.dateRanges, busyTimes: busy.timeWindows };
    },
  );

  // Replace a profile's blocked dates wholesale (owner/admin/editor).
  app.put(
    "/profiles/:id/unavailability",
    {
      schema: {
        params: ProfileParams,
        body: ReplaceUnavailabilityBody,
        response: { 200: z.array(UnavailabilityResponse) },
      },
    },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      requireProfileRole(request, id, [...WRITE_ROLES]);

      const replaced = await database.transaction(async (tx) => {
        await tx
          .delete(schema.profileUnavailability)
          .where(eq(schema.profileUnavailability.profileId, id));

        const rows = request.body.entries.length
          ? await tx
              .insert(schema.profileUnavailability)
              .values(
                request.body.entries.map((entry) => ({
                  profileId: id,
                  startDate: entry.startDate,
                  endDate: entry.endDate,
                  reason: entry.reason ?? null,
                })),
              )
              .returning()
          : [];

        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: "unavailability.replace",
          targetKind: "profile_unavailability",
          targetId: id,
          after: rows,
        });
        return rows;
      });

      return replaced.map((row) => ({
        id: row.id,
        profileId: row.profileId,
        startDate: row.startDate,
        endDate: row.endDate,
        reason: row.reason,
      }));
    },
  );

  // ---- Rooms (stages) -----------------------------------------------------

  /**
   * A VENUE'S ROOMS. `stages` has existed since migration 0000 and `events.stage_id`
   * has pointed at it just as long, but until now no route listed, created or
   * renamed one — so the table only ever held what a test inserted by hand, the
   * event page could say no more than "Room / Stage: Assigned", and the calendar
   * could not offer a real calendar to check availability against.
   *
   * A room is NOT a `venue_details.capacity_setups` entry. A setup is one room
   * counted two ways ("Theater seating" 220 / "Standing only" 400); a room is a
   * separate space that holds its own show the same night. That difference is the
   * whole reason these are rows with ids rather than another jsonb leaf: an event
   * points AT a room, and a jsonb entry has nothing to point at.
   *
   * Authorization is the venue profile's own — `requireProfileRole`, exactly as
   * the members, unavailability and templates sections use it. Reading is open to
   * any member (crew included: the floor staff of a venue know its rooms, and the
   * calendar picker is drawn from this list); writing is owner/admin/editor.
   *
   * The room list of a venue you do NOT belong to is a 404, not an empty list —
   * a venue's internal geography is not something an arm's-length performer or a
   * stranger gets to enumerate.
   */
  app.get(
    "/profiles/:id/stages",
    { schema: { params: ProfileParams, response: { 200: z.array(StageResponse) } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      requireProfileRole(request, id, [...ANY_ROLE]);

      // The event count rides along because the only dangerous thing a room
      // editor can do is delete a room with shows in it, and a UI cannot warn
      // about that without knowing. One grouped join, not a request per room.
      const rows = await database
        .select({
          id: schema.stages.id,
          venueProfileId: schema.stages.venueProfileId,
          name: schema.stages.name,
          capacity: schema.stages.capacity,
          eventCount: sql<number>`count(${schema.events.id})::int`,
        })
        .from(schema.stages)
        .leftJoin(schema.events, eq(schema.events.stageId, schema.stages.id))
        .where(eq(schema.stages.venueProfileId, id))
        .groupBy(schema.stages.id)
        .orderBy(asc(schema.stages.name));

      return rows;
    },
  );

  // Add a room (owner/admin/editor).
  app.post(
    "/profiles/:id/stages",
    {
      schema: { params: ProfileParams, body: StageBody, response: { 201: StageResponse } },
    },
    async (request, reply) => {
      const { database } = request.server;
      const { id } = request.params;

      requireProfileRole(request, id, [...WRITE_ROLES]);

      const [profile] = await database
        .select({ kind: schema.profiles.kind, type: schema.profiles.type })
        .from(schema.profiles)
        .where(eq(schema.profiles.id, id));
      if (!profile) throw notFound("Profile not found");
      // Only a place has rooms. A promoter, a booking agency or a band is an
      // organisation, not a building — the same test that decides whether the
      // venue-details editor is offered at all (`@showme/shared`).
      if (!isPlaceProfile(profile.kind, profile.type)) {
        throw badRequest("Only a venue or festival profile can have rooms");
      }

      const name = request.body.name.trim();
      if (name === "") throw badRequest("A room needs a name");

      const created = await database
        .transaction(async (tx) => {
          const [stage] = await tx
            .insert(schema.stages)
            .values({ venueProfileId: id, name, capacity: request.body.capacity ?? null })
            .returning();
          if (!stage) throw new Error("stage create failed");
          await writeAudit(tx, request, {
            capability: "profile.edit",
            action: "stage.create",
            targetKind: "stage",
            targetId: stage.id,
            after: stage,
          });
          return { ...stage, eventCount: 0 };
        })
        .catch((error: unknown) => {
          // The (venue_profile_id, name) unique index from migration 0016. A room
          // is chosen by name everywhere it matters, so two "Hall A"s would make
          // every one of those choices ambiguous.
          if (isUniqueViolation(error))
            throw conflict("This venue already has a room by that name");
          throw error;
        });

      return reply.status(201).send(created);
    },
  );

  // Rename a room or correct its capacity (owner/admin/editor).
  app.patch(
    "/profiles/:id/stages/:sid",
    {
      schema: { params: StageParams, body: UpdateStageBody, response: { 200: StageResponse } },
    },
    async (request) => {
      const { database } = request.server;
      const { id, sid } = request.params;

      requireProfileRole(request, id, [...WRITE_ROLES]);
      const before = await loadStage(database, id, sid);

      const fields: Partial<typeof schema.stages.$inferInsert> = {};
      if (request.body.name !== undefined) {
        const name = request.body.name.trim();
        if (name === "") throw badRequest("A room needs a name");
        fields.name = name;
      }
      if (request.body.capacity !== undefined) fields.capacity = request.body.capacity;

      const updated = await database
        .transaction(async (tx) => {
          const [after] = await tx
            .update(schema.stages)
            .set(fields)
            .where(eq(schema.stages.id, sid))
            .returning();
          if (!after) throw notFound("Room not found");
          await writeAudit(tx, request, {
            capability: "profile.edit",
            action: "stage.update",
            targetKind: "stage",
            targetId: sid,
            before,
            after,
          });
          return after;
        })
        .catch((error: unknown) => {
          if (isUniqueViolation(error))
            throw conflict("This venue already has a room by that name");
          throw error;
        });

      return { ...updated, eventCount: await countEventsInStage(database, sid) };
    },
  );

  /**
   * Remove a room (owner/admin/editor).
   *
   * WHAT HAPPENS TO THE SHOWS IN IT: they stay, and become room-less. That is not
   * a choice made here — `events.stage_id` is declared `ON DELETE SET NULL`
   * (`schema/events.ts`), and it is the right one: deleting a room is a statement
   * about the BUILDING, and a settled event must never vanish because someone
   * tidied a floor plan. The count of events that just lost their room is returned
   * rather than swallowed, so the screen can say what it did instead of implying
   * nothing happened.
   *
   * NOTE the availability consequence, which is deliberate and worth stating: an
   * event with no room occupies EVERY room (`@showme/shared` `occupiedDates`),
   * because nobody can say which room is still free. Deleting a room therefore
   * makes the venue look busier, not emptier — the safe direction.
   */
  app.delete(
    "/profiles/:id/stages/:sid",
    { schema: { params: StageParams, response: { 200: DeleteStageResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id, sid } = request.params;

      requireProfileRole(request, id, [...WRITE_ROLES]);
      const before = await loadStage(database, id, sid);
      const unassignedEvents = await countEventsInStage(database, sid);

      await database.transaction(async (tx) => {
        const [deleted] = await tx
          .delete(schema.stages)
          .where(eq(schema.stages.id, sid))
          .returning();
        if (!deleted) throw notFound("Room not found");
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: "stage.delete",
          targetKind: "stage",
          targetId: sid,
          before,
        });
      });

      return { deleted: true, unassignedEvents };
    },
  );

  // ---- Templates ----------------------------------------------------------

  // List a profile's templates (owner/admin/editor).
  app.get(
    "/profiles/:id/templates",
    { schema: { params: ProfileParams, response: { 200: z.array(TemplateResponse) } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      requireProfileRole(request, id, [...WRITE_ROLES]);
      const rows = await database
        .select()
        .from(schema.templates)
        .where(eq(schema.templates.profileId, id));
      return rows.map(serializeTemplate);
    },
  );

  // Create a template (owner/admin/editor).
  app.post(
    "/profiles/:id/templates",
    {
      schema: {
        params: ProfileParams,
        body: CreateTemplateBody,
        response: { 201: TemplateResponse },
      },
    },
    async (request, reply) => {
      const { database } = request.server;
      const { id } = request.params;

      requireProfileRole(request, id, [...WRITE_ROLES]);

      // PLAN.md §K — the payload is validated per-category, so a template can
      // never be stored in a shape the screen that loads it cannot read.
      const checked = validateTemplatePayload(request.body.category, request.body.payload ?? {});
      if (!checked.ok) throw badRequest(checked.message);

      const created = await database.transaction(async (tx) => {
        const [template] = await tx
          .insert(schema.templates)
          .values({
            profileId: id,
            category: request.body.category,
            name: request.body.name,
            payload: checked.payload,
          })
          .returning();
        if (!template) throw new Error("template create failed");
        const serialized = serializeTemplate(template);
        await writeAudit(tx, request, {
          capability: "templates.manage",
          action: "template.create",
          targetKind: "template",
          targetId: template.id,
          after: serialized,
        });
        return serialized;
      });

      return reply.status(201).send(created);
    },
  );

  // Edit a template (owner/admin/editor).
  app.patch(
    "/profiles/:id/templates/:tid",
    {
      schema: {
        params: TemplateParams,
        body: UpdateTemplateBody,
        response: { 200: TemplateResponse },
      },
    },
    async (request) => {
      const { database } = request.server;
      const { id, tid } = request.params;

      requireProfileRole(request, id, [...WRITE_ROLES]);
      const [before] = await database
        .select()
        .from(schema.templates)
        .where(and(eq(schema.templates.id, tid), eq(schema.templates.profileId, id)));
      if (!before) throw notFound("Template not found");

      const fields: Partial<typeof schema.templates.$inferInsert> = {};
      if (request.body.category !== undefined) fields.category = request.body.category;
      if (request.body.name !== undefined) fields.name = request.body.name;
      if (request.body.payload !== undefined) {
        // Against the category the row will HAVE after this edit, not the one it
        // had before — moving a payload into `budget` has to meet budget's shape.
        const category = request.body.category ?? before.category;
        const checked = validateTemplatePayload(category, request.body.payload);
        if (!checked.ok) throw badRequest(checked.message);
        fields.payload = checked.payload;
      }

      const updated = await database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.templates)
          .set({ ...fields, updatedAt: new Date() })
          .where(eq(schema.templates.id, tid))
          .returning();
        if (!after) throw notFound("Template not found");
        const serialized = serializeTemplate(after);
        await writeAudit(tx, request, {
          capability: "templates.manage",
          action: "template.update",
          targetKind: "template",
          targetId: tid,
          before: serializeTemplate(before),
          after: serialized,
        });
        return serialized;
      });

      return updated;
    },
  );

  // Delete a template (owner/admin/editor).
  app.delete(
    "/profiles/:id/templates/:tid",
    { schema: { params: TemplateParams, response: { 200: z.object({ deleted: z.boolean() }) } } },
    async (request) => {
      const { database } = request.server;
      const { id, tid } = request.params;

      requireProfileRole(request, id, [...WRITE_ROLES]);
      const [before] = await database
        .select()
        .from(schema.templates)
        .where(and(eq(schema.templates.id, tid), eq(schema.templates.profileId, id)));
      if (!before) throw notFound("Template not found");

      await database.transaction(async (tx) => {
        const [deleted] = await tx
          .delete(schema.templates)
          .where(eq(schema.templates.id, tid))
          .returning();
        if (!deleted) throw notFound("Template not found");
        await writeAudit(tx, request, {
          capability: "templates.manage",
          action: "template.delete",
          targetKind: "template",
          targetId: tid,
          before: serializeTemplate(before),
        });
      });

      return { deleted: true };
    },
  );
}
