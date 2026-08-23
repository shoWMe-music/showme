import fastifyCors from "@fastify/cors";
import type { Database } from "@showme/db";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { PubSub } from "./pubsub";
import type { TokenVerifier } from "./token-verifier";

export interface StreamAppDependencies {
  database: Database;
  pubsub: PubSub;
  tokenVerifier: TokenVerifier;
  /**
   * Origins allowed to open a stream. REQUIRED for any browser client: the web app
   * sends `Authorization`, which makes the request non-simple, so the browser
   * preflights — and a preflight without CORS headers fails before the stream is
   * ever reached. Empty/undefined means no browser origin can connect (curl and
   * server-to-server still can), which is the safe default rather than `*`.
   */
  corsAllowedOrigins?: string[];
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  // Disable proxy buffering so events flush immediately (Cloud Run / nginx).
  "X-Accel-Buffering": "no",
} as const;

/**
 * CORS headers for the streaming response, which `@fastify/cors` cannot supply.
 * The handler calls `reply.hijack()` and writes the head on the raw socket, which
 * bypasses every Fastify reply hook — so the plugin covers the OPTIONS preflight
 * but the actual GET would come back without `Access-Control-Allow-Origin`, and
 * the browser discards it. The plugin and this must therefore agree on the
 * allow-list. Same explicit-origin rule: reflect only a listed origin, never `*`.
 */
function streamCorsHeaders(
  origin: string | undefined,
  allowedOrigins: string[],
): Record<string, string> {
  if (!origin || !allowedOrigins.includes(origin)) {
    return {};
  }
  return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
}

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

  // Mirrors the API's policy (apps/api/src/app.ts `corsOptions`): an explicit
  // allow-list, never `*`; `credentials: false` because auth is a bearer token in a
  // header, not cookies. Only GET is needed — the client never posts here.
  const origins = dependencies.corsAllowedOrigins ?? [];
  if (origins.length > 0) {
    app.register(fastifyCors, {
      origin: origins,
      credentials: false,
      methods: ["GET", "OPTIONS"],
      allowedHeaders: ["authorization"],
      maxAge: 3600,
    });
  }

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
    reply.raw.writeHead(200, {
      ...SSE_HEADERS,
      ...streamCorsHeaders(request.headers.origin, origins),
    });
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
