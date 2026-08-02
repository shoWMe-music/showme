import { schema } from "@showme/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { notFound } from "../errors";
import { writeAudit } from "../lib/audit";
import { requireProfileRole } from "../lib/authorize";
import { type StorageSigner, defaultStorageSigner } from "../lib/storage";

const FileParams = z.object({ id: z.string().uuid() });

const fileKindEnum = z.enum(["photo", "video", "document", "audio", "other"]);

const UploadUrlBody = z.object({
  path: z.string().min(1),
  contentType: z.string().min(1),
  kind: fileKindEnum,
  /** When set, the file belongs to a profile — the caller must own/admin it. */
  ownerProfileId: z.string().uuid().optional(),
});

const UploadUrlResponse = z.object({ fileId: z.string(), uploadUrl: z.string() });
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
 * May the caller READ this file? Owner user always; else any active member of the
 * owning profile (memberships live on the principal). Kept a pure predicate so
 * both the download route and its 404-on-deny share one rule.
 */
function canReadFile(request: FastifyRequest, file: FileRow): boolean {
  const principal = request.principal;
  if (!principal) return false;
  if (file.ownerUserId === principal.userId) return true;
  return (
    file.ownerProfileId != null &&
    principal.memberships.some((membership) => membership.profileId === file.ownerProfileId)
  );
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

        const uploadUrl = await signer.signUpload(
          created.path,
          created.contentType ?? body.contentType,
        );
        return reply.status(201).send({ fileId: created.id, uploadUrl });
      },
    );

    // Issue a download URL — load, authorize read (owner user or profile member),
    // then sign. A caller with no access gets a 404, never an existence leak.
    app.get(
      "/files/:id/download-url",
      { schema: { params: FileParams, response: { 200: DownloadUrlResponse } } },
      async (request) => {
        const file = await loadFile(request, request.params.id);
        if (!canReadFile(request, file)) throw notFound("File not found");
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
