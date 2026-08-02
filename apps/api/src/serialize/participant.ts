import type { schema } from "@showme/db";
import type { Capability } from "@showme/shared";

type ParticipantRow = typeof schema.eventParticipants.$inferSelect;

export interface SerializedParticipant {
  id: string;
  profileId: string;
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
): SerializedParticipant {
  const base: SerializedParticipant = {
    id: participant.id,
    profileId: participant.profileId,
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
