import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import type { FunctionComponent } from "react";
import { Audience } from "./routes/Audience";
import { Calendar } from "./routes/Calendar";
import { Contacts } from "./routes/Contacts";
import { Dashboard } from "./routes/Dashboard";
import { EventDetail } from "./routes/EventDetail";
import { Events } from "./routes/Events";
import { Invoices } from "./routes/Invoices";
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
  child("/calendar", Calendar),
  child("/events", Events),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/events/$eventId",
    component: EventDetail,
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
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
