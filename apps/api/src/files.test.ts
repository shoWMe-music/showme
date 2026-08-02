import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import type { StorageSigner } from "./lib/storage";
import { createFileRoutes } from "./routes/files";
import { buildTestApp } from "./testing";

/** Fake verifier: the bearer token IS the uid (mirrors app.test.ts). */
const fakeVerifier: TokenVerifier = {
  async verify(token: string) {
    return { uid: token, email: `${token}@example.com`, name: token };
  },
};

/** Deterministic fake signer — proves the route calls it without touching GCS. */
const fakeSigner: StorageSigner = {
  async signUpload(path, contentType) {
    return `signed-upload::${path}::${contentType}`;
  },
  async signDownload(path) {
    return `signed-download::${path}`;
  },
};

let harness: TestDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  harness = await startTestDatabase();
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [
    createFileRoutes(fakeSigner),
  ]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

/** Seed a user + owned profile + active owner membership; return the ids. */
async function seedMember(id: string, kind: "operator" | "performer") {
  const { db } = harness;
  await db.insert(schema.users).values({ id, email: `${id}@example.com`, kind });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind, ownerUserId: id, name: id, slug: id })
    .returning();
  if (!profile) throw new Error("profile seed failed");
  await db
    .insert(schema.profileMembers)
    .values({ profileId: profile.id, userId: id, role: "owner", status: "active" });
  return { profileId: profile.id };
}

describe("files — signed-URL issuance + metadata", () => {
  it("issues an upload URL for a profile the caller owns, creating an audited metadata row", async () => {
    const { db } = harness;
    const owner = await seedMember("f-owner", "performer");

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/files/upload-url",
      headers: auth("f-owner"),
      payload: {
        path: "profiles/f-owner/press-kit.pdf",
        contentType: "application/pdf",
        kind: "document",
        ownerProfileId: owner.profileId,
      },
    });
    expect(response.statusCode).toBe(201);
    const { fileId, uploadUrl } = response.json();
    expect(uploadUrl).toBe("signed-upload::profiles/f-owner/press-kit.pdf::application/pdf");

    // The metadata row exists, owned by the caller + the named profile.
    const rows = await db.select().from(schema.files).where(eq(schema.files.id, fileId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ownerUserId).toBe("f-owner");
    expect(rows[0]?.ownerProfileId).toBe(owner.profileId);
    expect(rows[0]?.path).toBe("profiles/f-owner/press-kit.pdf");

    // Audited as file.create.
    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, fileId));
    expect(audit[0]?.action).toBe("file.create");
    expect(audit[0]?.actorUserId).toBe("f-owner");
  });

  it("issues an upload URL for a bare user file (no ownerProfileId)", async () => {
    await seedMember("f-user", "performer");
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/files/upload-url",
      headers: auth("f-user"),
      payload: { path: "users/f-user/avatar.png", contentType: "image/png", kind: "photo" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().uploadUrl).toBe("signed-upload::users/f-user/avatar.png::image/png");
  });

  it("forbids uploading to a profile the caller is not an owner/admin of", async () => {
    const target = await seedMember("f-target", "performer");
    await seedMember("f-outsider", "performer");
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/files/upload-url",
      headers: auth("f-outsider"),
      payload: {
        path: "profiles/f-target/secret.pdf",
        contentType: "application/pdf",
        kind: "document",
        ownerProfileId: target.profileId,
      },
    });
    // Non-membership is a 404 (no existence leak), per requireProfileRole.
    expect(response.statusCode).toBe(404);
  });

  it("gives the owner a download URL, and 404s a stranger (no existence leak)", async () => {
    const owner = await seedMember("f-dl-owner", "performer");
    await seedMember("f-dl-stranger", "performer");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/files/upload-url",
      headers: auth("f-dl-owner"),
      payload: {
        path: "profiles/f-dl-owner/rider.pdf",
        contentType: "application/pdf",
        kind: "document",
        ownerProfileId: owner.profileId,
      },
    });
    const { fileId } = created.json();

    const asOwner = await app.inject({
      method: "GET",
      url: `/api/v1/files/${fileId}/download-url`,
      headers: auth("f-dl-owner"),
    });
    expect(asOwner.statusCode).toBe(200);
    expect(asOwner.json().downloadUrl).toBe("signed-download::profiles/f-dl-owner/rider.pdf");

    const asStranger = await app.inject({
      method: "GET",
      url: `/api/v1/files/${fileId}/download-url`,
      headers: auth("f-dl-stranger"),
    });
    expect(asStranger.statusCode).toBe(404);
  });

  it("deletes the metadata row for its owner, and audits it", async () => {
    const { db } = harness;
    const owner = await seedMember("f-del-owner", "performer");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/files/upload-url",
      headers: auth("f-del-owner"),
      payload: {
        path: "profiles/f-del-owner/old.pdf",
        contentType: "application/pdf",
        kind: "document",
        ownerProfileId: owner.profileId,
      },
    });
    const { fileId } = created.json();

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/v1/files/${fileId}`,
      headers: auth("f-del-owner"),
    });
    expect(removed.statusCode).toBe(204);

    const rows = await db.select().from(schema.files).where(eq(schema.files.id, fileId));
    expect(rows).toHaveLength(0);

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, fileId));
    expect(audit.some((row) => row.action === "file.delete")).toBe(true);
  });

  it("404s a download for a file that does not exist", async () => {
    await seedMember("f-missing", "performer");
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/files/00000000-0000-0000-0000-000000000000/download-url",
      headers: auth("f-missing"),
    });
    expect(response.statusCode).toBe(404);
  });
});
