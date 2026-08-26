import { schema } from "@showme/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, notFound } from "../errors";
import { writeAudit } from "../lib/audit";
import { requireProfileRole } from "../lib/authorize";
import {
  CONTENT_LENGTH_RANGE_HEADER,
  LOOPBACK_OBJECT_ROUTE,
  type LoopbackObjectStore,
  type StorageSigner,
  defaultStorageSigner,
  isLoopbackStorageSigner,
} from "../lib/storage";
import { riderFileVisibleToCaller } from "./riders";

const FileParams = z.object({ id: z.string().uuid() });

const fileKindEnum = z.enum(["photo", "video", "document", "audio", "other"]);

type FileKind = z.infer<typeof fileKindEnum>;

/**
 * What may be uploaded, per kind — an ALLOW-LIST, not a filter. `contentType`
 * was a free-form string, so the route signed a URL for whatever the caller
 * named: `text/html`, `application/x-msdownload`, anything. The bytes end up on a
 * bucket the app later hands people links to, so the set of things that can live
 * there is a security boundary, not a UX nicety.
 *
 * The listed types are the ones the product actually deals in (PLAN.md "Files"):
 * rider PDFs and stage-plot images, profile photos and banners, the occasional
 * spreadsheet or audio/video asset. Anything outside is refused by name so the
 * caller learns what IS accepted rather than getting a shrug.
 *
 * `maxBytes` is per kind for the obvious reason that a 200 MB stage plot is a
 * mistake and a 200 MB live video is not. It is enforced twice — declared here
 * at issue time, and again by the storage layer through the signed URL, so a
 * client that lies about its size still cannot write the bytes.
 */
const MEGABYTE = 1024 * 1024;

const UPLOAD_POLICY: Record<FileKind, { contentTypes: readonly string[]; maxBytes: number }> = {
  photo: {
    contentTypes: [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/avif",
      "image/heic",
    ],
    maxBytes: 15 * MEGABYTE,
  },
  document: {
    contentTypes: [
      "application/pdf",
      "text/plain",
      "text/csv",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    maxBytes: 50 * MEGABYTE,
  },
  audio: {
    contentTypes: [
      "audio/mpeg",
      "audio/mp4",
      "audio/wav",
      "audio/x-wav",
      "audio/aac",
      "audio/flac",
      "audio/ogg",
    ],
    maxBytes: 200 * MEGABYTE,
  },
  video: {
    contentTypes: ["video/mp4", "video/quicktime", "video/webm"],
    maxBytes: 500 * MEGABYTE,
  },
  // Deliberately empty: `other` exists in the DB enum for rows the platform
  // inherits or reclassifies, never as an upload escape hatch. A kind that
  // accepted anything would make every list above decorative.
  other: { contentTypes: [], maxBytes: 0 },
};

/** Every content type the platform accepts, for the "here is what IS allowed" message. */
const ALL_ALLOWED_CONTENT_TYPES = Object.values(UPLOAD_POLICY).flatMap(
  (policy) => policy.contentTypes,
);

/**
 * The object path a caller asked for, made safe. The path is client-supplied and
 * ends up as a storage object name, so `..` segments and absolute paths must not
 * survive it — a signed URL for `profiles/../../secrets` is a signed URL for
 * someone else's object.
 */
function assertSafePath(path: string): void {
  const segments = path.split("/");
  if (
    path.startsWith("/") ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw badRequest("Invalid storage path");
  }
}

/**
 * The object must live in the CALLER'S OWN folder.
 *
 * `assertSafePath` above only stops traversal, and `requireProfileRole` below only
 * checks the caller's standing on the profile they NAME as owner. Neither looks at
 * `path`, which is a free-form string — so an authenticated caller could name their
 * own profile as owner and ask for a signed WRITE url for
 * `profiles/<someone-else>/riders/tech.pdf`. Signed, that is permission to
 * overwrite the bytes behind another act's rider while the `files` row still points
 * at them: content substitution on the most sensitive artifact on an event.
 *
 * The prefix is not a convention this function invents — it is the one every writer
 * already uses (`storagePath` in `useRiderUpload.ts`, and profile media): a
 * profile's objects live under `profiles/<profileId>/`, and a bare user file under
 * `users/<userId>/`. Requiring it here is what makes the folder mean something.
 */
function assertPathIsOwnFolder(
  path: string,
  userId: string,
  ownerProfileId: string | null | undefined,
): void {
  const expected = ownerProfileId ? `profiles/${ownerProfileId}/` : `users/${userId}/`;
  if (!path.startsWith(expected)) {
    throw badRequest(
      `A ${ownerProfileId ? "profile" : "user"} file must be stored under ${expected}`,
    );
  }
}

/** Refuse an upload the platform will not store, saying what it would store instead. */
function assertUploadAllowed(kind: FileKind, contentType: string, sizeBytes: number): void {
  const policy = UPLOAD_POLICY[kind];
  const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!policy.contentTypes.includes(normalized)) {
    throw badRequest(
      `Files of type "${contentType}" can't be uploaded as ${kind}. Accepted types: ${ALL_ALLOWED_CONTENT_TYPES.join(", ")}.`,
    );
  }
  if (sizeBytes > policy.maxBytes) {
    throw badRequest(
      `That file is ${Math.ceil(sizeBytes / MEGABYTE)} MB — the limit for a ${kind} is ${Math.floor(policy.maxBytes / MEGABYTE)} MB.`,
    );
  }
}

const UploadUrlBody = z.object({
  path: z.string().min(1).max(1024),
  contentType: z.string().min(1),
  kind: fileKindEnum,
  /** Byte length of the file being uploaded — checked here AND at the storage layer. */
  sizeBytes: z.number().int().positive(),
  /** When set, the file belongs to a profile — the caller must own/admin it. */
  ownerProfileId: z.string().uuid().optional(),
});

const UploadUrlResponse = z.object({
  fileId: z.string(),
  uploadUrl: z.string(),
  /**
   * Headers the client MUST send on the PUT. They are part of what was signed,
   * so storage rejects the write if they are missing or different — that is what
   * makes the size limit real rather than a promise the browser made.
   */
  requiredHeaders: z.record(z.string(), z.string()),
});
const DownloadUrlResponse = z.object({ downloadUrl: z.string() });

/** Roles on a profile that may attach/manage its files. */
const FILE_WRITE_ROLES = ["owner", "admin"] as const;

type FileRow = typeof schema.files.$inferSelect;

/** Fetch a file by id or 404 — the row that carries the ownership for authorization. */
async function loadFile(request: FastifyRequest, fileId: string): Promise<FileRow> {
  const [file] = await request.server.database
    .select()
    .from(schema.files)
    .where(eq(schema.files.id, fileId));
  if (!file) throw notFound("File not found");
  return file;
}

/**
 * May the caller READ this file? Three ways in, checked cheapest first:
 *   1. they uploaded it;
 *   2. they are an active member of the profile that owns it;
 *   3. a RIDER they are allowed to see points at it (decisions #12).
 *
 * (3) is not a convenience. A rider is submitted BY the performer TO the
 * operator, so the party who most needs the bytes is by definition not a member
 * of the profile that owns them — with only (1) and (2), the operator could read
 * the rider's name in the API and never open the PDF. The rider's own visibility
 * rule is the designed one; the file inherits it rather than inventing a second,
 * weaker answer.
 */
async function canReadFile(request: FastifyRequest, file: FileRow): Promise<boolean> {
  const principal = request.principal;
  if (!principal) return false;
  if (file.ownerUserId === principal.userId) return true;
  if (
    file.ownerProfileId != null &&
    principal.memberships.some((membership) => membership.profileId === file.ownerProfileId)
  ) {
    return true;
  }
  return riderFileVisibleToCaller(request, file.id);
}

/**
 * May the caller DELETE this file? The owner user, or an owner/admin of the owning
 * profile. Narrower than read — a plain profile viewer can fetch but not remove.
 */
function canDeleteFile(request: FastifyRequest, file: FileRow): boolean {
  const principal = request.principal;
  if (!principal) return false;
  if (file.ownerUserId === principal.userId) return true;
  return (
    file.ownerProfileId != null &&
    principal.memberships.some(
      (membership) =>
        membership.profileId === file.ownerProfileId &&
        (FILE_WRITE_ROLES as readonly string[]).includes(membership.role),
    )
  );
}

/**
 * The object sink the LOOPBACK signer's URLs point at — mounted only when that
 * signer is in use (a laptop with no GCS bucket), never in production and never
 * under test. It stands in for GCS, so it is authorized exactly the way GCS is:
 * by the signature in the URL and nothing else — hence `public: true`, which
 * skips the bearer-token preHandler. A browser PUTs bytes here and later GETs
 * them back, which is what makes the upload flow provable without a bucket.
 *
 * Registered as its OWN encapsulated plugin so its catch-all body parser (the
 * bytes can be any content type) cannot leak onto the JSON routes beside it.
 */
function createLoopbackObjectSink(
  objects: LoopbackObjectStore,
): (fastify: FastifyInstance) => Promise<void> {
  return async function loopbackObjectSink(fastify: FastifyInstance): Promise<void> {
    fastify.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) => {
      done(null, body);
    });

    fastify.put<{ Params: { grantId: string } }>(
      LOOPBACK_OBJECT_ROUTE,
      { config: { public: true }, schema: { hide: true } },
      async (request, reply) => {
        const grant = objects.redeem(request.params.grantId);
        if (!grant || grant.action !== "write") throw badRequest("Invalid or expired upload URL");
        const bytes = request.body;
        if (!Buffer.isBuffer(bytes)) throw badRequest("Expected a request body");
        // Stand in for GCS exactly, including its pickiness: the size ceiling is
        // part of what was signed, so a client that omits the header would be
        // rejected in production and must be rejected here — otherwise the one
        // environment that can catch that bug is the one that has real users.
        if (request.headers[CONTENT_LENGTH_RANGE_HEADER] !== `0,${grant.maxBytes}`) {
          throw badRequest(`Missing or altered ${CONTENT_LENGTH_RANGE_HEADER} header`);
        }
        if (bytes.byteLength > grant.maxBytes) {
          throw badRequest(
            `Object exceeds the ${grant.maxBytes}-byte limit this URL was signed for`,
          );
        }
        objects.put(grant.path, { contentType: grant.contentType, bytes });
        return reply.status(200).send();
      },
    );

    fastify.get<{ Params: { grantId: string } }>(
      LOOPBACK_OBJECT_ROUTE,
      { config: { public: true }, schema: { hide: true } },
      async (request, reply) => {
        const grant = objects.redeem(request.params.grantId);
        if (!grant || grant.action !== "read") throw badRequest("Invalid or expired download URL");
        const object = objects.get(grant.path);
        if (!object) throw notFound("Object not found");
        return reply.type(object.contentType).send(object.bytes);
      },
    );
  };
}

/**
 * File routes bound to a specific `StorageSigner`. Production injects the real
 * `firebase-admin` signer; tests inject a deterministic fake. Bytes never pass
 * through the API — it authorizes access to the metadata row and issues a signed
 * URL for the client to talk to GCS directly.
 */
export function createFileRoutes(
  signer: StorageSigner,
): (fastify: FastifyInstance) => Promise<void> {
  return async function fileRoutesPlugin(fastify: FastifyInstance): Promise<void> {
    const app = fastify.withTypeProvider<ZodTypeProvider>();

    if (isLoopbackStorageSigner(signer)) {
      await fastify.register(createLoopbackObjectSink(signer.objects));
    }

    // Issue an upload URL — create the metadata row, then sign. For a profile file
    // the caller must own/admin the profile; a bare user file needs only a session.
    app.post(
      "/files/upload-url",
      { schema: { body: UploadUrlBody, response: { 201: UploadUrlResponse } } },
      async (request, reply) => {
        const { database } = request.server;
        const principal = request.principal;
        if (!principal) throw new Error("principal missing after authentication");
        const body = request.body;

        // Refuse before anything is written: a metadata row for an upload that
        // was never going to be allowed is litter with a `files.id` attached.
        assertSafePath(body.path);
        assertPathIsOwnFolder(body.path, principal.userId, body.ownerProfileId);
        assertUploadAllowed(body.kind, body.contentType, body.sizeBytes);

        if (body.ownerProfileId) {
          requireProfileRole(request, body.ownerProfileId, [...FILE_WRITE_ROLES]);
        }

        const created = await database.transaction(async (tx) => {
          const [file] = await tx
            .insert(schema.files)
            .values({
              path: body.path,
              kind: body.kind,
              contentType: body.contentType,
              sizeBytes: body.sizeBytes,
              ownerUserId: principal.userId,
              ownerProfileId: body.ownerProfileId ?? null,
            })
            .returning();
          if (!file) throw new Error("file create failed");
          await writeAudit(tx, request, {
            capability: "profile.edit",
            action: "file.create",
            targetKind: "file",
            targetId: file.id,
            after: file,
          });
          return file;
        });

        const issued = await signer.signUpload(
          created.path,
          created.contentType ?? body.contentType,
          UPLOAD_POLICY[body.kind].maxBytes,
        );
        return reply
          .status(201)
          .send({ fileId: created.id, uploadUrl: issued.url, requiredHeaders: issued.headers });
      },
    );

    // Issue a download URL — load, authorize read (owner user or profile member),
    // then sign. A caller with no access gets a 404, never an existence leak.
    app.get(
      "/files/:id/download-url",
      { schema: { params: FileParams, response: { 200: DownloadUrlResponse } } },
      async (request) => {
        const file = await loadFile(request, request.params.id);
        if (!(await canReadFile(request, file))) throw notFound("File not found");
        const downloadUrl = await signer.signDownload(file.path);
        return { downloadUrl };
      },
    );

    // Delete the metadata row (owner user or profile owner/admin). The bytes in GCS
    // are left for a reaper to sweep — a non-owner sees a 404, not a 403.
    // TODO(reaper): enqueue the orphaned Storage object at `file.path` for deletion.
    app.delete("/files/:id", { schema: { params: FileParams } }, async (request, reply) => {
      const { database } = request.server;
      const file = await loadFile(request, request.params.id);
      if (!canDeleteFile(request, file)) throw notFound("File not found");

      await database.transaction(async (tx) => {
        await tx.delete(schema.files).where(eq(schema.files.id, file.id));
        await writeAudit(tx, request, {
          capability: "profile.edit",
          action: "file.delete",
          targetKind: "file",
          targetId: file.id,
          before: file,
        });
      });

      return reply.status(204).send();
    });
  };
}

/**
 * The default plugin, wired to `defaultStorageSigner()` (the real `firebase-admin`
 * signer in production, a deterministic fake in tests / credential-less dev). To
 * inject a specific signer — real or fake — use `createFileRoutes(signer)`.
 */
export async function fileRoutes(fastify: FastifyInstance): Promise<void> {
  return createFileRoutes(defaultStorageSigner())(fastify);
}
