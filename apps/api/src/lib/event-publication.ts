import type { Database } from "@showme/db";
import { eventParticipantRecipients, notifyUsers } from "@showme/db/notify";
import type { FastifyRequest } from "fastify";

/**
 * A SHOW GOING PUBLIC, OR GOING DARK — who is told, and in what words.
 *
 * ClickUp `123qy9rpe3q`: *"Publishing notifies the other side and publishes for
 * both."* Until now it notified nobody. It wrote an `event.published` line into the
 * event's history, which is the record of who did it and when — and a timeline entry
 * is something you find, not something that reaches you. The act being announced is
 * the one act on an event whose result a STRANGER can see, and the performer whose
 * name and date are now on a public page learned nothing.
 *
 * ## Why this is a module and not two paragraphs in a route
 *
 * There are THREE doors onto the same flag and they must not have one voice between
 * them: `POST /events/:id/publish`, the new `POST /events/:id/unpublish`, and
 * `PATCH { published }` — which is how every operator's screen has always taken a
 * page down, and which cannot be removed without breaking them. The cancel work an
 * hour ago walked into exactly this shape and the answer held: put the rule where the
 * TRANSITION is, and let every caller reach it. A notification attached to one door
 * is a notification the other doors silently skip.
 *
 * ## Everyone on the bill, minus the actor
 *
 * `eventParticipantRecipients` — the built mechanism for event-wide news. Not
 * "the other side" narrowly: an event can carry a support act, a co-promoter and an
 * agent, and each of them has the same stake in learning their name and their date
 * are on the open internet. Ran's phrase names the two-party case because that is
 * the common one, not because a third party should be kept in the dark.
 *
 * Best-effort by contract, like every other notification in this app: the flag has
 * already moved by the time this runs, and a delivery failure must never undo it.
 */
export async function notifyPublicationChanged(
  database: Database,
  request: FastifyRequest,
  event: { id: string; title: string; eventDate: string | null },
  published: boolean,
): Promise<void> {
  try {
    const actorUserId = request.principal?.userId ?? null;
    const recipients = await eventParticipantRecipients(database, event.id, actorUserId);
    if (recipients.length === 0) return;

    await notifyUsers(database, recipients, actorUserId, {
      // Two types rather than one with a flag: they are read as different news, and
      // `@showme/db/notify` maps a type to a preference category by its prefix, so
      // both land under "Events and invitations" without a new switch.
      type: published ? "event.published" : "event.unpublished",
      title: published ? `"${event.title}" is now public` : `"${event.title}" is no longer public`,
      body: published
        ? "It has a public event page, and the show appears on your profile."
        : "The public event page has been taken down, and the show no longer appears on your profile.",
      eventId: event.id,
      actorDisplay: request.firebaseUser?.name ?? undefined,
      link: `/events/${event.id}`,
      metadata: { published, eventDate: event.eventDate },
    });
  } catch (error) {
    request.log.error(
      { error, eventId: event.id, published },
      "event-publication notification failed",
    );
  }
}
