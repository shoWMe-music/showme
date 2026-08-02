import { schema } from "@showme/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { writeAudit } from "../lib/audit";
import { requireProfileRole } from "../lib/authorize";
import { canUseFeature, creditBalance, getPlanTier } from "../lib/entitlements";

const ProfileParams = z.object({ profileId: z.string().uuid() });
const IdParams = z.object({ id: z.string().uuid() });

const planTier = z.enum(["free_operator", "operator_pro", "free_artist", "artist_pro"]);

const RequestPlanBody = z.object({ tier: planTier });

const PlanResponse = z.object({
  profileId: z.string(),
  tier: z.string(),
  status: z.string(),
  source: z.string(),
  seats: z.number(),
  renewalAt: z.string().nullable(),
  creditBalance: z.number(),
});

const FeatureCheckResponse = z.object({
  allowed: z.boolean(),
  reason: z.string().optional(),
  used: z.number().optional(),
  limit: z.number().optional(),
});

const CapStatusResponse = z.object({
  createEvent: FeatureCheckResponse,
  sendOffer: FeatureCheckResponse,
  spamSuspended: z.boolean(),
  credits: z.number(),
});

const RequestResponse = z.object({ status: z.string(), requestedTier: z.string() });

const ANY_ROLE = ["owner", "admin", "editor", "viewer", "crew"] as const;

export async function planRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Read a profile's plan (any member). No `plans` row = the computed default
  // tier for the profile's kind, so callers always get a plan shape back.
  app.get(
    "/plans/:profileId",
    { schema: { params: ProfileParams, response: { 200: PlanResponse } } },
    async (request) => {
      const { database } = request.server;
      const { profileId } = request.params;

      requireProfileRole(request, profileId, [...ANY_ROLE]);

      const [plan] = await database
        .select()
        .from(schema.plans)
        .where(eq(schema.plans.profileId, profileId));
      const credits = await creditBalance(database, profileId);

      if (!plan) {
        const tier = await getPlanTier(database, profileId);
        return {
          profileId,
          tier,
          status: "active",
          source: "manual",
          seats: 1,
          renewalAt: null,
          creditBalance: credits,
        };
      }

      return {
        profileId: plan.profileId,
        tier: plan.tier,
        status: plan.status,
        source: plan.source,
        seats: plan.seats,
        renewalAt: plan.renewalAt ? plan.renewalAt.toISOString() : null,
        creditBalance: credits,
      };
    },
  );

  // Request a tier change (owner). v1 records intent only: mark the plan
  // `status='requested'` (no tier grant — billing wiring finalizes it later).
  app.post(
    "/plans/:profileId/request",
    {
      schema: { params: ProfileParams, body: RequestPlanBody, response: { 200: RequestResponse } },
    },
    async (request) => {
      const { database } = request.server;
      const { profileId } = request.params;
      const { tier: requestedTier } = request.body;

      requireProfileRole(request, profileId, ["owner"]);

      // The plan's `tier` stays the CURRENT tier — only `status` flips to
      // 'requested'. Upsert so a profile with no plan row still records intent.
      const currentTier = await getPlanTier(database, profileId);
      await database.transaction(async (tx) => {
        await tx
          .insert(schema.plans)
          .values({ profileId, tier: currentTier, status: "requested" })
          .onConflictDoUpdate({
            target: schema.plans.profileId,
            set: { status: "requested" },
          });
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: "plan.request",
          targetKind: "plan",
          targetId: profileId,
          after: { requestedTier },
        });
      });

      return { status: "requested", requestedTier };
    },
  );

  // The profile's entitlement snapshot (any member) — the metered features plus
  // the spam-suspension flag and credit balance, all freshly computed.
  app.get(
    "/profiles/:id/cap-status",
    { schema: { params: IdParams, response: { 200: CapStatusResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      requireProfileRole(request, id, [...ANY_ROLE]);

      const [createEvent, sendOffer, notSpam, credits] = await Promise.all([
        canUseFeature(database, id, "create_event"),
        canUseFeature(database, id, "send_offer"),
        canUseFeature(database, id, "not_spam_suspended"),
        creditBalance(database, id),
      ]);

      return {
        createEvent,
        sendOffer,
        spamSuspended: !notSpam.allowed,
        credits,
      };
    },
  );
}
