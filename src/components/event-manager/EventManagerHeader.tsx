import { useNavigate } from "@tanstack/react-router";
import { UserPlus, Users, Share2, Send, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { EventStatusBadge } from "@/components/StatusBadge";
import { cn } from "@/lib/utils";
import type { Event, EventCollaborator } from "@/lib/models";
import type { TabId } from "./useEventManager";
import { EventStatusTimeline } from "./EventStatusTimeline";
import { EventActionsMenu } from "./EventActionsMenu";

interface EventManagerHeaderProps {
  id: string;
  event: Event;
  isParent: boolean;
  isChild: boolean;
  parentEvent: Event | undefined;
  childEventsCount: number;
  collaborators: EventCollaborator[];
  setCollaborators: (c: EventCollaborator[]) => void;
  eventCurrency: string;
  setEventCurrency: (c: string) => void;
  tabs: { id: TabId; label: string; badge?: number }[];
  activeTab: TabId;
  updateEvent: (id: string, updates: Partial<Event>) => void;
  promoteHoldsOnDate: (date: string, venue: string, room: string, rank: number) => void;
  resolveHoldRankConflicts: (id: string, date: string, venue: string, room: string, rank: number) => void;
  togglePublish: (event: Event) => void;
  onInviteOpen: () => void;
  onMarkPendingOpen: () => void;
  onExportOpen: () => void;
  onArchiveOpen: () => void;
  onDuplicate?: () => void;
  effectiveSourceRequestId: string | undefined;
  effectiveSourceRequestDate: string | undefined;
  isPerformerInvitation?: boolean;
  onTabChange?: (tabId: TabId) => void;
}

export function EventManagerHeader({
  id, event, isParent, isChild, parentEvent, childEventsCount,
  collaborators, setCollaborators, eventCurrency, setEventCurrency,
  tabs, activeTab,
  updateEvent, promoteHoldsOnDate, resolveHoldRankConflicts, togglePublish,
  onInviteOpen, onMarkPendingOpen, onExportOpen, onArchiveOpen, onDuplicate,
  effectiveSourceRequestId, effectiveSourceRequestDate,
  isPerformerInvitation, onTabChange,
}: EventManagerHeaderProps) {
  const navigate = useNavigate();

  return (
    <>
      <div className="mb-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{event.name}</h1>
              <EventStatusBadge status={event.eventStatus} />
              {event.eventStatus === "on_hold" && (
                <div className="flex items-center gap-2 ml-1">
                  <Select value={String(event.holdRank || 1)} onValueChange={v => {
                    const newRank = Number(v);
                    updateEvent(id, { holdRank: newRank });
                    resolveHoldRankConflicts(id, event.date, event.venue, event.roomStage || "", newRank);
                  }}>
                    <SelectTrigger className="h-7 w-[100px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[1,2,3,4,5].map(n => <SelectItem key={n} value={String(n)}>{n}{["st","nd","rd","th","th"][n-1]} Hold</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-1.5">
                    <Switch checked={event.holdAutoPromote !== false} onCheckedChange={v => updateEvent(id, { holdAutoPromote: v })} className="scale-75" />
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">Auto-promote</span>
                  </div>
                </div>
              )}
              {isParent && (
                <Badge variant="secondary" className="gap-1">
                  <Users className="h-3 w-3" /> {childEventsCount} performers
                </Badge>
              )}
            </div>
            <p className="mt-1 text-muted-foreground">
              {event.artist} · {event.venue}{event.roomStage ? ` — ${event.roomStage}` : ""} ·{" "}
              <button
                onClick={() => navigate({ to: "/calendar", search: { date: event.date } })}
                className="hover:underline hover:text-foreground cursor-pointer transition-colors"
              >
                {event.date}
              </button>
            </p>
          </div>

          {!isPerformerInvitation && (
            <div className="flex items-center gap-2">
              {(event.eventStatus === "draft" || event.eventStatus === "suggested") && (
                <Button
                  variant={event.eventStatus === "suggested" && (event.performerProfileId || collaborators.some(c => c.eventRole === "performer" && c.status === "pending")) ? "outline" : "default"}
                  className={cn("gap-2", event.eventStatus === "suggested" && (event.performerProfileId || collaborators.some(c => c.eventRole === "performer" && c.status === "pending")) && "border-orange-500 text-orange-600 disabled:opacity-60")}
                  onClick={onMarkPendingOpen}
                  disabled={event.eventStatus === "suggested" && !!(event.performerProfileId || collaborators.some(c => c.eventRole === "performer" && c.status === "pending"))}
                >
                  <Send className="h-4 w-4" />
                  {event.eventStatus === "suggested"
                    ? (event.performerProfileId || collaborators.some(c => c.eventRole === "performer" && c.status === "pending")
                      ? "Pending Performer Invitation"
                      : "Mark as Pending")
                    : (effectiveSourceRequestId && (!effectiveSourceRequestDate || event.date === effectiveSourceRequestDate))
                      ? "Accept Request"
                      : isParent ? "Suggest to Performers" : "Suggest to Performer"}
                </Button>
              )}
              {(event.eventStatus === "confirmed" || event.published) && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  {event.published ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  <span>{event.published ? "Published" : "Unpublished"}</span>
                  <Switch checked={!!event.published} onCheckedChange={() => togglePublish(event)} />
                </div>
              )}
              <Select value={eventCurrency} onValueChange={setEventCurrency}>
                <SelectTrigger className="w-28 h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EUR">EUR (€)</SelectItem>
                  <SelectItem value="USD">USD ($)</SelectItem>
                  <SelectItem value="GBP">GBP (£)</SelectItem>
                  <SelectItem value="SEK">SEK (kr)</SelectItem>
                </SelectContent>
              </Select>
              {(event.eventStatus === "suggested" || event.eventStatus === "pending") && (
                <Button variant="outline" className="gap-2" onClick={onInviteOpen}>
                  <UserPlus className="h-4 w-4" /> Invite Collaborator
                </Button>
              )}
              <Button variant="outline" className="gap-2" onClick={onExportOpen}>
                <Share2 className="h-4 w-4" /> Share & Export
              </Button>
              <EventActionsMenu id={id} event={event} collaborators={collaborators} setCollaborators={setCollaborators} updateEvent={updateEvent} promoteHoldsOnDate={promoteHoldsOnDate} onArchiveOpen={onArchiveOpen} onDuplicate={onDuplicate} />
            </div>
          )}
        </div>

        <EventStatusTimeline status={event.eventStatus} />
      </div>

      {/* Tab bar */}
      <div className="mb-6 flex gap-1 border-b">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => {
              navigate({ to: "/events/$id", params: { id }, search: { tab: tab.id }, replace: true });
              onTabChange?.(tab.id);
            }}
            className={cn(
              "px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px flex items-center gap-1.5",
              activeTab === tab.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
            {tab.badge != null && tab.badge > 0 && (
              <span className="inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold min-w-[18px] h-[18px] px-1">
                {tab.badge > 99 ? "99+" : tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    </>
  );
}
