import { schema } from "@showme/db";
import { isProfileTypeForKind, profileTypesForKind } from "@showme/shared";
import { and, asc, eq, ilike, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { type Transaction, writeAudit } from "../lib/audit";
import { requireProfileRole } from "../lib/authorize";
import { readProfileBusyTime } from "../lib/availability";
import { assertProfileAdminGrantAllows } from "../lib/entitlements";
import { withIdempotency } from "../plugins/idempotency";
import { type ProfileRelations, serializeProfile } from "../serialize/profile";

const ProfileParams = z.object({ id: z.string().uuid() });
const MemberParams = z.object({ id: z.string().uuid(), mid: z.string().uuid() });
const TemplateParams = z.object({ id: z.string().uuid(), tid: z.string().uuid() });

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
  city: z.string().max(200).nullable().optional(),
  country: z.string().max(2).nullable().optional(),
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
  city: z.string().nullable(),
  country: z.string().nullable(),
});

const VenueDetailsResponse = z.object({
  capacity: z.number().nullable(),
  soundSystem: z.string().nullable(),
  curfew: z.string().nullable(),
  amenities: z.array(z.string()),
  dealTypes: z.array(z.string()),
  cateringNotes: z.string().nullable(),
  accommodationNotes: z.string().nullable(),
  artistLogisticsNotes: z.string().nullable(),
  audienceLogisticsNotes: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
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

/** Postgres unique-violation — a uniqueness constraint tripped (slug, or member). */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
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
  const [locations, venues] = await Promise.all([
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
  ]);
  return { location: locations[0] ?? null, venueDetails: venues[0] ?? null };
}

/**
 * The same two joins for a whole list, in two queries instead of 2N. The list
 * screen renders a location on every card, so N+1 here would be a round trip per
 * profile the moment anyone holds more than a couple.
 */
async function loadProfileRelationsBatch(
  database: Database,
  profileIds: string[],
): Promise<Map<string, Required<ProfileRelations>>> {
  const byProfile = new Map<string, Required<ProfileRelations>>(
    profileIds.map((profileId) => [profileId, { location: null, venueDetails: null }]),
  );
  if (profileIds.length === 0) return byProfile;

  const [locations, venues] = await Promise.all([
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
  ]);
  for (const location of locations) {
    const entry = byProfile.get(location.profileId);
    if (entry) entry.location = location;
  }
  for (const venue of venues) {
    const entry = byProfile.get(venue.profileId);
    if (entry) entry.venueDetails = venue;
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

      const fields: Partial<typeof schema.profiles.$inferInsert> = {};
      if (request.body.name !== undefined) fields.name = request.body.name;
      if (request.body.bio !== undefined) fields.bio = request.body.bio;
      if (request.body.type !== undefined) fields.type = request.body.type;
      if (request.body.isPublic !== undefined) fields.isPublic = request.body.isPublic;
      if (request.body.avatarUrl !== undefined) fields.avatarUrl = request.body.avatarUrl;
      if (request.body.bannerUrl !== undefined) fields.bannerUrl = request.body.bannerUrl;
      if (request.body.details !== undefined) fields.details = request.body.details;

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
          const { city = null, country = null } = request.body.location;
          // Uppercased because the territory checks compare ISO codes literally.
          const countryCode = country ? country.toUpperCase() : null;
          const existing = relationsBefore.location;
          if (existing) {
            await tx
              .update(schema.profileLocations)
              .set({ city, country: countryCode })
              .where(eq(schema.profileLocations.id, existing.id));
          } else if (city !== null || countryCode !== null) {
            // Only create a row when there is something to say — an empty
            // location row would make `location` non-null and claim otherwise.
            await tx
              .insert(schema.profileLocations)
              .values({ profileId: id, city, country: countryCode, isPrimary: true });
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

      const created = await database.transaction(async (tx) => {
        const [template] = await tx
          .insert(schema.templates)
          .values({
            profileId: id,
            category: request.body.category,
            name: request.body.name,
            payload: request.body.payload ?? {},
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
      if (request.body.payload !== undefined) fields.payload = request.body.payload;

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
