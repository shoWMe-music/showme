import fastifyCors from "@fastify/cors";
import { type Database, schema } from "@showme/db";
import { eq } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import {
  type AppDependencies,
  DEFAULT_CORS_ALLOWED_ORIGINS,
  DEFAULT_LEADS_ALLOWED_ORIGINS,
  apiErrorHandler,
  corsOptions,
} from "./app";
import { createNoopLeadSink } from "./lib/clickup";
import { confirmDealIfComplete } from "./lib/deal-confirmation";
import { createNoopEmailSink } from "./lib/email";
import { defaultStorageSigner } from "./lib/storage";
import { authenticate } from "./plugins/authenticate";
import "./types";

/** A route plugin — the exported `<resource>Routes` shape. */
export type RoutePlugin = (fastify: FastifyInstance) => Promise<void>;

/**
 * Build an app with the full request pipeline (authenticate → Zod → error
 * envelope) but only the given route plugin(s) registered under `/api/v1`. Lets a
 * route module be TDD'd in isolation before it's wired into `buildApp`.
 */
export function buildTestApp(
  dependencies: AppDependencies,
  routes: RoutePlugin[],
): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate("database", dependencies.database);
  app.decorate("tokenVerifier", dependencies.tokenVerifier);
  app.decorate("leadSink", dependencies.leadSink ?? createNoopLeadSink());
  app.decorate("emailSink", dependencies.emailSink ?? createNoopEmailSink());
  app.decorate(
    "leadsAllowedOrigins",
    dependencies.leadsAllowedOrigins ?? DEFAULT_LEADS_ALLOWED_ORIGINS,
  );
  app.decorate("calendarIntegration", dependencies.calendarIntegration ?? null);
  app.decorate("geocoder", dependencies.geocoder ?? null);
  app.decorate("storageSigner", dependencies.storageSigner ?? defaultStorageSigner());
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(apiErrorHandler);
  app.register(
    fastifyCors,
    corsOptions(dependencies.corsAllowedOrigins ?? DEFAULT_CORS_ALLOWED_ORIGINS),
  );
  app.addHook("preHandler", authenticate);
  app.register(
    async (api) => {
      for (const route of routes) {
        await api.register(route);
      }
    },
    { prefix: "/api/v1" },
  );
  return app;
}

/**
 * Sign every agreement on an event, so its settlement may open at all.
 *
 * Since 2026-08-31 `POST /events/:id/settlement/compute` refuses an event whose
 * deals are not signed ("a settlement cannot open unless the deal is signed") —
 * so a fixture that inserts `deals` rows straight into the table and then computes
 * is describing the world before that rule. This is how such a fixture catches up
 * in one line.
 *
 * **It skips the two routes' AUTHORIZATION halves and nothing else.** The state it
 * leaves is written by `confirmDealIfComplete` — the very function both real doors
 * call (`POST /deals/:did/confirm` in the app, `POST /shares/:token/approve` off
 * platform) — so the agreement status, `deals.status` and the frozen
 * `confirmed_snapshot` are produced by the product's own code, not restated by
 * hand. `settlement.test.ts` → "signs both agreements through the real routes"
 * drives the actual endpoints on the same fixture and asserts it lands in the same
 * place, which is what stops this being the kind of fixture `verify-e2e` warns
 * about: one describing a state the app cannot produce.
 *
 * A CANCELLED deal is left alone — it is withdrawn, the engine drops it, and the
 * door does not wait on it. So is a deal with no signatory (all `observer`): there
 * is nobody to sign it, which is exactly why the door skips it too.
 */
export async function signEveryAgreement(database: Database, eventId: string): Promise<void> {
  const deals = await database.select().from(schema.deals).where(eq(schema.deals.eventId, eventId));

  for (const deal of deals) {
    if (deal.status === "cancelled") continue;
    const parties = await database
      .select()
      .from(schema.dealParties)
      .where(eq(schema.dealParties.dealId, deal.id));
    const now = new Date();
    for (const party of parties) {
      if (party.roleInDeal === "observer" || party.confirmedAt) continue;
      await database
        .update(schema.dealParties)
        .set({ confirmedAt: now, confirmedBy: deal.createdBy, version: party.version + 1 })
        .where(eq(schema.dealParties.id, party.id));
    }
    const stamped = await database
      .select()
      .from(schema.dealParties)
      .where(eq(schema.dealParties.dealId, deal.id));
    // `sent`, because that is where the real confirm route finds the deal: it
    // refuses a `draft` (`assertAgreementSignable`) and `confirmDealIfComplete`
    // no-ops on one already frozen.
    await confirmDealIfComplete(database, { ...deal, agreementStatus: "sent" }, stamped, now);
  }
}
