/**
 * Where a notification sends the reader.
 *
 * The API writes `link` as a plain path string (`/requests`, `/team`,
 * `/events/<uuid>` — see `@showme/db/notify` and its callers), but the
 * router is typed: `navigate` wants a route template plus params, not free text.
 * This translates the one into the other.
 *
 * It is an ALLOW-LIST on purpose. A link is a value stored in the database, so a
 * bad or hostile one (an absolute `https://…`, a `javascript:` URL, a path no
 * route serves) must never become a navigation. Anything not recognised here
 * resolves to `null` and the row simply isn't clickable — the notification still
 * reads and still marks read, it just doesn't pretend to lead somewhere.
 *
 * ## The tab (ClickUp `86cbcgq5f`)
 *
 * Ran: *"when pressing a Notification, the navigation doesn't lead to the
 * specific tab and place in the event manager"*. He is right, and the reason is
 * that almost every event notification stores the same link — a bare
 * `/events/<uuid>` — whatever it is about. A deal was sent, somebody joined the
 * bill, a settlement was finalized: all three land on Event Details, and the
 * reader has to go and find the thing they were just told about.
 *
 * WHICH TAB IS DERIVED FROM THE `type`, NOT WRITTEN BY THE EMITTER. Both would
 * work; this one is chosen for two reasons. A link written at the emitter is a
 * thing twenty-odd call sites can each forget, and forgetting is silent — the
 * notification still works, it just lands in the wrong place. And a stored link
 * is already written: rows sitting in people's bells right now would keep their
 * bare path forever, whereas a rule applied at READ time fixes the whole backlog
 * the moment it ships. `@showme/db/notify` already derives a preference category
 * from the same `type` for the same reason, so this is that pattern, not a new
 * one.
 */

/** Every parameterless route in `apps/web/src/router.tsx`, in its order. */
const STATIC_ROUTES = [
  "/",
  "/calendar",
  "/events",
  "/tasks",
  "/reports",
  "/setlists",
  "/settlements",
  "/projections",
  "/requests",
  "/invoices",
  "/team",
  "/contacts",
  "/audience",
  "/profiles",
  "/settings",
] as const;

/**
 * WHICH PANEL OF THE EVENT WORKSPACE A NOTIFICATION IS ABOUT.
 *
 * Keys are `notifications.type`; values are the `?tab=` keys in
 * `routes/EventDetail.tsx`. Only types that belong somewhere OTHER than Event
 * Details appear — the details panel is what an unmapped type already gets, and
 * listing them all would be a table that has to be edited to say nothing.
 *
 * The whole vocabulary is twenty-odd types (everything handed to `notifyUsers` /
 * `notifyProfileMembers`), so this is a map rather than a prefix rule: `event.*`
 * alone spans three different answers, and a prefix rule would have to carry
 * exceptions for most of them.
 *
 * A tab the READER cannot see is not a problem to solve here. `EventDetail`
 * already falls back to Event Details for a `?tab=` that is not in their tab list
 * — a performer sent to `budget` sees details rather than a blank workspace — so
 * a link may name a panel freely and the screen decides whether it exists.
 */
const TAB_BY_NOTIFICATION_TYPE: Record<string, string> = {
  // An agreement — sent, confirmed or reopened — is read on the Deals tab.
  "deal.sent": "deals",
  "deal.confirmed": "deals",
  "deal.reopened": "deals",
  // Somebody joined the bill. The roster is Team / Crew.
  "event.participant_added": "crew",
  // The one settlement notification that does NOT already point at the dedicated
  // settlement workspace. Its stored link is a bare `/events/<id>`, so until now
  // the message that the money is final landed on the event's description.
  "settlement.finalized": "settlement",
  // A job — handed to you, or reaching the time you asked to be reminded — is read
  // on that event's To Do tab. (A personal task carries `/tasks` instead and never
  // reaches this map.)
  "task.assigned": "todo",
  "task.reminder": "todo",
};

export type NotificationDestination =
  | { to: "/events/$eventId"; params: { eventId: string }; search: { tab?: string } }
  | { to: "/events/$eventId/settlement"; params: { eventId: string } }
  | { to: (typeof STATIC_ROUTES)[number] };

/** The two parameterised links the API's writers produce. */
const EVENT_LINK = /^\/events\/([^/?#]+)$/;
// `/events/<id>/settlement` is the settlement WORKSPACE — a route of its own, not
// a tab (`router.tsx`). Every settlement notification has always pointed at it
// (`settlement.pending_review` since it was written), and until this line existed
// each one landed here, matched nothing, and rendered as dead text: the one feed
// entry that says somebody is waiting on your figures was the one you could not
// click.
const SETTLEMENT_LINK = /^\/events\/([^/?#]+)\/settlement$/;

/**
 * `notification` rather than a bare link, because the destination is a fact about
 * BOTH halves: the link says which event, the type says which part of it.
 */
export function notificationDestination(
  notification: { link?: string | null; type?: string | null } | string | null | undefined,
): NotificationDestination | null {
  // A plain string still works. The bell passes the whole row; keeping the old
  // shape means a caller that only has a link is not forced to invent a type.
  const input = typeof notification === "string" ? { link: notification } : notification;
  const link = input?.link;
  if (!link) return null;

  const settlementEventId = SETTLEMENT_LINK.exec(link)?.[1];
  if (settlementEventId) {
    return { to: "/events/$eventId/settlement", params: { eventId: settlementEventId } };
  }

  const eventId = EVENT_LINK.exec(link)?.[1];
  if (eventId) {
    const tab = input?.type ? TAB_BY_NOTIFICATION_TYPE[input.type] : undefined;
    return { to: "/events/$eventId", params: { eventId }, search: tab ? { tab } : {} };
  }

  const staticRoute = STATIC_ROUTES.find((route) => route === link);
  return staticRoute ? { to: staticRoute } : null;
}
