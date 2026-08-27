import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import type { FunctionComponent } from "react";
import { Audience } from "./routes/Audience";
import { Calendar } from "./routes/Calendar";
import { Contacts } from "./routes/Contacts";
import { Dashboard } from "./routes/Dashboard";
import { EventDetail } from "./routes/EventDetail";
import { EventSettlement } from "./routes/EventSettlement";
import { Events } from "./routes/Events";
import { Invoices } from "./routes/Invoices";
import { OAuthGoogleCallback } from "./routes/OAuthGoogleCallback";
import { Profiles } from "./routes/Profiles";
import { Projections } from "./routes/Projections";
import { Reports } from "./routes/Reports";
import { Requests } from "./routes/Requests";
import { Settings } from "./routes/Settings";
import { Settlements } from "./routes/Settlements";
import { Tasks } from "./routes/Tasks";
import { Team } from "./routes/Team";
import { AppShell } from "./shell/AppShell";

const rootRoute = createRootRoute({ component: AppShell });

/** One child route per nav destination. Dashboard, Events and the event
 * workspace are the real screens; the rest are stubs until they're built. */
const child = (path: string, component: FunctionComponent) =>
  createRoute({ getParentRoute: () => rootRoute, path, component });

const routeTree = rootRoute.addChildren([
  child("/", Dashboard),
  // The calendar takes an optional `?date=yyyy-mm-dd`, which is what makes every
  // date printed elsewhere in the app a link back to the night it names
  // (`components/DateText`). Unparseable or absent, it falls through to today,
  // so a hand-typed URL can never strand the reader on a blank month.
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/calendar",
    component: Calendar,
    validateSearch: (search: Record<string, unknown>): { date?: string } => {
      const date = search.date;
      return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { date } : {};
    },
  }),
  child("/events", Events),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/events/$eventId",
    component: EventDetail,
  }),
  // The full settlement workspace. A route of its own rather than a tab: it has
  // its own sub-navigation and its own "Back to event" link, and the Settlements
  // list opens it directly for people whose entry point is "what am I owed".
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/events/$eventId/settlement",
    component: EventSettlement,
  }),
  child("/tasks", Tasks),
  child("/reports", Reports),
  child("/settlements", Settlements),
  child("/projections", Projections),
  child("/requests", Requests),
  child("/invoices", Invoices),
  child("/team", Team),
  child("/contacts", Contacts),
  child("/audience", Audience),
  child("/profiles", Profiles),
  child("/settings", Settings),
  // Google's registered redirect URI. The component existed and was reachable
  // by nothing: after consent Google sent the user to a path the router did not
  // know, so the code was never exchanged and no calendar could ever finish
  // connecting. It is a nav destination in the routing sense only — no sidebar
  // entry — which is why it went unnoticed.
  child("/oauth/google/callback", OAuthGoogleCallback),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

/**
 * The off-platform share viewer is NOT part of this route tree.
 *
 * Every route above hangs off a root that renders `AppShell` — a sidebar, a
 * notification bell, an acting profile — and sits behind the auth gate in
 * `main.tsx`. A share recipient has none of those things and is not signed in at
 * all, so the viewer is rendered directly by that gate instead, from the two
 * helpers below. A second router for one chrome-less page would be machinery
 * around a single `if`.
 */

/**
 * The share token out of `/shares/<token>`.
 *
 * THE TOKEN IS THE GRANT — it goes to the API and nowhere else. It is not logged,
 * not put in a page title, and not written into an error message (the API masks
 * the same segment on its side, `apps/api/src/logging.ts`).
 */
export function shareTokenFromPath(pathname: string): string | null {
  const match = /^\/shares\/([^/?#]+)\/?$/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/**
 * The invitation token out of the link we emailed — in EITHER spelling.
 *
 * `/invitations/<token>` is the one we send now, matching `/shares/<token>`.
 * `/?invitation=<token>` is what every invitation sent before 2026-08-26 carries,
 * and those links are in people's inboxes: an invitation that stops working
 * because we tidied a URL is the same broken promise as the one being fixed here
 * (nothing in this app read the parameter at all, so every one of those emails
 * landed on the dashboard and did nothing). **The query form is permanent.**
 *
 * Like the share token, THE TOKEN IS THE GRANT: it goes to the API and nowhere
 * else — never into a log, a page title or an error message.
 *
 * Also lives outside the route tree above, for the same reason `ShareViewer`
 * does: the recipient is usually not signed in, and half of them have no account
 * yet, so the page cannot render inside a shell that assumes both.
 */
export function invitationTokenFromLocation(location: {
  pathname: string;
  search: string;
}): string | null {
  const path = /^\/invitations\/([^/?#]+)\/?$/.exec(location.pathname);
  if (path?.[1]) return decodeURIComponent(path[1]);
  const queried = new URLSearchParams(location.search).get("invitation");
  return queried && queried.length > 0 ? queried : null;
}
