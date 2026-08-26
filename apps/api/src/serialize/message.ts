import type { schema } from "@showme/db";
import { type ThreadScope, isOperatorViewer, threadKey } from "../lib/message-threads";

type MessageRow = typeof schema.eventMessages.$inferSelect;

export interface SerializedMessage {
  id: string;
  eventId: string;
  senderUserId: string;
  senderParticipantId: string | null;
  /** The thread this message is in: `all`, `operators`, or `party:<participantId>`. */
  threadKey: string;
  threadParticipantId: string | null;
  body: string;
  attachments: unknown;
  visibility: string;
  createdAt: string;
}

/**
 * The caller's viewing relationship to an event's threads.
 *
 * `isOperator` is the `budget.view` signal — the ceiling grants it only to managing
 * operators (host/co_host), so it cleanly separates who may read the back office.
 * `readableThreadParticipantIds` is the set of PARTY threads they stand in,
 * resolved from the participation graph by `lib/message-threads.ts`.
 */
export interface MessageViewer {
  isOperator: boolean;
  readableThreadParticipantIds: ReadonlySet<string>;
}

/**
 * Whether the caller may see a message, by the thread it is in (content.ts):
 *   - `all`       — the event room; everyone with `event.view` (already passed).
 *   - `operators` — the back office; managing operators only.
 *   - `party`     — that counterparty's thread; only the participants the thread
 *                   rule puts in it (the counterparty, their sponsor, the managing
 *                   operators when the operator IS the sponsor, and any agent a
 *                   live representation stands behind).
 *
 * Note what is deliberately gone: the old `party` case also let the SENDER through
 * on `senderUserId`, which made "party" mean "me and the operators" no matter who
 * the conversation was actually with. The sender is now a reader because they are
 * in the thread — POST refuses any thread they are not in — so the identity check
 * is redundant, and keeping it would be a second, weaker rule beside the real one.
 *
 * Filtering happens server-side; the client never receives what it may not read.
 */
export function canSeeMessage(message: MessageRow, viewer: MessageViewer): boolean {
  switch (message.visibility) {
    case "operators":
      return viewer.isOperator;
    case "party":
      return (
        message.threadParticipantId != null &&
        viewer.readableThreadParticipantIds.has(message.threadParticipantId)
      );
    default:
      return true;
  }
}

// The read-side operator signal lives with the thread rule it serves; re-exported
// here so the serializer's callers keep one import.
export { isOperatorViewer };

/** Shape a message row for the wire — timestamps as ISO strings. */
export function serializeMessage(message: MessageRow): SerializedMessage {
  return {
    id: message.id,
    eventId: message.eventId,
    senderUserId: message.senderUserId,
    senderParticipantId: message.senderParticipantId ?? null,
    threadKey: threadKey(message.visibility as ThreadScope, message.threadParticipantId),
    threadParticipantId: message.threadParticipantId ?? null,
    body: message.body,
    attachments: message.attachments ?? null,
    visibility: message.visibility,
    createdAt: message.createdAt.toISOString(),
  };
}
