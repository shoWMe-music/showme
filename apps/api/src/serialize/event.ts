import type { schema } from "@showme/db";
import type { Capability } from "@showme/shared";
import type { EventExtras } from "./event-extras";
import { resolveImageUrl } from "./image";

type EventRow = typeof schema.events.$inferSelect;

export interface SerializedEvent {
  id: string;
  title: string;
  status: string;
  published: boolean;
  baseCurrency: string;
  eventDate: string | null;
  /** LOCAL wall-clock times (no offset), anchored by `timezone` (decisions #10). */
  doorTime: string | null;
  startTime: string | null;
  endTime: string | null;
  curfew: string | null;
  /** IANA zone snapshotted from the venue (decisions #10) — anchors all local times. */
  timezone: string | null;
  /**
   * Whose event this is. Already implied by everything on screen (the operator's
   * name heads the page) and needed as an ID by exactly one thing: a poster
   * upload, which must land in the HOST profile's storage folder or the API
   * refuses to attach it.
   */
  hostProfileId: string;
  venueProfileId: string | null;
  venueName: string | null;
  /**
   * WHERE THE SHOW PHYSICALLY IS (ClickUp `123qy9rnfab`).
   *
   * Ran: *"Event manager and details should always show Address and country of
   * the event place… this is for the Performers and agents to know."* Which is
   * exactly the point — the operator who titled the show knows the address by
   * heart, and everyone travelling to it does not. A country decides a flight, a
   * carnet and a tax form, and until now it appeared nowhere on an event.
   *
   * It is the VENUE PROFILE's primary location, read through `venue_profile_id`,
   * rather than columns on the event: a room's address is a permanent fact about
   * the room, and copying it onto every show there would be the denormalization
   * this rebuild exists to delete. `null` when the event names its venue only as
   * free text (`venue_name` with no profile behind it), which is a real state —
   * a fixture, or a room not on the platform.
   *
   * A PLACE's street address is publishable and a person's is not; that rule is
   * `serialize/profile.ts`'s and is unchanged here, because a venue profile is a
   * place. An event whose "venue" is somebody's home studio profile would
   * therefore publish a home address — which is the same exposure the profile
   * serializer already decides, in one place, rather than a second decision made
   * here from less context.
   */
  venueLocation: {
    street: string | null;
    city: string | null;
    /** ISO 3166-1 alpha-2, the platform's one country vocabulary. */
    country: string | null;
  } | null;
  capacity: number | null;
  stageId: string | null;
  notes: string | null;
  /**
   * The poster, resolved down the file-then-URL ladder (`serialize/image.ts`).
   * Signed per response when it is an upload, so it is never stored in this form.
   */
  imageUrl: string | null;
  version: number;
  /**
   * The caller's OWN effective capabilities on this event — not a widening of
   * what they may do, a statement of it. Without it the web app had to infer
   * authority from the presence of an operator-only field
   * (`holdAutoPromote !== undefined`), which is `event.edit` wearing a disguise:
   * it reads TRUE for a host and FALSE for an agent, who nonetheless holds
   * `deal.edit` and `agreement.manage` (decisions #14). Every screen that guessed
   * this way either hid an action from someone entitled to it or offered one that
   * would come back 403. Naming the set is what lets a button exist only when the
   * click behind it would be allowed.
   */
  capabilities: string[];
  holdRank?: number | null;
  holdAutoPromote?: boolean;
  /** Read-with-parent leaves (amenities / ticket tiers / guest list); operator-only. */
  extras?: EventExtras | null;
}

/**
 * Shape an event by the caller's capabilities — the field-level serializer,
 * server-side (not UI hiding). Operational details (times, venue, capacity,
 * notes) go to anyone with `event.view`. `hold_rank` / `hold_auto_promote` and
 * `extras` (the operator's guest list / ticket tiers) are operator-only: a
 * performer authorized to VIEW the event still never sees where they rank (the
 * rank is the operator's private competitive info) nor the operator's guest
 * list. Widening this later is a one-branch change; the raw data is untouched.
 */
export function serializeEvent(
  event: EventRow,
  capabilities: Set<Capability>,
  imageUrls?: Map<string, string>,
  venueLocation?: SerializedEvent["venueLocation"],
): SerializedEvent {
  const base: SerializedEvent = {
    id: event.id,
    title: event.title,
    status: event.status,
    published: event.published,
    baseCurrency: event.baseCurrency,
    eventDate: event.eventDate,
    doorTime: event.doorTime,
    startTime: event.startTime,
    endTime: event.endTime,
    curfew: event.curfew,
    timezone: event.timezone,
    hostProfileId: event.hostProfileId,
    venueProfileId: event.venueProfileId,
    venueName: event.venueName,
    venueLocation: venueLocation ?? null,
    capacity: event.capacity,
    stageId: event.stageId,
    notes: event.notes,
    imageUrl: resolveImageUrl(event.imageFileId, event.imageUrl, imageUrls),
    version: event.version,
    capabilities: [...capabilities].sort(),
  };

  // `event.edit` is the operator signal — performers/crew never hold it.
  if (capabilities.has("event.edit")) {
    base.holdRank = event.holdRank;
    base.holdAutoPromote = event.holdAutoPromote;
    base.extras = (event.extras as EventExtras | null) ?? null;
  }
  return base;
}
