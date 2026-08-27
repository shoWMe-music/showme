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
