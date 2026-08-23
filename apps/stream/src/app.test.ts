import type { Database } from "@showme/db";
import { describe, expect, it } from "vitest";
import { buildStreamApp } from "./app";
import type { PubSub } from "./pubsub";
import type { FirebaseUser, TokenVerifier } from "./token-verifier";

/**
 * The happy-path SSE stream hijacks the socket and never ends, so it can't be
 * asserted through `.inject`. These cover the auth gate that runs before the
 * hijack — the only inject-observable behaviour.
 */

const noopPubSub: PubSub = {
  subscribe: async () => async () => {},
  close: async () => {},
};

const emptyDatabase = {} as Database;

function verifierFor(user: FirebaseUser | null): TokenVerifier {
  return {
    verify: async () => {
      if (!user) {
        throw new Error("invalid token");
      }
      return user;
    },
  };
}

describe("GET /stream authentication", () => {
  it("returns 401 when the Authorization header is missing", async () => {
    const app = buildStreamApp({
      database: emptyDatabase,
      pubsub: noopPubSub,
      tokenVerifier: verifierFor({ uid: "user-a" }),
    });

    const response = await app.inject({ method: "GET", url: "/stream" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: "unauthorized", message: "Missing bearer token" },
    });
  });

  it("returns 401 when the token fails verification", async () => {
    const app = buildStreamApp({
      database: emptyDatabase,
      pubsub: noopPubSub,
      tokenVerifier: verifierFor(null),
    });

    const response = await app.inject({
      method: "GET",
      url: "/stream",
      headers: { authorization: "Bearer bad-token" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: "unauthorized", message: "Invalid token" },
    });
  });
});

describe("CORS", () => {
  const allowed = "https://app.showme.music";

  it("answers the preflight for an allowed origin", async () => {
    const app = buildStreamApp({
      database: emptyDatabase,
      pubsub: noopPubSub,
      tokenVerifier: verifierFor({ uid: "user-a" }),
      corsAllowedOrigins: [allowed],
    });

    const response = await app.inject({
      method: "OPTIONS",
      url: "/stream",
      headers: {
        origin: allowed,
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(allowed);
  });

  it("does not reflect an origin that is not allow-listed", async () => {
    const app = buildStreamApp({
      database: emptyDatabase,
      pubsub: noopPubSub,
      tokenVerifier: verifierFor({ uid: "user-a" }),
      corsAllowedOrigins: [allowed],
    });

    const response = await app.inject({
      method: "OPTIONS",
      url: "/stream",
      headers: { origin: "https://evil.example", "access-control-request-method": "GET" },
    });

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  // The regression that matters: `reply.hijack()` writes the head on the raw
  // socket, bypassing every Fastify reply hook — so @fastify/cors covers the
  // preflight but NOT the streaming response. Without the header set explicitly on
  // the hijacked write, a browser passes the preflight and then discards the stream.
  it("puts the header on the hijacked streaming response, not just the preflight", async () => {
    const app = buildStreamApp({
      database: emptyDatabase,
      pubsub: noopPubSub,
      tokenVerifier: verifierFor({ uid: "user-a" }),
      corsAllowedOrigins: [allowed],
    });
    await app.ready();

    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    try {
      const controller = new AbortController();
      const response = await fetch(`${address}/stream`, {
        headers: { authorization: "Bearer good-token", origin: allowed },
        signal: controller.signal,
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      expect(response.headers.get("access-control-allow-origin")).toBe(allowed);
      expect(response.headers.get("vary")).toBe("Origin");
      controller.abort();
    } finally {
      await app.close();
    }
  });
});
