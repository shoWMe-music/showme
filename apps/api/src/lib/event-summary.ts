import { schema } from "@showme/db";
import { eq } from "drizzle-orm";
import type { EventSummary } from "./email-templates";

/**
 * The three columns every event EMAIL needs, read once.
 *
 * `renderOffPlatformPerformerEmail`, `renderEventNotificationEmail` and
 * `renderSettlementReviewEmail` all want the same summary, and their callers had
 * each grown a private copy of the select — one of which reached through
 * `venue_profile_id` to the venue's profile for a name that is denormalised onto
 * `events.venue_name` already. Three call sites for one query is the point at
 * which a helper earns itself.
 *
 * It lives HERE and not beside the templates because `email-templates.ts` is
 * deliberately database-free — it is copy and markup, and the routes gather the
 * facts. This is the fact-gathering half.
 *
 * Returns null when the event has vanished mid-request, which every caller treats
 * the same way: skip the email rather than send one that names nothing.
 */
export async function loadEventSummary(
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle db/tx handle.
  database: any,
  eventId: string,
): Promise<EventSummary | null> {
  const [row] = await database
    .select({
      id: schema.events.id,
      title: schema.events.title,
      eventDate: schema.events.eventDate,
      venueName: schema.events.venueName,
    })
    .from(schema.events)
    .where(eq(schema.events.id, eventId));
  return (row as EventSummary | undefined) ?? null;
}
