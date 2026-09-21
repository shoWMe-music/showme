import { describe, expect, it } from "vitest";
import { loadEnv } from "./config";

/**
 * THE CONNECTION STRING CLOUD RUN ACTUALLY PASSES (2026-09-21).
 *
 * This service failed its first deploy because `DATABASE_URL` was validated with
 * `z.string().url()`. Cloud SQL's socket form names the instance in a query
 * parameter and carries NO HOST, which `new URL()` — and therefore Zod — rejects.
 * The container exited before binding PORT, and Cloud Run reported only the
 * generic "failed to start and listen on the port", which points nowhere near the
 * cause.
 *
 * The API has always accepted this string from the same secret. These pin the
 * agreement, so the stream cannot drift back to being stricter than the database
 * it connects to.
 */
const base = { FIREBASE_PROJECT_ID: "demo", PORT: "8080" };

describe("DATABASE_URL accepts every shape Postgres hands us", () => {
  it("takes the Cloud SQL unix-socket form — no host, instance in a query param", () => {
    const env = loadEnv({
      ...base,
      DATABASE_URL:
        "postgresql://postgres:pw@/showme?host=/cloudsql/prod-showme:europe-north2:showme-production-db",
    });
    expect(env.DATABASE_URL).toContain("/cloudsql/");
  });

  it("still takes an ordinary host:port URL, which is what local dev uses", () => {
    const env = loadEnv({
      ...base,
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:55432/showme",
    });
    expect(env.DATABASE_URL).toContain("127.0.0.1");
  });

  it("takes a password containing characters that are not URL-safe", () => {
    // The production secret has `+` and `$` in it; a stricter parser is one more
    // way to reject a string Postgres is perfectly happy with.
    const env = loadEnv({
      ...base,
      DATABASE_URL: "postgresql://postgres:MZ+9s$jQ@/showme?host=/cloudsql/p:r:i",
    });
    expect(env.DATABASE_URL).toContain("$");
  });

  it("still refuses an empty one — the variable is required", () => {
    expect(() => loadEnv({ ...base, DATABASE_URL: "" })).toThrow();
  });
});
