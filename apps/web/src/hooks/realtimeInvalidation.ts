/**
 * WHICH CACHED READS A FRAME ABOUT ONE EVENT MAKES STALE.
 *
 * `useRealtimeStream`'s own comment states the rule and then did not keep it:
 *
 * > INVALIDATED BY THE EVENT, NOT BY THE TYPE. … an event-scoped frame refetches
 * > that event's workspace queries.
 *
 * It listed **seven** query keys by hand, of the twenty-four the generated client
 * exposes for an event. The one it left out that mattered is the change request
 * (QA sweep run 6, QA6-3): a crew member watched *"Waiting on 2 people to answer.
 * Nothing moves until everyone agrees."* minutes after the night had already moved,
 * because nothing refetched `/events/:id/change-request`. A hand-maintained list of
 * a growing set is the stale screen this exists to prevent, one level up — the same
 * failure the comment warns about for the type vocabulary.
 *
 * So: a PREDICATE over the cache instead of a list. Every generated key for an event
 * is `[`/api/v1/events/${id}/…`]` — the id is in the path — so one string test covers
 * all twenty-four, every nested one (`/budgets/:bid/lines`), and every route added
 * later without a line here. TanStack only refetches queries that are currently
 * mounted, so a Calendar page still pays nothing for a deal frame.
 *
 * The event's own read (`/api/v1/events/:id`, no trailing segment) is matched too,
 * and a DIFFERENT event's id cannot match because the segment boundary is part of
 * the needle.
 */

/** The cache-key needle for one event: its collection path plus its id. */
export function eventQueryKeyPrefix(eventId: string): string {
  return `/api/v1/events/${eventId}`;
}

/**
 * Does this cached query belong to this event?
 *
 * True for the event's own read and for every sub-resource under it. False for
 * another event — `/api/v1/events/abc` must not match `/api/v1/events/abcdef`, so
 * the segment boundary is part of the test and both halves are asserted.
 *
 * `typeof part === "string"` is a type necessity rather than a rule: a key part can
 * be any value and only a string has `startsWith`. Mutating it away changes no
 * answer (an object stringifies to `[object Object]`, a number to its digits, and
 * neither can be a path), which is the honest reason no test pins it.
 */
export function isEventQueryKey(queryKey: readonly unknown[], eventId: string): boolean {
  const needle = eventQueryKeyPrefix(eventId);
  return queryKey.some(
    (part) => typeof part === "string" && (part === needle || part.startsWith(`${needle}/`)),
  );
}
