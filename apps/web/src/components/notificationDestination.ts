/**
 * Where a notification's stored `link` sends the reader.
 *
 * The API writes `link` as a plain path string (`/requests`, `/team`,
 * `/events/<uuid>` — see `apps/api/src/lib/notify.ts` and its callers), but the
 * router is typed: `navigate` wants a route template plus params, not free text.
 * This translates the one into the other.
 *
 * It is an ALLOW-LIST on purpose. A link is a value stored in the database, so a
 * bad or hostile one (an absolute `https://…`, a `javascript:` URL, a path no
 * route serves) must never become a navigation. Anything not recognised here
 * resolves to `null` and the row simply isn't clickable — the notification still
 * reads and still marks read, it just doesn't pretend to lead somewhere.
 */

/** Every parameterless route in `apps/web/src/router.tsx`, in its order. */
const STATIC_ROUTES = [
  "/",
  "/calendar",
  "/events",
  "/tasks",
  "/reports",
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

export type NotificationDestination =
  | { to: "/events/$eventId"; params: { eventId: string } }
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

export function notificationDestination(
  link: string | null | undefined,
): NotificationDestination | null {
  if (!link) return null;

  const settlementEventId = SETTLEMENT_LINK.exec(link)?.[1];
  if (settlementEventId) {
    return { to: "/events/$eventId/settlement", params: { eventId: settlementEventId } };
  }

  const eventId = EVENT_LINK.exec(link)?.[1];
  if (eventId) return { to: "/events/$eventId", params: { eventId } };

  const staticRoute = STATIC_ROUTES.find((route) => route === link);
  return staticRoute ? { to: staticRoute } : null;
}
