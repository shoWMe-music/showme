import type { Database } from "@showme/db";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { PubSub } from "./pubsub";
import type { TokenVerifier } from "./token-verifier";

export interface StreamAppDependencies {
  database: Database;
  pubsub: PubSub;
  tokenVerifier: TokenVerifier;
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  // Disable proxy buffering so events flush immediately (Cloud Run / nginx).
  "X-Accel-Buffering": "no",
} as const;

function extractBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }
  return token;
}

/**
 * Build the SSE service: one authenticated `GET /stream` per user. The token is
 * verified to a `uid` (injectable `TokenVerifier`), the connection subscribes to
 * that user's Postgres channel, and each event is written as an SSE `data:` frame.
 * Cleanup unsubscribes when the client disconnects.
 *
 * Dependencies are injected so the service is testable with a fake verifier and an
 * in-memory or Testcontainers-backed pub/sub — no Firebase, no live sockets.
 */
export function buildStreamApp(dependencies: StreamAppDependencies): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/stream", async (request: FastifyRequest, reply) => {
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      return reply
        .status(401)
        .send({ error: { code: "unauthorized", message: "Missing bearer token" } });
    }

    let uid: string;
    try {
      ({ uid } = await dependencies.tokenVerifier.verify(token));
    } catch {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Invalid token" } });
    }

    // Take over the socket: Fastify no longer manages the response, and we stream
    // SSE frames directly until the client disconnects.
    reply.hijack();
    reply.raw.writeHead(200, SSE_HEADERS);
    // An opening comment establishes the stream and flushes headers.
    reply.raw.write(":ok\n\n");

    const unsubscribe = await dependencies.pubsub.subscribe(uid, (payload) => {
      reply.raw.write(`data: ${payload}\n\n`);
    });

    request.raw.on("close", () => {
      void unsubscribe();
    });
  });

  return app;
}
