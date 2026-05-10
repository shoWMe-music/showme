import { useMemo } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import logo from "@/assets/showme-icon.png";
import { useAuth } from "@/lib/auth-context";
import { useUser } from "@/lib/user-context";
import { useEvents } from "@/lib/queries";
import { queryKeys } from "@/lib/queries/keys";
import { fetchBookingRequestPage } from "@/lib/db";
import { useSidebarCollapse } from "./AppLayout";
import {
  LayoutDashboard,
  Calendar,
  CalendarDays,
  FileText,
  Settings,
  Users,
  UsersRound,
  Receipt,
  ChevronLeft,
  ChevronRight,
  Contact,
  UserCircle,
  Inbox,
  LogOut,
  ListTodo,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/events", label: "Events", icon: Calendar },
  { to: "/tasks", label: "Tasks", icon: ListTodo },
  { to: "/settlements", label: "Settlements", icon: FileText },
  { to: "/requests", label: "Incoming Requests", icon: Inbox },
  { to: "/bills", label: "Bills & Invoices", icon: Receipt, disabled: true },
  { to: "/team", label: "Team", icon: UsersRound },
  { to: "/contacts", label: "Contacts", icon: Contact },
  { to: "/profiles", label: "My Profiles", icon: UserCircle },
  { to: "/templates", label: "Templates", icon: FolderOpen },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function AppSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut, user: firebaseUser } = useAuth();
  const { currentUser, profiles } = useUser();
  const { collapsed, toggle } = useSidebarCollapse();
  const allEvents = useEvents();

  const invitationCount = useMemo(() => {
    const artistProfileIds = Object.values(profiles)
      .filter(p => p.role === "performer" && p.id)
      .map(p => p.id!);
    if (artistProfileIds.length === 0) return 0;
    return allEvents.filter(e =>
      e.performerProfileId &&
      artistProfileIds.includes(e.performerProfileId) &&
      e.eventStatus === "suggested" &&
      !e.archived &&
      e.performerResponse !== "declined"
    ).length;
  }, [allEvents, profiles]);

  const { data: pendingRequestsPage } = useQuery({
    queryKey: queryKeys.pendingBookingRequestsForSidebar(),
    queryFn: () => fetchBookingRequestPage(50, null, { status: "pending" }),
    enabled: !!firebaseUser?.uid,
    staleTime: 5 * 60 * 1000,
  });
  const pendingRequestsCount = pendingRequestsPage?.requests.length ?? 0;
  const requestsBadgeCount = invitationCount + pendingRequestsCount;

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate({ to: "/landing", replace: true });
    } catch {
      toast({ title: "Could not sign out", description: "Try again in a moment.", variant: "destructive" });
    }
  };

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-screen flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-all duration-200",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Header with collapse arrow */}
      <div className="relative">
        <Link to="/" className={cn("flex items-center gap-3 px-4 py-5", collapsed ? "justify-center" : "px-6")}>
          <img src={logo} alt="shoWMe" className="h-8 rounded-lg shrink-0 object-contain" />
          {!collapsed && (
            <span className="mt-3 font-display text-xl font-bold leading-none text-sidebar-accent-foreground tracking-tight">
              shoWMe
            </span>
          )}
        </Link>
        <button
          onClick={toggle}
          className={cn(
            "absolute top-4 flex h-6 w-6 items-center justify-center rounded-full border border-sidebar-border bg-sidebar hover:bg-sidebar-accent text-sidebar-foreground transition-colors",
            collapsed ? "-right-3" : "-right-3"
          )}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-4 space-y-1">
        {navItems.map(({ to, label, icon: Icon, disabled }) => {
          const active = location.pathname === to || (to !== "/" && location.pathname.startsWith(to));
          if (disabled) {
            return (
              <span
                key={to}
                title={collapsed ? `${label} (Coming soon)` : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium cursor-not-allowed opacity-50",
                  collapsed && "justify-center px-0",
                  "text-sidebar-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && (
                  <>
                    {label}
                    <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Coming soon</span>
                  </>
                )}
              </span>
            );
          }
          return (
            <Link
              key={to}
              to={to}
              title={collapsed ? label : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                collapsed && "justify-center px-0",
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <span className="relative shrink-0">
                <Icon className="h-4 w-4" />
                {to === "/requests" && requestsBadgeCount > 0 && collapsed && (
                  <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                    {requestsBadgeCount > 9 ? "9+" : requestsBadgeCount}
                  </span>
                )}
              </span>
              {!collapsed && (
                <>
                  {label}
                  {to === "/requests" && requestsBadgeCount > 0 && (
                    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                      {requestsBadgeCount}
                    </span>
                  )}
                </>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-sidebar-border px-3 py-4 space-y-2">
        <Link to="/settings" className={cn("flex w-full items-center gap-3 rounded-lg px-1 py-1 hover:bg-sidebar-accent transition-colors", collapsed && "justify-center")}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sidebar-primary text-sidebar-primary-foreground text-xs font-bold">
            {currentUser.avatarUrl ? (
              <img src={currentUser.avatarUrl} alt={currentUser.name} className="h-full w-full object-cover" />
            ) : (
              currentUser.initials
            )}
          </div>
          {!collapsed && (
            <div className="flex-1 text-left min-w-0">
              <p className="text-sm font-medium text-sidebar-accent-foreground">{currentUser.name}</p>
            </div>
          )}
        </Link>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-9 w-full justify-start gap-3 px-3 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            collapsed && "justify-center px-0"
          )}
          onClick={handleSignOut}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && "Log out"}
        </Button>
      </div>
    </aside>
  );
}