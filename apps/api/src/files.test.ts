import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import {
  type StorageSigner,
  createLoopbackStorageSigner,
  defaultStorageSigner,
  isLoopbackStorageSigner,
} from "./lib/storage";
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
  async signUpload(path, contentType, maxBytes) {
    return {
      url: `signed-upload::${path}::${contentType}`,
      headers: { "content-type": contentType, "x-goog-content-length-range": `0,${maxBytes}` },
    };
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
        sizeBytes: 2048,
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
      payload: {
        path: "users/f-user/avatar.png",
        contentType: "image/png",
        kind: "photo",
        sizeBytes: 4096,
      },
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
        sizeBytes: 2048,
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
        sizeBytes: 2048,
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
        sizeBytes: 2048,
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

/**
 * The bytes leg. Everything above proves the API hands out a URL; none of it
 * proves a browser can PUT to that URL and get the bytes back — which is exactly
 * the gap that let "riders cannot upload" ship. The loopback signer closes it for
 * a laptop, so these tests walk the whole round trip.
 */
describe("files — the loopback object sink (local dev's stand-in for GCS)", () => {
  let loopbackApp: FastifyInstance;
  let signer: ReturnType<typeof createLoopbackStorageSigner>;

  beforeAll(async () => {
    signer = createLoopbackStorageSigner("http://api.test");
    loopbackApp = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [
      createFileRoutes(signer),
    ]);
    await loopbackApp.ready();
  });

  afterAll(async () => {
    await loopbackApp?.close();
  });

  /** The sink path a signed URL points at, as `app.inject` wants it. */
  const sinkPath = (url: string) => new URL(url).pathname;

  it("round-trips the bytes: upload URL → PUT → download URL → the same bytes", async () => {
    const owner = await seedMember("f-loop-owner", "performer");

    const issued = await loopbackApp.inject({
      method: "POST",
      url: "/api/v1/files/upload-url",
      headers: auth("f-loop-owner"),
      payload: {
        path: "profiles/f-loop-owner/riders/tech.pdf",
        contentType: "application/pdf",
        kind: "document",
        sizeBytes: 2048,
        ownerProfileId: owner.profileId,
      },
    });
    expect(issued.statusCode).toBe(201);
    const { fileId, uploadUrl, requiredHeaders } = issued.json();

    const put = await loopbackApp.inject({
      method: "PUT",
      url: sinkPath(uploadUrl),
      headers: requiredHeaders,
      payload: Buffer.from("%PDF-1.4 four wedges please"),
    });
    expect(put.statusCode).toBe(200);

    const download = await loopbackApp.inject({
      method: "GET",
      url: `/api/v1/files/${fileId}/download-url`,
      headers: auth("f-loop-owner"),
    });
    expect(download.statusCode).toBe(200);

    const bytes = await loopbackApp.inject({
      method: "GET",
      url: sinkPath(download.json().downloadUrl),
    });
    expect(bytes.statusCode).toBe(200);
    expect(bytes.body).toBe("%PDF-1.4 four wedges please");
  });

  it("refuses a PUT that drops the signed size header, exactly as GCS would", async () => {
    const upload = await signer.signUpload("profiles/x/sized.pdf", "application/pdf", 64);
    const withoutHeader = await loopbackApp.inject({
      method: "PUT",
      url: sinkPath(upload.url),
      headers: { "content-type": "application/pdf" },
      payload: Buffer.from("small enough"),
    });
    expect(withoutHeader.statusCode).toBe(400);
  });

  it("refuses a body larger than the ceiling the URL was signed for", async () => {
    const upload = await signer.signUpload("profiles/x/big.pdf", "application/pdf", 8);
    const tooBig = await loopbackApp.inject({
      method: "PUT",
      url: sinkPath(upload.url),
      headers: upload.headers,
      payload: Buffer.from("far more than eight bytes"),
    });
    expect(tooBig.statusCode).toBe(400);
  });

  it("refuses a grant id it never issued — the id IS the capability", async () => {
    const forged = await loopbackApp.inject({
      method: "GET",
      url: "/api/v1/files/local-object/definitely-not-a-real-grant",
    });
    expect(forged.statusCode).toBe(400);
  });

  it("refuses to READ with an upload grant (and vice versa)", async () => {
    const upload = await signer.signUpload("profiles/x/one.pdf", "application/pdf", 1024);
    const readWithWriteGrant = await loopbackApp.inject({
      method: "GET",
      url: sinkPath(upload.url),
    });
    expect(readWithWriteGrant.statusCode).toBe(400);

    const downloadUrl = await signer.signDownload("profiles/x/one.pdf");
    const writeWithReadGrant = await loopbackApp.inject({
      method: "PUT",
      url: sinkPath(downloadUrl),
      headers: upload.headers,
      payload: Buffer.from("nope"),
    });
    expect(writeWithReadGrant.statusCode).toBe(400);
  });

  it("404s a download whose object was never uploaded", async () => {
    const downloadUrl = await signer.signDownload("profiles/x/never-written.pdf");
    const bytes = await loopbackApp.inject({ method: "GET", url: sinkPath(downloadUrl) });
    expect(bytes.statusCode).toBe(404);
  });

  it("does NOT mount the sink when a non-loopback signer is wired", async () => {
    await seedMember("f-no-sink", "performer");
    const noSink = await app.inject({
      method: "GET",
      url: "/api/v1/files/local-object/anything",
      headers: auth("f-no-sink"),
    });
    expect(noSink.statusCode).toBe(404);
  });
});

/**
 * The signer CHOICE, which is where the production bug actually lived: with no
 * `FIREBASE_STORAGE_BUCKET` set, the old default quietly handed production the
 * TEST fake — a URL at `fake.storage.local`, a host that resolves nowhere. The
 * API answered 201 and the upload died in the browser with nothing in our logs.
 */
describe("files — defaultStorageSigner picks the right signer per environment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses (503) in production when no bucket is configured — never a URL to nowhere", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FIREBASE_STORAGE_BUCKET", "");
    const signer = defaultStorageSigner();
    await expect(signer.signUpload("some/path.pdf", "application/pdf", 1024)).rejects.toMatchObject(
      {
        statusCode: 503,
      },
    );
  });

  it("uses the loopback sink on a laptop with no bucket, so local uploads work", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FIREBASE_STORAGE_BUCKET", "");
    expect(isLoopbackStorageSigner(defaultStorageSigner())).toBe(true);
  });

  it("stays the deterministic fake under test", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("FIREBASE_STORAGE_BUCKET", "");
    const issued = await defaultStorageSigner().signUpload("a/b.pdf", "application/pdf", 1024);
    expect(issued.url).toContain("fake.storage.local");
  });
});

/**
 * The upload ALLOW-LIST. `contentType` used to be a free string, so the API would
 * sign a URL for anything a caller cared to name — onto a bucket the app later
 * links people to.
 */
describe("files — only the content types and sizes the platform actually stores", () => {
  const upload = (uid: string, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/api/v1/files/upload-url", headers: auth(uid), payload });

  it("accepts a rider PDF and a stage-plot image", async () => {
    const owner = await seedMember("f-allow", "performer");
    const cases: Array<{ contentType: string; kind: string }> = [
      { contentType: "application/pdf", kind: "document" },
      { contentType: "image/png", kind: "photo" },
      { contentType: "image/jpeg", kind: "photo" },
      { contentType: "image/webp", kind: "photo" },
    ];
    for (const { contentType, kind } of cases) {
      const response = await upload("f-allow", {
        path: `profiles/f-allow/riders/doc-${kind}-${contentType.replace("/", "-")}`,
        contentType,
        kind,
        sizeBytes: 1024,
        ownerProfileId: owner.profileId,
      });
      expect(response.statusCode, contentType).toBe(201);
    }
  });

  it("refuses a content type the platform does not store, and says what it does", async () => {
    await seedMember("f-deny-type", "performer");
    const response = await upload("f-deny-type", {
      path: "users/f-deny-type/payload.html",
      contentType: "text/html",
      kind: "document",
      sizeBytes: 10,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("application/pdf");
  });

  it("refuses a content type that belongs to a DIFFERENT kind", async () => {
    await seedMember("f-deny-kind", "performer");
    const response = await upload("f-deny-kind", {
      path: "users/f-deny-kind/not-a-photo.pdf",
      contentType: "application/pdf",
      kind: "photo",
      sizeBytes: 10,
    });
    expect(response.statusCode).toBe(400);
  });

  it('refuses "other" outright — an escape-hatch kind would make the list decorative', async () => {
    await seedMember("f-deny-other", "performer");
    const response = await upload("f-deny-other", {
      path: "users/f-deny-other/thing.bin",
      contentType: "application/octet-stream",
      kind: "other",
      sizeBytes: 10,
    });
    expect(response.statusCode).toBe(400);
  });

  it("refuses a file over the per-kind size limit", async () => {
    await seedMember("f-too-big", "performer");
    const response = await upload("f-too-big", {
      path: "users/f-too-big/huge.png",
      contentType: "image/png",
      kind: "photo",
      sizeBytes: 500 * 1024 * 1024,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("limit");
  });

  it("refuses a path that climbs out of its own prefix", async () => {
    await seedMember("f-path", "performer");
    for (const path of ["../../secrets.pdf", "/etc/passwd", "profiles//x.pdf", "a/../../b.pdf"]) {
      const response = await upload("f-path", {
        path,
        contentType: "application/pdf",
        kind: "document",
        sizeBytes: 10,
      });
      expect(response.statusCode, path).toBe(400);
    }
  });

  it("writes NO metadata row for a refused upload", async () => {
    const { db } = harness;
    await seedMember("f-no-litter", "performer");
    await upload("f-no-litter", {
      path: "users/f-no-litter/payload.html",
      contentType: "text/html",
      kind: "document",
      sizeBytes: 10,
    });
    const rows = await db
      .select()
      .from(schema.files)
      .where(eq(schema.files.ownerUserId, "f-no-litter"));
    expect(rows).toHaveLength(0);
  });

  it("hands back the headers the client must echo, including the size ceiling", async () => {
    const owner = await seedMember("f-headers", "performer");
    const response = await upload("f-headers", {
      path: "profiles/f-headers/riders/tech.pdf",
      contentType: "application/pdf",
      kind: "document",
      sizeBytes: 1024,
      ownerProfileId: owner.profileId,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().requiredHeaders).toMatchObject({
      "content-type": "application/pdf",
      "x-goog-content-length-range": "0,52428800",
    });
  });

  it("records the declared size on the metadata row", async () => {
    const { db } = harness;
    const owner = await seedMember("f-size-row", "performer");
    const response = await upload("f-size-row", {
      path: "profiles/f-size-row/riders/plot.png",
      contentType: "image/png",
      kind: "photo",
      sizeBytes: 3333,
      ownerProfileId: owner.profileId,
    });
    const [row] = await db
      .select()
      .from(schema.files)
      .where(eq(schema.files.id, response.json().fileId));
    expect(row?.sizeBytes).toBe(3333);
  });
});
