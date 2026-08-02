import type { schema } from "@showme/db";
import type { Capability } from "@showme/shared";

type MessageRow = typeof schema.eventMessages.$inferSelect;

export interface SerializedMessage {
  id: string;
  eventId: string;
  senderUserId: string;
  senderParticipantId: string | null;
  body: string;
  attachments: unknown;
  visibility: string;
  createdAt: string;
}

/**
 * The caller's viewing relationship to an event's messages. `isOperator` is the
 * `budget.view` signal — the ceiling grants it only to managing operators
 * (host/co_host), so it cleanly separates who may read `operators`-only notes.
 * `userId` identifies the caller as a possible message sender (for `party`).
 */
export interface MessageViewer {
  isOperator: boolean;
  userId: string;
}

/**
 * Whether the caller may see a message, by its `visibility` (content.ts):
 *   - `all`       — everyone with `event.view` (the caller already passed it).
 *   - `operators` — only managing operators (`budget.view`).
 *   - `party`     — operators, plus the message's own sender.
 * Filtering happens server-side; the client never receives what it may not read.
 */
export function canSeeMessage(message: MessageRow, viewer: MessageViewer): boolean {
  switch (message.visibility) {
    case "operators":
      return viewer.isOperator;
    case "party":
      return viewer.isOperator || message.senderUserId === viewer.userId;
    default:
      return true;
  }
}

/** `budget.view` is the read-side operator signal (a co-host granted budget visibility). */
export function isOperatorViewer(capabilities: Set<Capability>): boolean {
  return capabilities.has("budget.view");
}

/** Shape a message row for the wire — timestamps as ISO strings. */
export function serializeMessage(message: MessageRow): SerializedMessage {
  return {
    id: message.id,
    eventId: message.eventId,
    senderUserId: message.senderUserId,
    senderParticipantId: message.senderParticipantId ?? null,
    body: message.body,
    attachments: message.attachments ?? null,
    visibility: message.visibility,
    createdAt: message.createdAt.toISOString(),
  };
}
