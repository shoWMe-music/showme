import { useGetApiV1BookingRequests } from "@showme/api-client";
import { Avatar, Button, Icon, Input, SidebarItem } from "@showme/design-system";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { NotificationBell } from "../components/NotificationBell";
import { useRealtimeStream } from "../hooks/useRealtimeStream";
import { NewEventProvider, TopbarNewEventButton } from "./NewEventProvider";
import { type NavRoute, navigationFor } from "./navigation";
import { useMobileNavigation } from "./useMobileNavigation";
import { usePageTransition } from "./usePageTransition";

/** Top-bar crumb + title per route — the page title lives in the chrome, not in
 * the screen body (the prototype's `titles` map). Covers EVERY route, including
 * the ones a given account kind has no sidebar link to: those stay reachable by
 * URL, and a reachable page still needs its title. */
const PAGE_TITLES: Record<string, { crumb: string; title: string }> = {
  "/": { crumb: "Overview", title: "Dashboard" },
  "/calendar": { crumb: "Schedule", title: "Calendar" },
  "/events": { crumb: "All events", title: "Events" },
  "/tasks": { crumb: "To do", title: "Tasks" },
  // The operator's PRO filing desk (see `navigation.ts`), and the performer's
  // authoring screen. Two screens, two halves of one module — never one screen
  // wearing the other's name.
  "/reports": { crumb: "Performing rights", title: "Performance Reports" },
  "/setlists": { crumb: "Your shows", title: "Setlists" },
  "/settlements": { crumb: "Money", title: "Settlements" },
  "/projections": { crumb: "Forecast", title: "Financial Projections" },
  "/requests": { crumb: "Bookings", title: "Requests" }, // direction-neutral; the page states which way
  "/invoices": { crumb: "Finance", title: "Bills & Invoices" },
  "/team": { crumb: "People", title: "Team" },
  "/contacts": { crumb: "Directory", title: "Contacts" },
  "/audience": { crumb: "CRM", title: "Audience" },
  "/profiles": { crumb: "Public", title: "My Profiles" },
  "/settings": { crumb: "Account", title: "Settings" },
};

function pageTitle(pathname: string): { crumb: string; title: string } {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  // The settlement workspace is its own document under the event, so the chrome
  // names it rather than repeating "Event" over a screen that is about the money.
  if (/^\/events\/[^/]+\/settlement\/?$/.test(pathname)) {
    return { crumb: "Money", title: "Settlement" };
  }
  // Event workspace (/events/:id) — a detail view with no top-level crumb.
  if (pathname.startsWith("/events/")) return { crumb: "Event workspace", title: "Event" };
  return { crumb: "", title: "" };
}

function BrandMark() {
  return (
    <svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="sm-tri" x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="#FFF0C7" />
          <stop offset="100%" stopColor="#FFC266" />
        </linearGradient>
      </defs>
      <path d="M8 48 A42 42 0 0 1 92 48 L92 92 L8 92 Z" fill="#EE5746" />
      <path d="M50 14 L82 76 L18 76 Z" fill="url(#sm-tri)" />
      <circle cx="50" cy="76" r="6" fill="#EE5746" />
      <circle cx="34" cy="76" r="5" fill="#EE5746" />
      <circle cx="66" cy="76" r="5" fill="#EE5746" />
    </svg>
  );
}

/**
 * Light/dark, rendered in exactly ONE place at a time: the top bar on a desktop,
 * the drawer's footer on a phone. It moves rather than duplicating because a
 * theme is a preference, not a per-screen action — and at 390px the 40px it
 * costs is the difference between a page title that reads and one that
 * ellipsises.
 */
function ThemeToggle({
  light,
  onToggle,
  className,
}: {
  light: boolean;
  onToggle: () => void;
  className: string;
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={onToggle}
      data-testid="theme-toggle"
      aria-label={light ? "Switch to dark theme" : "Switch to light theme"}
    >
      <Icon name={light ? "moon" : "sun"} size={18} />
      <span className="themetoggle__label">{light ? "Dark theme" : "Light theme"}</span>
    </button>
  );
}

const KIND_LABEL: Record<string, string> = {
  operator: "Operator",
  performer: "Performer",
  team_and_crew: "Team and Crew",
  agent: "Booking agent",
};

/**
 * Deep routes whose sidebar home is NOT their URL prefix.
 *
 * The prefix rule answers almost everything — `/events/:id` belongs under
 * Events — but the settlement workspace is a money document that happens to be
 * REACHED through an event. `pageTitle` above already calls it "Money ·
 * Settlement", so leaving the sidebar marker on Events made the chrome
 * contradict itself: the top bar said one thing and the rail said another.
 * Reported by Ran, 2026-08-31.
 *
 * Keep this list beside `pageTitle`'s matching branch — a route that gets its
 * own title almost always wants its own home, and the two drifting apart is the
 * bug this entry exists to fix.
 */
const DEEP_ROUTE_HOME: ReadonlyArray<{ readonly pattern: RegExp; readonly home: NavRoute }> = [
  { pattern: /^\/events\/[^/]+\/settlement\/?$/, home: "/settlements" },
];

function isActive(pathname: string, to: NavRoute): boolean {
  if (to === "/") return pathname === "/";
  // An explicit home wins outright, so the owning destination lights up and the
  // one that merely shares a prefix does not.
  const deepHome = DEEP_ROUTE_HOME.find((entry) => entry.pattern.test(pathname));
  if (deepHome) return deepHome.home === to;
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function AppShell() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const { session, user, signOut } = useAuth();
  // Light is the default theme (matches the design demo); dark stays available
  // via the toggle. The [data-theme] attribute on <html> drives the token remap.
  const [light, setLight] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const pageRef = usePageTransition(pathname);
  // Below the `tablet` breakpoint the sidebar stops being a column and becomes
  // an off-canvas drawer over the page. Same markup, same nav list, same active
  // marker — only its position and its semantics change.
  const menu = useMobileNavigation(pathname);
  // The 72px icon rail is a DESKTOP affordance: its toggle is not rendered in
  // the drawer, and a drawer that opened as a row of unlabelled icons would be
  // unreadable. Collapsing therefore only applies while the sidebar is a column.
  const railCollapsed = collapsed && !menu.compact;

  // One SSE subscription for the whole session, mounted here because the shell is
  // the only component alive for all of it. Frames invalidate queries; no component
  // reads the stream directly.
  useRealtimeStream(import.meta.env.VITE_STREAM_URL);

  /**
   * The Requests badge counts UNREAD incoming booking requests, not pending ones.
   *
   * Pending and unread are different questions and only one of them belongs on a
   * badge. Pending is a WORKLOAD — a venue that has consciously parked thirty
   * open requests carries a permanent "30" it learns to ignore, and a number
   * that never reaches zero stops being a signal. Unread is NEWS: it means
   * "something arrived that nobody here has looked at", it is clearable, and
   * clearing it is a deliberate act (`/requests` never marks on open). That is
   * also exactly what the bell's badge means two components away, so the shell
   * now says one thing rather than two.
   *
   * The workload has not gone anywhere — the Requests screen's own header still
   * shows "N pending", beside the Pending chip it opens on. Shell = news, screen
   * = work.
   *
   * `?unread=true` is incoming-only by construction (the route refuses it on the
   * sent view, since a read receipt is the recipient's business), which is the
   * right scope for the badge anyway.
   */
  // 99, so that a cursor coming back means "more than 99" exactly. The API
  // exposes no count, and a badge that claims a precise number it cannot know is
  // worse than one that says "many".
  const { data: requests } = useGetApiV1BookingRequests({ unread: true, limit: 99 });
  const unreadCount = requests?.items.length ?? 0;
  const unreadBadge = requests?.nextCursor ? "99+" : unreadCount;

  // The sidebar tells the truth about the signed-in account kind — the mapping,
  // and the reason for every exclusion, live in ./navigation.
  const navItems = useMemo(() => navigationFor(session?.kind ?? null), [session?.kind]);

  // Keep the <html> data-theme attribute in sync with the theme state (incl. on
  // first mount, so the light default is applied without a toggle click).
  useEffect(() => {
    const element = document.documentElement;
    if (light) element.setAttribute("data-theme", "light");
    else element.removeAttribute("data-theme");
  }, [light]);

  const toggleTheme = () => setLight((value) => !value);

  const { crumb, title } = pageTitle(pathname);
  const personName = user?.displayName ?? session?.email?.split("@")[0] ?? "Account";
  const orgLine = session ? (KIND_LABEL[session.kind] ?? session.kind) : "";
  const initials = personName.slice(0, 2).toUpperCase();

  return (
    <NewEventProvider>
      <div
        className={`app${railCollapsed ? " app--collapsed" : ""}${menu.open ? " app--menu-open" : ""}`}
      >
        {menu.open && (
          <button
            type="button"
            className="app__scrim"
            aria-label="Close navigation"
            onClick={menu.close}
          />
        )}
        <aside
          className="sidebar"
          id="app-navigation"
          ref={menu.drawer}
          // A drawer over a scrimmed page IS a dialog; a column of the layout is
          // not. The semantics follow the shape rather than being asserted at both
          // widths, so a desktop screen reader still meets a plain landmark.
          {...(menu.compact
            ? ({ role: "dialog", "aria-modal": true, "aria-label": "Navigation" } as const)
            : {})}
        >
          <div className="sidebar__brand">
            <span className="sidebar__logo">
              <BrandMark />
            </span>
            {!railCollapsed && <span className="sidebar__word">shoWMe</span>}
            <button
              type="button"
              className="sidebar__close"
              onClick={menu.close}
              aria-label="Close navigation"
            >
              <Icon name="x" size={18} />
            </button>
          </div>

          <button
            type="button"
            className="sidebar__toggle"
            onClick={() => setCollapsed((value) => !value)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <Icon
              name="chevron-right"
              size={15}
              style={collapsed ? undefined : { transform: "rotate(180deg)" }}
            />
          </button>

          <nav className="sidebar__nav" aria-label="Primary">
            {navItems.map((item) => (
              <SidebarItem
                key={item.to}
                icon={<Icon name={item.icon} />}
                label={item.label}
                collapsed={railCollapsed}
                active={isActive(pathname, item.to)}
                badge={item.badge === "requests" && unreadCount > 0 ? unreadBadge : undefined}
                onClick={() => navigate({ to: item.to })}
              />
            ))}
          </nav>

          <div className="sidebar__user">
            {menu.compact && (
              <ThemeToggle light={light} onToggle={toggleTheme} className="sidebar__theme" />
            )}
            <button
              type="button"
              className="sidebar__userbtn"
              onClick={() => setUserMenu((value) => !value)}
              aria-haspopup="menu"
              aria-expanded={userMenu}
              data-testid="profile-menu"
            >
              <Avatar initials={initials} tone="brand" shape="circle" size={34} />
              {!railCollapsed && (
                <span className="sidebar__usermeta">
                  <span className="sidebar__username">{personName}</span>
                  <span className="sidebar__userorg">{orgLine}</span>
                </span>
              )}
            </button>
            {userMenu && (
              <>
                <button
                  type="button"
                  className="sidebar__scrim"
                  aria-label="Close menu"
                  onClick={() => setUserMenu(false)}
                />
                <div className="sidebar__usermenu" role="menu">
                  <Button
                    variant="ghost"
                    leftIcon={<Icon name="x" />}
                    onClick={() => {
                      setUserMenu(false);
                      void signOut();
                    }}
                  >
                    Sign out
                  </Button>
                </div>
              </>
            )}
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <button
              type="button"
              className="topbar__menu"
              ref={menu.trigger}
              onClick={menu.toggle}
              aria-expanded={menu.open}
              aria-controls="app-navigation"
              aria-label="Navigation"
              data-testid="menu-toggle"
            >
              <Icon name="menu" size={18} />
            </button>
            <div className="topbar__title">
              {crumb && <div className="topbar__crumb">{crumb}</div>}
              {title && <h1 className="topbar__heading">{title}</h1>}
            </div>
            {/* No global search endpoint exists yet — only `/profiles/search`,
                which is the performer picker, not this. A field you can type
                into that answers nothing is worse than one that says so, so it
                stays visible and says so until the search is built. */}
            <Input
              className="topbar__search"
              leftIcon={<Icon name="search" size={15} />}
              placeholder="Search — coming soon"
              aria-label="Search"
              disabled
              title="Searching across events and artists is not built yet."
            />
            {!menu.compact && (
              <ThemeToggle light={light} onToggle={toggleTheme} className="topbar__theme" />
            )}
            <NotificationBell />
            {/* Wrapped so the top bar can collapse the CTA to its "+" on a phone
                without the button itself having to know about breakpoints. */}
            <span className="topbar__cta">
              <TopbarNewEventButton />
            </span>
          </header>
          <main className="content">
            <div className="content__page" ref={pageRef}>
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </NewEventProvider>
  );
}
