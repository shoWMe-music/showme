import { getGetApiV1EventsIdParticipantsQueryOptions } from "@showme/api-client";
import { useQueries } from "@tanstack/react-query";

/**
 * Who is playing each event, for the Calendar's Performer / Both chip labels.
 *
 * `GET /events` returns the event spine only — title, date, status, venue — and
 * carries no performer, because an event is a container and the acts join it as
 * `event_participants`. So the name has to be read from `GET /events/:id/participants`,
 * one query per event, the same expansion the Reports screen already does. Pass
 * only the events actually on screen: the cost is one small request per visible
 * event, and React Query caches them across view switches.
 *
 * (The cheaper shape would be for the list payload to carry the headline act
 * itself; until it does, this is the honest client-side read.)
 */

/** Roles that name the ACT. The host, crew and agent are on the event too, but
 * "Performer" on a chip means who is on stage. */
const PERFORMING_ROLES = new Set(["performer", "support"]);

/** Participants who are no longer on the bill must not appear on the poster. */
const OFF_THE_BILL = new Set(["removed", "declined"]);

/** Billing order — a chip should read the way a poster does, headliner first. */
const TAG_ORDER = ["headliner", "dj", "support", "opener"];

function billingRank(performerTag: string | null | undefined): number {
  const index = performerTag ? TAG_ORDER.indexOf(performerTag) : -1;
  // Untagged performers sort after every tagged one rather than before.
  return index === -1 ? TAG_ORDER.length : index;
}

/** eventId → "Marlo Vance + Neon Tide", omitting events with nobody on the bill. */
export function useCalendarPerformerNames(eventIds: string[]): Map<string, string> {
  const participantQueries = useQueries({
    queries: eventIds.map((eventId) => getGetApiV1EventsIdParticipantsQueryOptions(eventId)),
  });

  const names = new Map<string, string>();
  eventIds.forEach((eventId, index) => {
    const participants = participantQueries[index]?.data ?? [];
    const billed = participants
      .filter((person) => PERFORMING_ROLES.has(person.role) && !OFF_THE_BILL.has(person.status))
      .sort((left, right) => billingRank(left.performerTag) - billingRank(right.performerTag))
      .map((person) => person.name)
      .filter((name): name is string => Boolean(name));
    if (billed.length > 0) names.set(eventId, billed.join(" + "));
  });
  return names;
}
