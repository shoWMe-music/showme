import { schema } from "@showme/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { forbidden } from "../errors";
import { writeAudit } from "../lib/audit";
import { PaginationQuery, decodeCursor, paginate } from "../lib/pagination";
import { serializeProfile } from "../serialize/profile";

const ProfileParams = z.object({ profileId: z.string().uuid() });

const planTier = z.enum(["free_operator", "operator_pro", "free_artist", "artist_pro"]);
const SetPlanBody = z.object({ tier: planTier, status: z.string().min(1).optional() });

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

const ProfileListResponse = z.object({
  items: z.array(ProfileResponse),
  nextCursor: z.string().nullable(),
});

const PlanResponse = z.object({
  profileId: z.string(),
  tier: z.string(),
  status: z.string(),
  source: z.string(),
  seats: z.number(),
  assignedBy: z.string().nullable(),
});

const AlertResponse = z.object({
  id: z.string(),
  kind: z.string(),
  subjectKey: z.string().nullable(),
  details: z.unknown().optional(),
  resolved: z.boolean(),
  createdAt: z.string(),
});

const AuditQuery = PaginationQuery.extend({ eventId: z.string().uuid().optional() });

const AuditResponse = z.object({
  id: z.string(),
  at: z.string(),
  actorUserId: z.string().nullable(),
  actingProfileId: z.string().nullable(),
  capability: z.string().nullable(),
  action: z.string(),
  targetKind: z.string().nullable(),
  targetId: z.string().nullable(),
  eventId: z.string().nullable(),
  changes: z.unknown().optional(),
  requestId: z.string().nullable(),
});

const AuditListResponse = z.object({
  items: z.array(AuditResponse),
  nextCursor: z.string().nullable(),
});

/** Keyset cursor over a `(timestamp, id)` order — opaque to the client. */
interface KeysetCursor {
  at: string;
  id: string;
}

/**
 * Platform-admin routes. There is NO capability for platform admin — authority is
 * the `users.is_admin` flag, resolved onto the principal. Every handler opens with
 * the same inline guard; a non-admin is 403 across the board.
 */
export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // List every profile on the platform (keyset paginated over created_at, id).
  app.get(
    "/admin/profiles",
    { schema: { querystring: PaginationQuery, response: { 200: ProfileListResponse } } },
    async (request) => {
      if (!request.principal?.isAdmin) throw forbidden();
      const { database } = request.server;
      const { cursor, limit } = request.query;

      const createdAtMillis = sql`date_trunc('milliseconds', ${schema.profiles.createdAt})`;
      const decoded = cursor ? decodeCursor<KeysetCursor>(cursor) : null;
      const afterCursor = decoded
        ? sql`(${createdAtMillis}, ${schema.profiles.id}) > (${decoded.at}::timestamptz, ${decoded.id}::uuid)`
        : undefined;

      const rows = await database
        .select()
        .from(schema.profiles)
        .where(afterCursor)
        .orderBy(asc(createdAtMillis), asc(schema.profiles.id))
        .limit(limit + 1);

      const { items, nextCursor } = paginate(rows, limit, (row) => ({
        at: row.createdAt,
        id: row.id,
      }));
      // Admins are privileged — surface the full profile (billing included).
      return { items: items.map((row) => serializeProfile(row, "admin")), nextCursor };
    },
  );

  // Grant/override a profile's plan tier (manual assignment). Upsert + audit.
  app.post(
    "/admin/plans/:profileId",
    { schema: { params: ProfileParams, body: SetPlanBody, response: { 200: PlanResponse } } },
    async (request) => {
      if (!request.principal?.isAdmin) throw forbidden();
      const principal = request.principal;
      const { database } = request.server;
      const { profileId } = request.params;
      const { tier } = request.body;
      const status = request.body.status ?? "active";

      const plan = await database.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.plans)
          .values({ profileId, tier, status, source: "manual", assignedBy: principal.userId })
          .onConflictDoUpdate({
            target: schema.plans.profileId,
            set: {
              tier,
              status,
              source: "manual",
              assignedBy: principal.userId,
              assignedAt: new Date(),
            },
          })
          .returning();
        if (!row) throw new Error("plan upsert failed");
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: "admin.plan.set",
          targetKind: "plan",
          targetId: profileId,
          after: { tier, status },
        });
        return row;
      });

      return {
        profileId: plan.profileId,
        tier: plan.tier,
        status: plan.status,
        source: plan.source,
        seats: plan.seats,
        assignedBy: plan.assignedBy,
      };
    },
  );

  // List admin alerts — unresolved first, newest within each group.
  app.get(
    "/admin/alerts",
    { schema: { response: { 200: z.array(AlertResponse) } } },
    async (request) => {
      if (!request.principal?.isAdmin) throw forbidden();
      const { database } = request.server;

      const rows = await database
        .select()
        .from(schema.adminAlerts)
        .orderBy(asc(schema.adminAlerts.resolved), desc(schema.adminAlerts.createdAt))
        .limit(200);

      return rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        subjectKey: row.subjectKey,
        details: row.details,
        resolved: row.resolved,
        createdAt: row.createdAt.toISOString(),
      }));
    },
  );

  // List the forensic audit log — newest first, optional event filter, paginated.
  app.get(
    "/admin/audit",
    { schema: { querystring: AuditQuery, response: { 200: AuditListResponse } } },
    async (request) => {
      if (!request.principal?.isAdmin) throw forbidden();
      const { database } = request.server;
      const { cursor, limit, eventId } = request.query;

      const atMillis = sql`date_trunc('milliseconds', ${schema.auditLog.at})`;
      const decoded = cursor ? decodeCursor<KeysetCursor>(cursor) : null;
      const beforeCursor = decoded
        ? sql`(${atMillis}, ${schema.auditLog.id}) < (${decoded.at}::timestamptz, ${decoded.id}::uuid)`
        : undefined;

      const rows = await database
        .select()
        .from(schema.auditLog)
        .where(and(eventId ? eq(schema.auditLog.eventId, eventId) : undefined, beforeCursor))
        .orderBy(desc(atMillis), desc(schema.auditLog.id))
        .limit(limit + 1);

      const { items, nextCursor } = paginate(rows, limit, (row) => ({
        at: row.at,
        id: row.id,
      }));

      return {
        items: items.map((row) => ({
          id: row.id,
          at: row.at.toISOString(),
          actorUserId: row.actorUserId,
          actingProfileId: row.actingProfileId,
          capability: row.capability,
          action: row.action,
          targetKind: row.targetKind,
          targetId: row.targetId,
          eventId: row.eventId,
          changes: row.changes,
          requestId: row.requestId,
        })),
        nextCursor,
      };
    },
  );
}
