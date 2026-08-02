import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { meRoutes } from "./routes/me";
import { buildTestApp } from "./testing";

const fakeVerifier: TokenVerifier = {
  async verify(token: string) {
    return { uid: token, email: `${token}@example.com`, name: token };
  },
};

let harness: TestDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  harness = await startTestDatabase();
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [meRoutes]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

async function seedUser(id: string) {
  const { db } = harness;
  await db
    .insert(schema.users)
    .values({ id, email: `${id}@example.com`, kind: "performer", name: id });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind: "performer", ownerUserId: id, name: id, slug: id })
    .returning();
  if (!profile) throw new Error("profile seed failed");
  await db
    .insert(schema.profileMembers)
    .values({ profileId: profile.id, userId: id, role: "owner", status: "active" });
  return { userId: id, profileId: profile.id };
}

describe("me", () => {
  it("GET /me reflects the authenticated principal", async () => {
    await seedUser("me-basic");
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: auth("me-basic"),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().userId).toBe("me-basic");
  });

  it("GET /me/export gathers the caller's PII across the inventory and audits it", async () => {
    const { db } = harness;
    const me = await seedUser("me-export");
    // A profile-scoped PII row (payout account) so the export gathers more than `users`.
    await db.insert(schema.payoutAccounts).values({
      profileId: me.profileId,
      type: "iban",
      identifier: "SE0000000000000000000000",
      holderName: "Export Me",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/me/export",
      headers: auth("me-export"),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.userId).toBe("me-export");
    expect(typeof body.exportedAt).toBe("string");
    // The user's own identity PII.
    expect(body.data.users?.[0]).toMatchObject({ email: "me-export@example.com" });
    // Profile-scoped PII, matched via the user's owned profile.
    expect(body.data.payout_accounts?.[0]).toMatchObject({
      identifier: "SE0000000000000000000000",
    });

    // The access is itself audited (a subject-access request is a processing event).
    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.actorUserId, "me-export"));
    expect(audit.some((row) => row.action === "gdpr.export")).toBe(true);
  });

  it("POST /me/erase anonymizes the caller and audits it", async () => {
    const { db } = harness;
    const me = await seedUser("me-erase");
    // Profile-scoped PII so erasure has personal content to remove.
    await db.insert(schema.payoutAccounts).values({
      profileId: me.profileId,
      type: "iban",
      identifier: "SE1111111111111111111111",
      holderName: "Erase Me",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/me/erase",
      headers: auth("me-erase"),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ erased: true });

    // Identity tombstoned: PII overwritten, name nulled, anonymized_at set.
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, "me-erase"));
    expect(user?.email).toBe("anonymized+me-erase@deleted.invalid");
    expect(user?.name).toBeNull();
    expect(user?.anonymizedAt).toBeInstanceOf(Date);

    // The erasure is itself audited.
    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.actorUserId, "me-erase"));
    expect(audit.some((row) => row.action === "gdpr.erase")).toBe(true);
  });
});
