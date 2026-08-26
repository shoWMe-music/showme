import { schema } from "@showme/db";
import { PRO_CODES, isCountryCode, normalizeCountryCode } from "@showme/shared";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, forbidden, notFound } from "../errors";
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

/**
 * The PRO tariff for one territory (`performing_rights_rates`, migration 0018).
 *
 * `country` is the key because a tariff is a fact about a TERRITORY — decisions.md
 * #17 makes the country stamp the thing that drives "VAT, PRO codes
 * (STIM/GEMA/PRS), currency", so the PRO is downstream of it, not above it. The
 * table comment in `packages/db/src/schema/infra.ts` argues the full case.
 */
const CountryParams = z.object({
  country: z
    .string()
    .min(1)
    .describe("ISO 3166-1 alpha-2 country code, e.g. SE. Case-insensitive."),
});

const SetPerformingRightsRateBody = z.object({
  /**
   * The filing destination of record. Four values, because that is what
   * `performance_reports.pro_code` accepts — most territories are honestly
   * `none`, and name their society in `proName` instead.
   */
  proCode: z.enum(PRO_CODES).default("none"),
  /** "STIM", "GEMA", "PRS for Music", "SACEM" — what the planner's card prints. */
  proName: z.string().min(1).max(120),
  /**
   * Basis points of ticket revenue. 750 = 7.50%. Never a percentage and never a
   * float (money.md) — 7.5 sent here is 0.075%, which is why the field is named
   * for its unit and the range is stated in the error the client gets back.
   */
  rateBasisPoints: z.number().int().min(0).max(10_000),
  /** The published tariff this rate was read off. */
  sourceUrl: z.string().url().max(2048).nullable().optional(),
  /** Which tariff, in words — "Tariff M, live concerts, 2026". */
  sourceNote: z.string().max(500).nullable().optional(),
});

const PerformingRightsRateResponse = z.object({
  country: z.string(),
  proCode: z.string(),
  proName: z.string(),
  rateBasisPoints: z.number(),
  sourceUrl: z.string().nullable(),
  sourceNote: z.string().nullable(),
  updatedBy: z.string().nullable(),
  updatedAt: z.string(),
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

  // ---------------------------------------------------------------------------
  // PRO rates per territory
  //
  // The Budget Planner's PRO fee estimate resolves against these rows. An empty
  // table is a working state, not a broken one: every event then keeps the flat
  // 6% `planning_default` it has always had, labelled on the card as nobody's
  // tariff. Writing a row here is what turns that estimate into a quoted rate,
  // which is why only a platform admin may do it and why every write is audited.
  // ---------------------------------------------------------------------------

  // Every configured territory rate, alphabetically by country.
  app.get(
    "/admin/performing-rights-rates",
    { schema: { response: { 200: z.array(PerformingRightsRateResponse) } } },
    async (request) => {
      if (!request.principal?.isAdmin) throw forbidden();
      const { database } = request.server;

      const rows = await database
        .select()
        .from(schema.performingRightsRates)
        .orderBy(asc(schema.performingRightsRates.country));

      return rows.map(serializePerformingRightsRate);
    },
  );

  // Set (or replace) one territory's rate. Upsert + audit.
  app.put(
    "/admin/performing-rights-rates/:country",
    {
      schema: {
        params: CountryParams,
        body: SetPerformingRightsRateBody,
        response: { 200: PerformingRightsRateResponse },
      },
    },
    async (request) => {
      if (!request.principal?.isAdmin) throw forbidden();
      const principal = request.principal;
      const { database } = request.server;

      // Normalize BEFORE validating, so `se` and ` SE ` are accepted and stored
      // as `SE`. The resolver matches on the normalized form, so a row stored any
      // other way would sit in this list looking configured while governing no
      // event at all — the quietest possible failure (audit A-18 made the same
      // argument for `representations.region`).
      const country = normalizeCountryCode(request.params.country);
      if (!isCountryCode(country)) {
        throw badRequest(
          `${request.params.country} is not an ISO 3166-1 alpha-2 country code. Send a two-letter code such as SE.`,
        );
      }

      const { proCode, proName, rateBasisPoints } = request.body;
      const sourceUrl = request.body.sourceUrl ?? null;
      const sourceNote = request.body.sourceNote ?? null;

      const rate = await database.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(schema.performingRightsRates)
          .where(eq(schema.performingRightsRates.country, country));

        const [row] = await tx
          .insert(schema.performingRightsRates)
          .values({
            country,
            proCode,
            proName,
            rateBasisPoints,
            sourceUrl,
            sourceNote,
            updatedBy: principal.userId,
          })
          .onConflictDoUpdate({
            target: schema.performingRightsRates.country,
            set: {
              proCode,
              proName,
              rateBasisPoints,
              sourceUrl,
              sourceNote,
              updatedBy: principal.userId,
              updatedAt: new Date(),
            },
          })
          .returning();
        if (!row) throw new Error("performing rights rate upsert failed");

        await writeAudit(tx, request, {
          // Null, not a borrowed capability: authority here is `is_admin` and no
          // capability was checked, so naming one would record a check that never
          // happened (see `lib/audit.ts`).
          capability: null,
          action: "admin.performing_rights_rate.set",
          targetKind: "performing_rights_rate",
          before: before ? serializePerformingRightsRate(before) : null,
          after: serializePerformingRightsRate(row),
        });
        return row;
      });

      return serializePerformingRightsRate(rate);
    },
  );

  // Remove a territory's rate — the planner falls back to the qualified estimate.
  app.delete(
    "/admin/performing-rights-rates/:country",
    // No response schema: a 204 has no body, and declaring one makes the type
    // provider demand a payload the status forbids (the house pattern, `deals.ts`).
    { schema: { params: CountryParams } },
    async (request, reply) => {
      if (!request.principal?.isAdmin) throw forbidden();
      const { database } = request.server;
      const country = normalizeCountryCode(request.params.country);

      await database.transaction(async (tx) => {
        const [deleted] = await tx
          .delete(schema.performingRightsRates)
          .where(eq(schema.performingRightsRates.country, country))
          .returning();
        if (!deleted) throw notFound(`No PRO rate is configured for ${country}`);

        await writeAudit(tx, request, {
          capability: null,
          action: "admin.performing_rights_rate.delete",
          targetKind: "performing_rights_rate",
          before: serializePerformingRightsRate(deleted),
          after: null,
        });
      });

      return reply.status(204).send();
    },
  );
}

/** One rate row on the wire. Timestamps as ISO strings, like every other route. */
function serializePerformingRightsRate(row: typeof schema.performingRightsRates.$inferSelect) {
  return {
    country: row.country,
    proCode: row.proCode,
    proName: row.proName,
    rateBasisPoints: row.rateBasisPoints,
    sourceUrl: row.sourceUrl,
    sourceNote: row.sourceNote,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt.toISOString(),
  };
}
