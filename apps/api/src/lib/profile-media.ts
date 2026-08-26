import { schema } from "@showme/db";
import { inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { badRequest } from "../errors";
import type { Transaction } from "./audit";
import type { StorageSigner } from "./storage";

/**
 * A profile's pictures, between the `files` table and the wire.
 *
 * Two jobs, and they are the same rule read from each end:
 *
 *   WRITING — a picture may only be attached to the profile whose storage folder
 *   it is in. `POST /files/upload-url` already checks that the caller may write
 *   for `ownerProfileId`, but it takes the object PATH from the client, so the
 *   row and the folder are two separate claims. `assertProfileImageFiles` makes
 *   the profile prove both before it points at a file.
 *
 *   READING — the bytes are never public and the API never proxies them, so what
 *   goes on the wire is a signed URL minted for this response. Fifteen minutes
 *   later it stops working, which is why the FILE ID is what gets stored and the
 *   URL is computed on every read.
 */

/**
 * The storage prefix a profile's own objects live under. Riders already write
 * `profiles/<id>/riders/<uuid>-<name>` (`apps/web/src/components/useRiderUpload.ts`);
 * profile pictures use `profiles/<id>/media/…` under the same roof, so "this
 * profile's folder" is one prefix for everything it owns.
 */
export function profileStoragePrefix(profileId: string): string {
  return `profiles/${profileId}/`;
}

/** Reads run on the request database or inside the PATCH's own transaction. */
type Database = FastifyInstance["database"] | Transaction;

/** The image kinds a profile picture may be. `files.kind` calls every image a photo. */
const PROFILE_IMAGE_FILE_KIND = "photo";

/**
 * Every file id a profile is about to point at, checked against that profile.
 *
 * Three things must hold, and a failure is a 400 naming the file rather than a
 * 404, because the caller DID name a real thing — it just is not theirs to hang
 * on this profile:
 *   * the row exists;
 *   * it is owned by this profile (`files.owner_profile_id`);
 *   * its object path is inside this profile's storage folder.
 *
 * The last one is not redundant. `files.path` arrives from the client, so a row
 * can claim one owner and point at another profile's object; without this check
 * a profile could publish a picture out of somebody else's folder.
 */
export async function assertProfileImageFiles(
  database: Database,
  profileId: string,
  fileIds: string[],
): Promise<void> {
  const wanted = [...new Set(fileIds)];
  if (wanted.length === 0) return;

  const rows = await database
    .select({
      id: schema.files.id,
      kind: schema.files.kind,
      path: schema.files.path,
      ownerProfileId: schema.files.ownerProfileId,
    })
    .from(schema.files)
    .where(inArray(schema.files.id, wanted));

  const byId = new Map(rows.map((row) => [row.id, row]));
  const prefix = profileStoragePrefix(profileId);
  for (const fileId of wanted) {
    const file = byId.get(fileId);
    if (!file || file.ownerProfileId !== profileId || !file.path.startsWith(prefix)) {
      throw badRequest(`File ${fileId} was not uploaded to this profile.`);
    }
    if (file.kind !== PROFILE_IMAGE_FILE_KIND) {
      throw badRequest(`File ${fileId} is not an image.`);
    }
  }
}

/**
 * `fileId → signed download URL`, for every id given. A file whose row has
 * vanished is simply absent from the map — the serializer then renders that
 * picture as missing, which is the truth, rather than a broken `<img>`.
 */
export async function signProfileImageUrls(
  database: Database,
  signer: StorageSigner,
  fileIds: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(fileIds.filter((fileId): fileId is string => Boolean(fileId)))];
  const signed = new Map<string, string>();
  if (wanted.length === 0) return signed;

  const rows = await database
    .select({ id: schema.files.id, path: schema.files.path })
    .from(schema.files)
    .where(inArray(schema.files.id, wanted));

  await Promise.all(
    rows.map(async (row) => {
      signed.set(row.id, await signer.signDownload(row.path));
    }),
  );
  return signed;
}
