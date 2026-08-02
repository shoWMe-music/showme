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
