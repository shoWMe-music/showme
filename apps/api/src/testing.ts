import fastifyCors from "@fastify/cors";
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
import { createNoopEmailSink } from "./lib/email";
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
