import {
  getGetApiV1EventsIdRidersQueryKey,
  postApiV1EventsIdRiders,
  postApiV1FilesUploadUrl,
  postApiV1ProfilesIdRiders,
  useGetApiV1EventsIdParticipants,
  useGetApiV1Me,
} from "@showme/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { getActiveProfileId } from "../lib/activeProfile";
import { errorMessage } from "../lib/errors";

/**
 * Attaching a rider to an event, all four legs of it.
 *
 * A rider is a FILE plus a library entry plus an event instance, and the API
 * keeps those three deliberately separate (the library entry is reusable across
 * shows — decisions #16.18). Nothing in the app joined them up, so the Upload
 * button sat disabled and the honest answer to "riders cannot upload" was that
 * no browser code had ever PUT a byte. This hook is that missing leg:
 *
 *   1. POST /files/upload-url   → a metadata row + a signed URL
 *   2. PUT  <signed URL>        → the bytes, straight to storage (never via the API)
 *   3. POST /profiles/:id/riders → the reusable LIBRARY rider, carrying the file
 *   4. POST /events/:id/riders   → the instance attached to this show
 *
 * Step 2 is the one that has no server-side trace when it fails — a CORS refusal
 * or an unreachable host surfaces in the browser as an opaque `TypeError`. So it
 * is named explicitly in the error, because "Failed to fetch" against a bucket
 * misconfiguration is a sentence nobody can act on.
 */

/**
 * Which `files.kind` a browser MIME type belongs to (the API's enum). The API
 * holds the real allow-list and refuses anything outside it — this only routes a
 * type to the right bucket so the refusal, when it comes, is about the type and
 * not about a mismatched kind.
 */
function fileKindFor(contentType: string): "photo" | "video" | "document" | "audio" {
  if (contentType.startsWith("image/")) return "photo";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  return "document";
}

/**
 * What the file picker offers. Kept in step with the API's allow-list — a picker
 * that lets someone choose a `.exe` and then shows them a 400 is a worse version
 * of the same rule.
 */
export const RIDER_FILE_ACCEPT =
  "application/pdf,image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,text/plain,text/csv,.doc,.docx,.xls,.xlsx";

/** A storage object name that can't collide and can't smuggle a path segment. */
function storagePath(profileId: string, fileName: string): string {
  const safeName = fileName.replace(/[^\w.\-]+/g, "_").slice(-80);
  return `profiles/${profileId}/riders/${crypto.randomUUID()}-${safeName}`;
}

export const RIDER_TYPES = [
  { value: "tech", label: "Tech rider" },
  { value: "hospitality", label: "Hospitality rider" },
  { value: "stage_plot", label: "Stage plot" },
  { value: "input_list", label: "Input list" },
] as const;

export type RiderType = (typeof RIDER_TYPES)[number]["value"];

export interface RiderUploadView {
  /** The profile the rider is filed under — the one the caller stands behind here. */
  ownerProfileId: string | null;
  /**
   * May this caller attach a rider to this event at all? True when they are on
   * the bill as something other than the operator — a rider is the act's own
   * document (decisions #12), so the host has no rider of their own to submit.
   * The API decides for real; this only keeps the button from lying.
   */
  canSubmit: boolean;
  isUploading: boolean;
  error: string | null;
  upload(input: { file: File; name: string; type: RiderType }): Promise<boolean>;
  clearError(): void;
}

/** Event roles whose participant HAS a rider — everyone but the managing operator. */
const RIDER_BEARING_ROLES = new Set(["performer", "support", "agent", "crew", "crew_lead"]);

export function useRiderUpload(eventId: string): RiderUploadView {
  const queryClient = useQueryClient();
  const me = useGetApiV1Me();
  const participants = useGetApiV1EventsIdParticipants(eventId);
  const [error, setError] = useState<string | null>(null);

  // The profile the caller stands behind ON THIS EVENT. Mirrors the API's
  // `resolveCallerParticipant`: prefer the acting profile, else the first
  // participation the caller is a member of — so the rider is filed under the act
  // that is actually on the bill, not under whichever profile the sidebar shows.
  const myProfileIds = new Set((me.data?.memberships ?? []).map((one) => one.profileId));
  const mine = (participants.data ?? []).filter(
    (party) => myProfileIds.has(party.profileId) && RIDER_BEARING_ROLES.has(party.role),
  );
  const acting = getActiveProfileId();
  const participant = mine.find((party) => party.profileId === acting) ?? mine[0];
  const ownerProfileId = participant?.profileId ?? null;

  const mutation = useMutation({
    mutationFn: async (input: { file: File; name: string; type: RiderType }) => {
      if (!ownerProfileId) throw new Error("You are not on this event as an act.");
      const contentType = input.file.type || "application/octet-stream";

      const issued = await postApiV1FilesUploadUrl({
        path: storagePath(ownerProfileId, input.file.name),
        contentType,
        kind: fileKindFor(contentType),
        sizeBytes: input.file.size,
        ownerProfileId,
      });

      // Straight to storage — the bytes never touch the API (PLAN.md). This is
      // the leg a bucket without a CORS policy kills, so say which leg it was.
      let put: Response;
      try {
        put = await fetch(issued.uploadUrl, {
          method: "PUT",
          // Exactly the headers the API signed — storage checks them against the
          // signature, so an omitted one is a rejected upload, not a lenient one.
          headers: issued.requiredHeaders,
          body: input.file,
        });
      } catch (cause) {
        throw new Error(
          `Couldn't send the file to storage — the upload URL was refused by the browser (${errorMessage(cause, "network error")}). This is usually a missing CORS policy on the storage bucket.`,
        );
      }
      if (!put.ok) {
        throw new Error(`Storage rejected the file (HTTP ${put.status}).`);
      }

      const libraryRider = await postApiV1ProfilesIdRiders(ownerProfileId, {
        type: input.type,
        name: input.name,
        fileId: issued.fileId,
      });

      return postApiV1EventsIdRiders(eventId, { sourceRiderId: libraryRider.id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetApiV1EventsIdRidersQueryKey(eventId) });
    },
  });

  return {
    ownerProfileId,
    canSubmit: ownerProfileId != null,
    isUploading: mutation.isPending,
    error,
    clearError: () => setError(null),
    upload: async (input) => {
      setError(null);
      try {
        await mutation.mutateAsync(input);
        return true;
      } catch (cause) {
        setError(errorMessage(cause, "Couldn't attach the rider."));
        return false;
      }
    },
  };
}
