import { useState } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Button,
  Icon,
  type IconName,
  SidebarItem,
  Tag,
} from "@showme/design-system";

type NavItem = { label: string; icon: IconName; to?: "/" | "/events"; badge?: number };

const NAV: NavItem[] = [
  { label: "Dashboard", icon: "grid", to: "/" },
  { label: "Events", icon: "calendar", to: "/events" },
  { label: "Incoming Requests", icon: "mail", badge: 4 },
  { label: "Calendar", icon: "clock" },
  { label: "Tasks", icon: "check" },
  { label: "Settlements", icon: "file" },
  { label: "Contacts", icon: "users" },
  { label: "Settings", icon: "settings" },
];

function BrandMark() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <path d="M12 50 A38 38 0 0 1 88 50 L88 88 L12 88 Z" fill="#EE5746" />
      <path d="M50 20 L80 74 L20 74 Z" fill="#FFE1A0" />
      <circle cx="50" cy="74" r="6" fill="#EE5746" />
      <circle cx="34" cy="74" r="5" fill="#EE5746" />
      <circle cx="66" cy="74" r="5" fill="#EE5746" />
    </svg>
  );
}

export function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [light, setLight] = useState(false);

  const toggleTheme = () => {
    const next = !light;
    setLight(next);
    const el = document.documentElement;
    if (next) el.setAttribute("data-theme", "light");
    else el.removeAttribute("data-theme");
  };

  const crumb = pathname === "/" ? "Dashboard" : pathname.replace(/^\//, "");

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <BrandMark /> shoWMe
        </div>
        <nav className="sidebar__nav" aria-label="Primary">
          {NAV.map((item) => {
            const active =
              item.to === "/" ? pathname === "/" : !!item.to && pathname.startsWith(item.to);
            const onClick =
              item.to === "/"
                ? () => navigate({ to: "/" })
                : item.to === "/events"
                  ? () => navigate({ to: "/events" })
                  : undefined;
            return (
              <SidebarItem
                key={item.label}
                icon={<Icon name={item.icon} />}
                label={item.label}
                active={active}
                badge={item.badge}
                onClick={onClick}
              />
            );
          })}
        </nav>
        <div className="sidebar__spacer" />
        <Tag tone="dim">operator · pro plan</Tag>
      </aside>

      <div className="main">
        <header className="topbar">
          <span className="topbar__crumb" data-testid="crumb">
            shoWMe / {crumb}
          </span>
          <div className="topbar__actions">
            <Button variant="ghost" leftIcon={<Icon name="bell" />} aria-label="Notifications" />
            <Button variant="secondary" onClick={toggleTheme} data-testid="theme-toggle">
              {light ? "Dark" : "Light"}
            </Button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
