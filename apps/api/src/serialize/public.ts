import type { schema } from "@showme/db";
import { resolveImageUrl } from "./image";

type EventRow = typeof schema.events.$inferSelect;

/**
 * The public, unauthenticated projection of a profile lives in
 * `serialize/profile.ts` and is re-exported here so this module stays the one
 * import for "the public shapes".
 *
 * WHY IT MOVED: the owner's in-app **Preview** has to show exactly what a
 * stranger sees, including for a profile that is not published yet — so it needs
 * the same projection over a row this endpoint would 404. Two implementations of
 * "what is public" would drift the day one of them gained a field, and the drift
 * would be invisible (a preview that flatters). There is now one function, called
 * from both places, and its docstring carries the field-by-field rule.
 */
export {
  type PublicProfile,
  type PublicProfileLocation,
  type PublicVenueDetails,
  serializePublicProfile,
} from "./profile";

/**
 * The public projection of a published event — the poster-level facts only.
 * Budget, notes, hold rank/auto-promote, participants, and their financials are
 * never selected here, so an anonymous viewer cannot see them.
 */
export interface PublicEvent {
  id: string;
  title: string;
  eventDate: string | null;
  venueName: string | null;
  doorTime: string | null;
  startTime: string | null;
  /** The poster. A show's own picture is poster-level by definition. */
  imageUrl: string | null;
}

export function serializePublicEvent(
  event: EventRow,
  imageUrls?: Map<string, string>,
): PublicEvent {
  return {
    id: event.id,
    title: event.title,
    eventDate: event.eventDate,
    venueName: event.venueName,
    doorTime: event.doorTime,
    startTime: event.startTime,
    imageUrl: resolveImageUrl(event.imageFileId, event.imageUrl, imageUrls),
  };
}
