import fastifySwagger from "@fastify/swagger";
import type { Database } from "@showme/db";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import {
  type ZodTypeProvider,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { TokenVerifier } from "./auth/token-verifier";
import { HttpError } from "./errors";
import { authenticate } from "./plugins/authenticate";
import { activityRoutes } from "./routes/activity";
import { adminRoutes } from "./routes/admin";
import { budgetRoutes } from "./routes/budget";
import { calendarRoutes } from "./routes/calendar";
import { contactRoutes } from "./routes/contacts";
import { dealRoutes } from "./routes/deals";
import { eventRoutes } from "./routes/events";
import { eventListRoutes } from "./routes/events-list";
import { exchangeRateRoutes } from "./routes/exchange-rate";
import { fileRoutes } from "./routes/files";
import { groupRoutes } from "./routes/groups";
import { healthRoutes } from "./routes/health";
import { holdRoutes } from "./routes/holds";
import { inboundRoutes } from "./routes/inbound";
import { insightRoutes } from "./routes/insights";
import { invitationRoutes } from "./routes/invitations";
import { invoiceRoutes } from "./routes/invoices";
import { meRoutes } from "./routes/me";
import { messageRoutes } from "./routes/messages";
import { notificationRoutes } from "./routes/notifications";
import { participantRoutes } from "./routes/participants";
import { payoutRoutes } from "./routes/payout";
import { planRoutes } from "./routes/plans";
import { profileRoutes } from "./routes/profiles";
import { publicRoutes } from "./routes/public";
import { representationRoutes } from "./routes/representations";
import { riderRoutes } from "./routes/riders";
import { scheduleRoutes } from "./routes/schedule";
import { sessionRoutes } from "./routes/session";
import { setlistRoutes } from "./routes/setlists";
import { settlementRoutes } from "./routes/settlement";
import { shareRoutes } from "./routes/shares";
import { taskRoutes } from "./routes/tasks";
import "./types";

export interface AppDependencies {
  database: Database;
  tokenVerifier: TokenVerifier;
}

/** Typed error envelope (decisions #15): { error: { code, message, details? } }. */
export function apiErrorHandler(
  error: FastifyError,
  request: Parameters<Parameters<FastifyInstance["setErrorHandler"]>[0]>[1],
  reply: Parameters<Parameters<FastifyInstance["setErrorHandler"]>[0]>[2],
) {
  if (error instanceof HttpError) {
    return reply
      .status(error.statusCode)
      .send({ error: { code: error.code, message: error.message } });
  }
  if (error.validation) {
    return reply.status(400).send({
      error: { code: "validation", message: error.message, details: error.validation },
    });
  }
  request.log.error(error);
  return reply.status(500).send({ error: { code: "internal", message: "Internal Server Error" } });
}

/**
 * Build the API. Dependencies are injected so the whole thing is testable with a
 * fake token verifier + a Testcontainers DB (no Firebase, no HTTP). The request
 * pipeline is: authenticate (global preHandler) → per-route authorize → Zod
 * validate → handle → serialize → audit.
 */
export function buildApp(dependencies: AppDependencies): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate("database", dependencies.database);
  app.decorate("tokenVerifier", dependencies.tokenVerifier);

  // Zod is the single source of truth for validation AND serialization → OpenAPI.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.register(fastifySwagger, {
    openapi: { info: { title: "shoWMe API", version: "0.0.0" } },
    transform: jsonSchemaTransform,
  });

  app.setErrorHandler(apiErrorHandler);

  // The pipeline's front door — runs for every route unless it opts out.
  app.addHook("preHandler", authenticate);

  app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(sessionRoutes);
      await api.register(meRoutes);
      await api.register(eventRoutes);
      await api.register(eventListRoutes);
      await api.register(participantRoutes);
      await api.register(dealRoutes);
      await api.register(budgetRoutes);
      await api.register(settlementRoutes);
      await api.register(holdRoutes);
      await api.register(profileRoutes);
      await api.register(scheduleRoutes);
      await api.register(messageRoutes);
      await api.register(riderRoutes);
      await api.register(setlistRoutes);
      await api.register(taskRoutes);
      await api.register(calendarRoutes);
      await api.register(notificationRoutes);
      await api.register(contactRoutes);
      await api.register(invitationRoutes);
      await api.register(inboundRoutes);
      await api.register(shareRoutes);
      await api.register(representationRoutes);
      await api.register(planRoutes);
      await api.register(publicRoutes);
      await api.register(exchangeRateRoutes);
      await api.register(adminRoutes);
      await api.register(insightRoutes);
      await api.register(fileRoutes);
      await api.register(activityRoutes);
      await api.register(groupRoutes);
      await api.register(invoiceRoutes);
      await api.register(payoutRoutes);
    },
    { prefix: "/api/v1" },
  );

  app
    .withTypeProvider<ZodTypeProvider>()
    .get("/openapi.json", { config: { public: true }, schema: { hide: true } }, async () =>
      app.swagger(),
    );

  return app;
}
