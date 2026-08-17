import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { healthRoutes } from "./routes/health";
import { buildTestApp } from "./testing";

/** CORS never calls the verifier or DB — stubs are enough. */
const fakeVerifier: TokenVerifier = {
  async verify(token: string) {
    return { uid: token };
  },
};

const ORIGIN = "http://localhost:5174"; // in DEFAULT_CORS_ALLOWED_ORIGINS
let app: FastifyInstance;

beforeAll(async () => {
  app = buildTestApp({ database: {} as never, tokenVerifier: fakeVerifier }, [healthRoutes]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
});

describe("CORS policy", () => {
  it("answers preflight for an allowed origin with the full policy", async () => {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/health",
      headers: {
        origin: ORIGIN,
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(ORIGIN);
    // Auth + acting-profile headers must be permitted.
    const allowHeaders = String(response.headers["access-control-allow-headers"]).toLowerCase();
    expect(allowHeaders).toContain("authorization");
    expect(allowHeaders).toContain("x-profile-id");
    // Preflight is cached.
    expect(response.headers["access-control-max-age"]).toBe("3600");
    // Bearer-token auth → credentials mode stays OFF.
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("exposes retry-after so clients can read the rate-limit backoff", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { origin: ORIGIN },
    });
    expect(response.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(String(response.headers["access-control-expose-headers"]).toLowerCase()).toContain(
      "retry-after",
    );
  });

  it("does not reflect a disallowed origin", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { origin: "https://evil.example" },
    });
    expect(response.statusCode).toBe(200); // request still served…
    expect(response.headers["access-control-allow-origin"]).toBeUndefined(); // …but browser can't read it
  });
});
