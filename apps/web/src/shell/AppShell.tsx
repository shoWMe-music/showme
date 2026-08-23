import { useGetApiV1BookingRequests } from "@showme/api-client";
import { Avatar, Button, Icon, type IconName, Input, SidebarItem } from "@showme/design-system";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { NewEventProvider, TopbarNewEventButton } from "./NewEventProvider";
import { usePageTransition } from "./usePageTransition";

/** Every registered nav route. `to` is a real router path so navigation and
 * active-state highlighting stay in lockstep with the router. */
type NavRoute =
  | "/"
  | "/calendar"
  | "/events"
  | "/tasks"
  | "/reports"
  | "/settlements"
  | "/projections"
  | "/requests"
  | "/invoices"
  | "/team"
  | "/contacts"
  | "/audience"
  | "/profiles"
  | "/settings";

type NavItem = {
  label: string;
  icon: IconName;
  to: NavRoute;
  badge?: "requests";
};

// The 14 operator destinations, in the exact sidebar order (screen-specs §0.1).
const NAV: NavItem[] = [
  { label: "Dashboard", icon: "grid", to: "/" },
  { label: "Calendar", icon: "calendar", to: "/calendar" },
  { label: "Events", icon: "calendar-check", to: "/events" },
  { label: "Tasks", icon: "check", to: "/tasks" },
  { label: "Performance Reports", icon: "trending-up", to: "/reports" },
  { label: "Settlements", icon: "receipt", to: "/settlements" },
  { label: "Financial Projections", icon: "trending-up", to: "/projections" },
  // "Requests", not "Incoming Requests" — the page carries both directions and
  // names the active one itself; a fixed "Incoming" here contradicts the Outgoing view.
  { label: "Requests", icon: "inbox", to: "/requests", badge: "requests" },
  { label: "Bills & Invoices", icon: "file", to: "/invoices" },
  { label: "Team", icon: "users", to: "/team" },
  { label: "Contacts", icon: "building", to: "/contacts" },
  { label: "Audience", icon: "users", to: "/audience" },
  { label: "My Profiles", icon: "user", to: "/profiles" },
  { label: "Settings", icon: "settings", to: "/settings" },
];

/** Top-bar crumb + title per route — the page title lives in the chrome, not in
 * the screen body (the prototype's `titles` map). */
const PAGE_TITLES: Record<string, { crumb: string; title: string }> = {
  "/": { crumb: "Overview", title: "Dashboard" },
  "/calendar": { crumb: "Schedule", title: "Calendar" },
  "/events": { crumb: "All events", title: "Events" },
  "/tasks": { crumb: "To do", title: "Tasks" },
  "/reports": { crumb: "PRO royalties", title: "Performance Reports" },
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

const KIND_LABEL: Record<string, string> = {
  operator: "Operator",
  performer: "Performer",
  team_and_crew: "Team and Crew",
  agent: "Booking agent",
};

function isActive(pathname: string, to: NavRoute): boolean {
  if (to === "/") return pathname === "/";
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

  // The Requests badge is the count of pending INCOMING booking requests (the
  // default direction), i.e. what is waiting on this user to triage.
  const { data: requests } = useGetApiV1BookingRequests({ status: "pending" });
  const pendingCount = requests?.items.length ?? 0;

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
      <div className={collapsed ? "app app--collapsed" : "app"}>
        <aside className="sidebar">
          <div className="sidebar__brand">
            <span className="sidebar__logo">
              <BrandMark />
            </span>
            {!collapsed && <span className="sidebar__word">shoWMe</span>}
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
            {NAV.map((item) => (
              <SidebarItem
                key={item.to}
                icon={<Icon name={item.icon} />}
                label={item.label}
                collapsed={collapsed}
                active={isActive(pathname, item.to)}
                badge={item.badge === "requests" && pendingCount > 0 ? pendingCount : undefined}
                onClick={() => navigate({ to: item.to })}
              />
            ))}
          </nav>

          <div className="sidebar__user">
            <button
              type="button"
              className="sidebar__userbtn"
              onClick={() => setUserMenu((value) => !value)}
              aria-haspopup="menu"
              aria-expanded={userMenu}
              data-testid="profile-menu"
            >
              <Avatar initials={initials} tone="brand" shape="circle" size={34} />
              {!collapsed && (
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
            <div className="topbar__title">
              {crumb && <div className="topbar__crumb">{crumb}</div>}
              {title && <h1 className="topbar__heading">{title}</h1>}
            </div>
            <Input
              className="topbar__search"
              leftIcon={<Icon name="search" size={15} />}
              placeholder="Search events, artists…"
              aria-label="Search"
            />
            <button
              type="button"
              className="topbar__theme"
              onClick={toggleTheme}
              data-testid="theme-toggle"
              aria-label="Toggle theme"
            >
              <Icon name={light ? "moon" : "sun"} size={18} />
            </button>
            <Button variant="ghost" leftIcon={<Icon name="bell" />} aria-label="Notifications" />
            <TopbarNewEventButton />
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
