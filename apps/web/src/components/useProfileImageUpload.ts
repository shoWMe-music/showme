import { postApiV1FilesUploadUrl } from "@showme/api-client";
import { useState } from "react";
import { errorMessage } from "../lib/errors";

/**
 * Putting a picture in a profile's own storage folder.
 *
 * Two legs, and the second one is the one that used not to exist anywhere for a
 * profile: the editor's image fields were text boxes labelled "Avatar image URL",
 * so a venue could only show a face it was already hosting somewhere else.
 *
 *   1. POST /files/upload-url  → a `files` row + a signed URL + the headers it
 *                                was signed with;
 *   2. PUT  <signed URL>       → the bytes, straight to storage. They never pass
 *                                through the API (PLAN.md).
 *
 * The caller then hands the returned `fileId` to `PATCH /profiles/:id`, which
 * checks the file really is this profile's before pointing at it, and mints a
 * signed read URL on every subsequent read.
 *
 * Leg 2 is the one with no server-side trace when it fails — a CORS refusal or an
 * unreachable host reaches the browser as an opaque `TypeError` — so it is named
 * explicitly in the error rather than surfacing as "Failed to fetch".
 */

/** What the picker offers. Matches the API's `photo` allow-list in `routes/files.ts`. */
export const PROFILE_IMAGE_ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic";

/**
 * A storage object name inside this profile's folder that cannot collide and
 * cannot smuggle a path segment. Same shape riders already use
 * (`profiles/<id>/riders/…`), so everything a profile owns lives under one prefix
 * — which is exactly what the API checks before it will publish the picture.
 */
function profileImagePath(profileId: string, fileName: string): string {
  const safeName = fileName.replace(/[^\w.\-]+/g, "_").slice(-80);
  return `profiles/${profileId}/media/${crypto.randomUUID()}-${safeName}`;
}

export interface ProfileImageUploadView {
  isUploading: boolean;
  error: string | null;
  clearError(): void;
  /** Upload one picture; resolves to its `files.id`, or null when it failed. */
  upload(file: File): Promise<string | null>;
}

export function useProfileImageUpload(profileId: string): ProfileImageUploadView {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File): Promise<string | null> => {
    setError(null);
    setIsUploading(true);
    try {
      const contentType = file.type || "application/octet-stream";
      const issued = await postApiV1FilesUploadUrl({
        path: profileImagePath(profileId, file.name),
        contentType,
        kind: "photo",
        sizeBytes: file.size,
        ownerProfileId: profileId,
      });

      let put: Response;
      try {
        put = await fetch(issued.uploadUrl, {
          method: "PUT",
          // Exactly the headers the API signed — storage checks them against the
          // signature, so an omitted one is a rejected upload, not a lenient one.
          headers: issued.requiredHeaders,
          body: file,
        });
      } catch (cause) {
        throw new Error(
          `Couldn't send the picture to storage — the upload URL was refused by the browser (${errorMessage(cause, "network error")}). This is usually a missing CORS policy on the storage bucket.`,
        );
      }
      if (!put.ok) throw new Error(`Storage rejected the picture (HTTP ${put.status}).`);
      return issued.fileId;
    } catch (cause) {
      setError(errorMessage(cause, "Couldn't upload that picture."));
      return null;
    } finally {
      setIsUploading(false);
    }
  };

  return { isUploading, error, clearError: () => setError(null), upload };
}
