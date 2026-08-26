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
  | { to: (typeof STATIC_ROUTES)[number] };

/** `/events/<id>` — the only parameterised link any writer produces today. */
const EVENT_LINK = /^\/events\/([^/?#]+)$/;

export function notificationDestination(
  link: string | null | undefined,
): NotificationDestination | null {
  if (!link) return null;

  const eventId = EVENT_LINK.exec(link)?.[1];
  if (eventId) return { to: "/events/$eventId", params: { eventId } };

  const staticRoute = STATIC_ROUTES.find((route) => route === link);
  return staticRoute ? { to: staticRoute } : null;
}
