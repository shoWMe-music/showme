import type { schema } from "@showme/db";
import type { Capability } from "@showme/shared";

type EventRow = typeof schema.events.$inferSelect;

export interface SerializedEvent {
  id: string;
  title: string;
  status: string;
  published: boolean;
  baseCurrency: string;
  eventDate: string | null;
  /** IANA zone snapshotted from the venue (decisions #10) — anchors all local times. */
  timezone: string | null;
  venueProfileId: string | null;
  stageId: string | null;
  version: number;
  holdRank?: number | null;
  holdAutoPromote?: boolean;
}

/**
 * Shape an event by the caller's capabilities — the field-level serializer,
 * server-side (not UI hiding). `hold_rank` / `hold_auto_promote` are operator-only:
 * a performer authorized to VIEW the event still never sees where they rank
 * (see the holds discussion — the rank is the operator's private competitive
 * info). Widening this later is a one-branch change; the raw data is untouched.
 */
export function serializeEvent(event: EventRow, capabilities: Set<Capability>): SerializedEvent {
  const base: SerializedEvent = {
    id: event.id,
    title: event.title,
    status: event.status,
    published: event.published,
    baseCurrency: event.baseCurrency,
    eventDate: event.eventDate,
    timezone: event.timezone,
    venueProfileId: event.venueProfileId,
    stageId: event.stageId,
    version: event.version,
  };

  // `event.edit` is the operator signal — performers/crew never hold it.
  if (capabilities.has("event.edit")) {
    base.holdRank = event.holdRank;
    base.holdAutoPromote = event.holdAutoPromote;
  }
  return base;
}
