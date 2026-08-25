import { schema } from "@showme/db";
import { and, asc, eq, ilike, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { writeAudit } from "../lib/audit";
import { requireProfileRole } from "../lib/authorize";
import { assertProfileAdminGrantAllows } from "../lib/entitlements";
import { withIdempotency } from "../plugins/idempotency";
import { serializeProfile } from "../serialize/profile";

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

const CreateProfileBody = z.object({
  kind: accountKind,
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
      return rows.map((row) => serializeProfile(row, roleByProfile.get(row.id)));
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
      if (request.body.kind !== user.kind) {
        throw badRequest("A profile's kind must match your account kind");
      }

      const { statusCode, body } = await withIdempotency(request, "POST /profiles", async () => {
        let created: z.infer<typeof ProfileResponse>;
        try {
          created = await database.transaction(async (tx) => {
            const [profile] = await tx
              .insert(schema.profiles)
              .values({
                kind: request.body.kind,
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

            const serialized = serializeProfile(profile, "owner");
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
      return serializeProfile(profile, membership.role);
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

      const fields: Partial<typeof schema.profiles.$inferInsert> = {};
      if (request.body.name !== undefined) fields.name = request.body.name;
      if (request.body.bio !== undefined) fields.bio = request.body.bio;
      if (request.body.type !== undefined) fields.type = request.body.type;
      if (request.body.isPublic !== undefined) fields.isPublic = request.body.isPublic;
      if (request.body.avatarUrl !== undefined) fields.avatarUrl = request.body.avatarUrl;
      if (request.body.bannerUrl !== undefined) fields.bannerUrl = request.body.bannerUrl;
      if (request.body.details !== undefined) fields.details = request.body.details;

      const updated = await database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.profiles)
          .set({ ...fields, updatedAt: new Date() })
          .where(eq(schema.profiles.id, id))
          .returning();
        if (!after) throw notFound("Profile not found");
        const serialized = serializeProfile(after, membership.role);
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: "profile.update",
          targetKind: "profile",
          targetId: id,
          before: serializeProfile(before, membership.role),
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
