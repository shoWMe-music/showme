import { ReactNode, useState, createContext, useContext } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import AppSidebar from "./AppSidebar";
import { TopBreadcrumbBar } from "./TopBreadcrumb";
import { useNotifications, queryKeys, useAutoConcludeEvents } from "@/lib/queries";
import { useAuth } from "@/lib/auth-context";
import { useNotificationInvalidator } from "@/lib/queries/useNotificationInvalidator";
import { resolveNotificationTarget } from "@/components/notifications/notificationLinks";
import {
  Bell,
  Calendar,
  FileText,
  MessageSquare,
  Users,
  ClipboardList,
  ArrowLeftRight,
  Archive,
  UserPlus,
  Inbox,
  Music,
  Truck,
  HandshakeIcon,
  Clock,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { NotificationType, AppNotification } from "@/lib/models";

// Sidebar collapse context – persisted via localStorage
const SIDEBAR_KEY = "sidebar-collapsed";
const getInitial = () => localStorage.getItem(SIDEBAR_KEY) === "true";

const SidebarCollapseContext = createContext({ collapsed: false, toggle: () => {} });
export const useSidebarCollapse = () => useContext(SidebarCollapseContext);

const notificationIcons: Record<NotificationType, typeof Bell> = {
  event_status_changed: Calendar,
  event_details_updated: Calendar,
  event_archived: Archive,
  event_unarchived: Archive,
  date_change_proposed: ArrowLeftRight,
  date_change_confirmed: ArrowLeftRight,
  date_change_declined: ArrowLeftRight,
  deal_updated: FileText,
  revenue_updated: FileText,
  settlement_status_changed: FileText,
  settlement_comment_added: MessageSquare,
  settlement_revision_added: FileText,
  message_sent: MessageSquare,
  collaborator_invited: UserPlus,
  collaborator_joined: Users,
  event_invitation: Inbox,
  booking_request_received: Inbox,
  booking_request_responded: Inbox,
  task_assigned: ClipboardList,
  rider_updated: Music,
  agreement_updated: HandshakeIcon,
  crew_updated: Truck,
  schedule_updated: Clock,
  profile_invite: UserPlus,
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
  useNotificationInvalidator(notifications);
  // Auto-transition confirmed past-date events to "concluded" so settlements unlock.
  useAutoConcludeEvents();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const [collapsed, setCollapsed] = useState(getInitial);

  const toggle = () => {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_KEY, String(next));
      return next;
    });
  };

  /**
   * Click handler for a notification row. Marks the notification read and
   * routes to the resolved target. We don't gate on cache existence — many
   * notification types signal a *new* visibility (event_created, invitation,
   * status_changed, accessUids change, etc.), and the cache can't tell "not
   * yet refetched" from "actually deleted". Destination pages do their own
   * direct doc-fetch fallback, so missing docs surface as a proper "not
   * found" page rather than a misleading "deleted" toast.
   */
  const handleNotificationClick = (n: AppNotification) => {
    void markRead(n);
    const target = resolveNotificationTarget(n);

    // Discriminated dispatch — TanStack Router needs the literal `to` path
    // alongside its `params`/`search` to actually match a parameterized route.
    if (target.kind === "event") {
      // Force-refetch the events list before the destination page reads it.
      // The notification fanout's debounced invalidator (500ms) often races
      // against the click — without this, EventManagerPage mounts against a
      // stale cache and shows "Event not found" until the next refetch lands.
      if (uid) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.events(uid) });
      }
      void navigate({
        to: target.to,
        params: target.params,
        ...(target.search ? { search: target.search } : {}),
      });
    } else if (target.kind === "contact") {
      // Same race as events — kick a refetch so ContactDetailPage doesn't
      // mount against a stale cache.
      if (uid) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.contacts(uid) });
      }
      void navigate({ to: target.to, params: target.params });
    } else if (target.kind === "profile-public") {
      void navigate({ to: target.to, params: target.params });
    } else if (target.kind === "profile-list") {
      void navigate({ to: target.to });
    } else {
      // Static target — `to` is a freeform path (allowlisted). TanStack
      // Router's typed `to` doesn't accept arbitrary strings, so cast through
      // `unknown` and pass `hash` as a sibling so `/settings` + `#profile-access`
      // is a real hash navigation, not a literal `/settings%23profile-access`.
      const navArgs = target.hash
        ? { to: target.to, hash: target.hash }
        : { to: target.to };
      void navigate(navArgs as unknown as Parameters<typeof navigate>[0]);
    }
  };

  return (
    <SidebarCollapseContext.Provider value={{ collapsed, toggle }}>
      <div className="min-h-screen bg-background">
        <AppSidebar />
        <main className={`min-h-screen transition-all duration-200 ${collapsed ? "ml-16" : "ml-64"}`}>
          {/* Top bar */}
          <div className="sticky top-0 z-30 flex items-center border-b border-border/50 bg-background px-8 py-3">
            <TopBreadcrumbBar />
            <div className="ml-auto">
            <Popover>
              <PopoverTrigger asChild>
                <button className="relative rounded-lg p-2 hover:bg-muted transition-colors">
                  <Bell className="h-5 w-5 text-muted-foreground" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-96 p-0">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <h4 className="text-sm font-semibold">Notifications</h4>
                  {unreadCount > 0 && (
                    <button onClick={markAllRead} className="text-xs text-primary hover:underline">
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="max-h-96 overflow-y-auto divide-y">
                  {notifications.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                      <Bell className="h-6 w-6 opacity-30" />
                      <p className="text-sm">No notifications yet</p>
                    </div>
                  ) : (
                    notifications.map(n => {
                      const Icon = notificationIcons[n.type] || Bell;
                      return (
                        <button
                          key={`${n.profileId}-${n.id}`}
                          type="button"
                          onClick={() => handleNotificationClick(n)}
                          className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 ${!n.read ? "bg-primary/5" : ""}`}
                        >
                          <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${!n.read ? "text-primary" : "text-muted-foreground"}`} />
                          <div className="min-w-0 flex-1">
                            <p className={`text-xs leading-snug ${!n.read ? "font-medium" : "text-muted-foreground"}`}>
                              {n.title}
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                              {n.body}
                            </p>
                            <p className="text-[10px] text-muted-foreground mt-1">{timeAgo(n.createdAt)}</p>
                          </div>
                          {!n.read && <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />}
                        </button>
                      );
                    })
                  )}
                </div>
              </PopoverContent>
            </Popover>
            </div>
          </div>
          <div className="px-8 py-6">{children}</div>
        </main>
      </div>
    </SidebarCollapseContext.Provider>
  );
}
