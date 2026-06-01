import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  useRouterState,
} from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import NotFound from "@/pages/NotFound";

// ── All pages (static imports — no lazy loading, no Suspense flashes) ───────
import Index from "@/pages/Index";
import EventsPage from "@/pages/EventsPage";
import EventManagerPage from "@/pages/EventManagerPage";
import CalendarPage from "@/pages/CalendarPage";
import SettlementsPage from "@/pages/SettlementsPage";
import ContactsPage from "@/pages/ContactsPage";
import ContactDetailPage from "@/pages/ContactDetailPage";
import SettingsPage from "@/pages/SettingsPage";
import ProfilesPage from "@/pages/ProfilesPage";
import ProfileEditPage from "@/pages/ProfileEditPage";
import SettlementReviewPage from "@/pages/SettlementReviewPage";
import SettlementDetailPage from "@/pages/SettlementDetailPage";
import TicketingPage from "@/pages/TicketingPage";
import TeamPage from "@/pages/TeamPage";
import BillsInvoicesPage from "@/pages/BillsInvoicesPage";
import IncomingRequestsPage from "@/pages/IncomingRequestsPage";
import SentRequestsPage from "@/pages/SentRequestsPage";
import TasksPage from "@/pages/TasksPage";
import TemplatesPage from "@/pages/TemplatesPage";
import AdminInvitationsPage from "@/pages/AdminInvitationsPage";
import AdminPlansPage from "@/pages/AdminPlansPage";
import LandingPage from "@/pages/LandingPage";
import ProductPage from "@/pages/ProductPage";
import SolutionsPage from "@/pages/SolutionsPage";
import AboutPage from "@/pages/AboutPage";
// import PricingPage from "@/pages/PricingPage";
import LoginPage from "@/pages/LoginPage";
import SignupPage from "@/pages/SignupPage";
import PublicProfilePage from "@/pages/PublicProfilePage";
import PublicEventPage from "@/pages/PublicEventPage";
import BookingWidgetPage from "@/pages/BookingWidgetPage";
import SharedAvailabilityPage from "@/pages/SharedAvailabilityPage";
import SharedBudgetPage from "@/pages/SharedBudgetPage";
import SharedEventPage from "@/pages/SharedEventPage";
import CollaboratorAuthPage from "@/pages/CollaboratorAuthPage";
import CollaboratorEventView from "@/pages/CollaboratorEventView";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import AcceptInvitePage from "@/pages/AcceptInvitePage";
import InvitePage from "@/pages/InvitePage";

function parseOptionalString(raw: Record<string, unknown>, key: string) {
  const v = raw[key];
  return typeof v === "string" ? v : undefined;
}

function parseRedirectSearch(raw: Record<string, unknown>) {
  const r = raw.redirect;
  if (typeof r !== "string" || !r.startsWith("/") || r.startsWith("//")) return {};
  return { redirect: r };
}


/** Logged-out users may browse marketing and shared links; everything else goes to login. */
const AUTH_REQUIRED_PREFIXES = [
  "/events",
  "/calendar",
  "/requests",
  "/settlements",
  "/ticketintegration",
  "/team",
  "/bills",
  "/contacts",
  "/profiles",
  "/templates",
  "/settings",
  "/admin",
];

function requiresAuthForPath(pathname: string) {
  if (pathname === "/") return true;
  return AUTH_REQUIRED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function RootLayout() {
  const { user, loading } = useAuth();
  const location = useRouterState({ select: (s) => s.location });

  const needsAuth = location.pathname === "/" || requiresAuthForPath(location.pathname);

  if (loading && needsAuth) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!loading && user && location.pathname === "/login") {
    return <Navigate to="/" replace />;
  }

  if (!loading && !user) {
    if (location.pathname === "/") {
      return <Navigate to="/landing" replace />;
    }
    if (requiresAuthForPath(location.pathname)) {
      return (
        <Navigate
          to="/login"
          replace
          search={{ redirect: location.href }}
        />
      );
    }
  }

  return <Outlet />;
}

const rootRoute = createRootRoute({
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Index,
});

const landingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/landing",
  component: LandingPage,
  staticData: {
    meta: {
      title: "shoWMe — Event Settlement Platform",
      description: "Streamline your event settlements, budgets, and collaborations with shoWMe.",
    },
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (raw: Record<string, unknown>) => ({
    ...parseRedirectSearch(raw),
    reason: parseOptionalString(raw, "reason"),
  }),
  component: LoginPage,
  staticData: {
    meta: {
      title: "Sign in — shoWMe",
      description: "Sign in to your shoWMe account.",
    },
  },
});

const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/signup",
  validateSearch: (raw: Record<string, unknown>) => ({
    ...parseRedirectSearch(raw),
    code: parseOptionalString(raw, "code"),
  }),
  component: SignupPage,
  staticData: {
    meta: {
      title: "Create account — shoWMe",
      description: "Create a shoWMe account to manage event settlements, budgets, and collaborations.",
    },
  },
});

const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/about",
  component: AboutPage,
  staticData: {
    meta: {
      title: "About shoWMe",
      description: "Learn about shoWMe and our mission to simplify event settlements and financial collaboration.",
    },
  },
});

const productRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/product",
  component: ProductPage,
  staticData: {
    meta: {
      title: "Product — shoWMe",
      description: "Explore shoWMe's tools for event settlement, budget tracking, and team collaboration.",
    },
  },
});

const solutionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/solutions",
  component: SolutionsPage,
  staticData: {
    meta: {
      title: "Solutions — shoWMe",
      description: "shoWMe provides tailored solutions for venues, promoters, artists, and event organizers.",
    },
  },
});

// const pricingRoute = createRoute({
//   getParentRoute: () => rootRoute,
//   path: "/pricing",
//   component: PricingPage,
//   staticData: {
//     meta: {
//       title: "Pricing — shoWMe",
//       description: "Simple, transparent pricing for event professionals. Find the shoWMe plan that fits your needs.",
//     },
//   },
// });

const eventsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/events",
  component: EventsPage,
});

const eventManagerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/events/$id",
  validateSearch: (raw: Record<string, unknown>) => ({
    tab: parseOptionalString(raw, "tab"),
  }),
  component: EventManagerPage,
});

const calendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/calendar",
  validateSearch: (raw: Record<string, unknown>) => ({
    date: parseOptionalString(raw, "date"),
  }),
  component: CalendarPage,
});

const tasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tasks",
  component: TasksPage,
});

const requestsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/requests",
  component: IncomingRequestsPage,
});

const sentRequestsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sent-requests",
  component: SentRequestsPage,
});

const settlementsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settlements",
  component: SettlementsPage,
});

const settlementDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settlements/$id",
  validateSearch: (raw: Record<string, unknown>) => ({
    tab: parseOptionalString(raw, "tab"),
  }),
  component: SettlementDetailPage,
});

const ticketingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ticketintegration",
  component: TicketingPage,
});

const teamRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/team",
  component: TeamPage,
});

const billsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/bills",
  component: BillsInvoicesPage,
});

const contactsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/contacts",
  component: ContactsPage,
});

const contactDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/contacts/$id",
  component: ContactDetailPage,
});

const profilesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/profiles",
  component: ProfilesPage,
});

const profileEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/profiles/$profileId/edit",
  component: ProfileEditPage,
});

const publicProfileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/p/$slug",
  component: PublicProfilePage,
  staticData: {
    meta: {
      title: "shoWMe Profile",
      description: "View this profile on shoWMe.",
    },
  },
});

const publicEventRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/event/$id",
  component: PublicEventPage,
});

const bookingWidgetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/request-date/$slug",
  component: BookingWidgetPage,
  staticData: {
    meta: {
      title: "Request a Date — shoWMe",
      description: "Send a booking request.",
    },
  },
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

const templatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/templates",
  component: TemplatesPage,
});

const settlementReviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/review/$token",
  component: SettlementReviewPage,
  staticData: {
    meta: {
      title: "Settlement Review — shoWMe",
      description: "Review and approve your event settlement on shoWMe.",
    },
  },
});

const sharedAvailabilityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/availability/$shareId",
  component: SharedAvailabilityPage,
  staticData: {
    meta: {
      title: "Availability — shoWMe",
      description: "View and respond to a shared availability request on shoWMe.",
    },
  },
});

const sharedBudgetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/shared/budget/$token",
  component: SharedBudgetPage,
  staticData: {
    meta: {
      title: "Shared Budget — shoWMe",
      description: "View a shared event budget on shoWMe.",
    },
  },
});

const sharedEventRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/shared/event/$eventId",
  validateSearch: (raw: Record<string, unknown>) => ({
    token: parseOptionalString(raw, "token"),
    tabs: parseOptionalString(raw, "tabs"),
    sections: parseOptionalString(raw, "sections"),
  }),
  component: SharedEventPage,
  staticData: {
    meta: {
      title: "Shared Event — shoWMe",
      description: "View a shared event on shoWMe.",
    },
  },
});

const collaborateViewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/collaborate/$eventId/$token/view",
  component: CollaboratorEventView,
});

const collaborateAuthRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/collaborate/$eventId/$token",
  component: CollaboratorAuthPage,
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset-password",
  component: ResetPasswordPage,
  staticData: {
    meta: {
      title: "Reset Password — shoWMe",
      description: "Reset your shoWMe account password.",
    },
  },
});

const adminInvitationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/invitations",
  component: AdminInvitationsPage,
});

const adminPlansRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/plans",
  component: AdminPlansPage,
});

const acceptInviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/accept-invite",
  validateSearch: (raw: Record<string, unknown>) => ({
    email: parseOptionalString(raw, "email"),
  }),
  component: AcceptInvitePage,
  staticData: {
    meta: {
      title: "Accept invitation — shoWMe",
      description: "Accept your shoWMe invitation.",
    },
  },
});

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invite",
  validateSearch: (raw: Record<string, unknown>) => ({
    code: parseOptionalString(raw, "code"),
  }),
  component: InvitePage,
  staticData: {
    meta: {
      title: "Accept invitation — shoWMe",
      description: "Accept your shoWMe invitation.",
    },
  },
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  landingRoute,
  loginRoute,
  signupRoute,
  resetPasswordRoute,
  aboutRoute,
  productRoute,
  solutionsRoute,
  // pricingRoute,
  eventsRoute,
  eventManagerRoute,
  calendarRoute,
  tasksRoute,
  requestsRoute,
  sentRequestsRoute,
  settlementsRoute,
  settlementDetailRoute,
  ticketingRoute,
  teamRoute,
  billsRoute,
  contactsRoute,
  contactDetailRoute,
  profilesRoute,
  profileEditRoute,
  templatesRoute,
  publicProfileRoute,
  publicEventRoute,
  bookingWidgetRoute,
  settingsRoute,
  settlementReviewRoute,
  sharedAvailabilityRoute,
  sharedBudgetRoute,
  sharedEventRoute,
  collaborateViewRoute,
  collaborateAuthRoute,
  adminInvitationsRoute,
  adminPlansRoute,
  acceptInviteRoute,
  inviteRoute,
]);

export const router = createRouter({
  routeTree,
  defaultNotFoundComponent: NotFound,
  // Keep the current page visible while the next route's lazy chunk loads
  // instead of flashing a full-screen spinner on every navigation
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
