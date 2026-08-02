import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { AppShell } from "./shell/AppShell";
import { Dashboard } from "./routes/Dashboard";
import { EventDetail } from "./routes/EventDetail";
import { Events } from "./routes/Events";

const rootRoute = createRootRoute({ component: AppShell });

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Dashboard,
});

const eventsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/events",
  component: Events,
});

const eventDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/events/$eventId",
  component: EventDetail,
});

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  eventsRoute,
  eventDetailRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
