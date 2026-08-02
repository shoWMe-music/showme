import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

/** Liveness probe — public, no auth. */
export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.withTypeProvider<ZodTypeProvider>().get(
    "/health",
    {
      config: { public: true },
      schema: { response: { 200: z.object({ status: z.literal("ok") }) } },
    },
    async () => ({ status: "ok" as const }),
  );
}
