import type { schema } from "@showme/db";
import type { Capability } from "@showme/shared";
import { resolveImageUrl } from "./image";

type ParticipantRow = typeof schema.eventParticipants.$inferSelect;

/**
 * The joined profile's public face. BOTH picture columns, never just one: since
 * migration 0022 the normal way to have an avatar is to have UPLOADED it
 * (`avatar_file_id`), and `avatar_url` is the legacy external address. A caller
 * that hands over only the second one is telling this serializer that every
 * performer who uploaded a picture has none.
 */
export interface ParticipantProfileFace {
  name: string | null;
  avatarFileId: string | null;
  avatarUrl: string | null;
}

export interface SerializedParticipant {
  id: string;
  profileId: string;
  /** The participant profile's display name — the public face (who's on the bill). */
  name: string | null;
  avatarUrl: string | null;
  role: string;
  status: string;
  performerTag: string | null;
  permissionSetId?: string | null;
  details?: unknown;
}

/**
 * Only the managing operators may see the roster's internals. `participants.manage`
 * is the direct signal; `budget.view` is the read-side operator signal (a co-host
 * granted budget visibility is still an operator on the event). Everyone else is an
 * arm's-length party who only sees the public face of each participant.
 */
export function canManageParticipants(capabilities: Set<Capability>): boolean {
  return capabilities.has("participants.manage") || capabilities.has("budget.view");
}

/**
 * Shape a participant by the caller's capabilities — the field-level serializer,
 * server-side (not UI hiding). An operator sees the full row (permission set +
 * `details`, which folds in crew call-time/task/pay notes). A non-operator sees
 * only the public face: who is on the bill, in what role, at what status — never
 * another participant's permission set or private details.
 */
export function serializeParticipant(
  participant: ParticipantRow,
  capabilities: Set<Capability>,
  profile?: ParticipantProfileFace | null,
  imageUrls?: Map<string, string>,
): SerializedParticipant {
  const base: SerializedParticipant = {
    id: participant.id,
    profileId: participant.profileId,
    name: profile?.name ?? null,
    // The same file-then-URL ladder every other read of a profile picture uses
    // (`serializeProfile`), so the roster cannot disagree with the profile page
    // about whose face it has. `imageUrls` is minted per response by the route.
    avatarUrl: profile ? resolveImageUrl(profile.avatarFileId, profile.avatarUrl, imageUrls) : null,
    role: participant.role,
    status: participant.status,
    performerTag: participant.performerTag,
  };

  if (canManageParticipants(capabilities)) {
    base.permissionSetId = participant.permissionSetId;
    base.details = participant.details;
  }
  return base;
}
