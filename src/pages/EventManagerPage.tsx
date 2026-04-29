import { useState, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import AppLayout from "@/components/AppLayout";
import { useBreadcrumbs, type BreadcrumbItem } from "@/components/TopBreadcrumb";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/models";
import { Check, XCircle, Info, Calendar } from "lucide-react";
import { type EventMeta, upsertEvent, appendEventActivity } from "@/lib/db";
import { useUpdateEvent } from "@/lib/queries/useEventMutations";
import { eventStatusLabels } from "@/lib/models";
import { EventManagerSkeleton } from "@/components/event-manager/EventManagerSkeleton";
import { EventManagerHeader } from "@/components/event-manager/EventManagerHeader";
import { DateChangeBanner } from "@/components/event-manager/DateChangeBanner";
import { MarkPendingDialog, SuggestToPerformersDialog, ArchiveDialog } from "@/components/event-manager/EventManagerDialogs";
import { PerformersTab } from "@/components/event-manager/PerformersTab";
import { BudgetPlannerTab } from "@/components/event-manager/BudgetPlannerTab";
import { EventDetailsTab } from "@/components/event-manager/EventDetailsTab";
import { AgreementTab } from "@/components/event-manager/AgreementTab";
import { CrewTab } from "@/components/event-manager/CrewTab";
import { TodoTab } from "@/components/event-manager/TodoTab";
import { SettlementTab } from "@/components/event-manager/SettlementTab";
import { CollaboratorsTab } from "@/components/event-manager/CollaboratorsTab";
import { EventChangeLogTab } from "@/components/event-manager/EventChangeLogTab";
import InviteCollaboratorDialog from "@/components/InviteCollaboratorDialog";
import ExportEventDialog from "@/components/ExportEventDialog";
import CreateEventDialog from "@/components/CreateEventDialog";
import EventMessages from "@/components/EventMessages";
import { ProfilePreviewPopover } from "@/components/ProfilePreviewPopover";
import { useEventManager } from "@/components/event-manager/useEventManager";
import type { PrefillData } from "@/components/create-event/types";

export default function EventManagerPage() {
  const em = useEventManager();
  const queryClient = useQueryClient();
  const updateEventMutation = useUpdateEvent();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteDefaults, setInviteDefaults] = useState<{ role?: string; name?: string; eventId?: string }>({});
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [markPendingOpen, setMarkPendingOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);

  const handleAcceptInvitation = () => {
    if (!em.id) return;
    updateEventMutation.mutate({
      id: em.id,
      updates: { eventStatus: "pending" as const, performerResponse: "accepted" as const },
    });
  };

  const handleDeclineInvitation = () => {
    if (!em.id) return;
    updateEventMutation.mutate({
      id: em.id,
      updates: { performerResponse: "declined" as const },
    });
  };

  // Breadcrumbs – must be before early returns to maintain consistent hook order.
  const breadcrumbs = useMemo<BreadcrumbItem[]>(() => {
    const crumbs: BreadcrumbItem[] = [
      { label: "Events", to: "/events", icon: Calendar },
    ];
    if (em.isChild && em.parentEvent) {
      crumbs.push({ label: em.parentEvent.name, to: "/events/$id", params: { id: em.parentEvent.id } });
    }
    if (em.event) {
      crumbs.push({ label: em.isChild ? (em.event.artist || em.event.name) : em.event.name });
    }
    return crumbs;
  }, [em.event, em.isChild, em.parentEvent]);
  useBreadcrumbs(breadcrumbs);

  // Collect profile IDs the current user controls (for date change banner matching)
  // Must be before early returns to maintain consistent hook order.
  const userProfileIds = useMemo(() => {
    const ids: string[] = [];
    if (em.profiles) {
      for (const p of Object.values(em.profiles)) {
        if (p.id) ids.push(p.id);
      }
    }
    return ids;
  }, [em.profiles]);

  if (!em.eventsLoaded) return <EventManagerSkeleton />;
  if (!em.event) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-lg text-muted-foreground">Event not found</p>
          <Link to="/events" className="mt-4 text-primary hover:underline">Back to events</Link>
        </div>
      </AppLayout>
    );
  }

  const { event, id } = em;
  const onSaveMeta = (d: Partial<EventMeta>) => { if (id) em.updateEventMeta(id, d); };
  const handleCreateTeamMember = (name: string) => {
    em.addTeamMember({
      id: `TM-${Date.now()}`,
      name,
      email: "",
      phone: "",
      roles: ["Member"],
      status: "active" as const,
      notes: "",
    }, event.hostProfileId ?? "");
  };

  return (
    <AppLayout>
      <div className="animate-fade-in">
        <EventManagerHeader
          id={id}
          event={event}
          isParent={em.isParent}
          isChild={em.isChild}
          parentEvent={em.parentEvent}
          childEventsCount={em.childEvents.length}
          collaborators={em.collaborators}
          setCollaborators={em.setCollaborators}
          eventCurrency={em.eventCurrency}
          setEventCurrency={em.setEventCurrency}
          tabs={em.tabs}
          activeTab={em.activeTab}
          updateEvent={em.updateEvent}
          promoteHoldsOnDate={em.promoteHoldsOnDate}
          resolveHoldRankConflicts={em.resolveHoldRankConflicts}
          togglePublish={em.togglePublish}
          onInviteOpen={() => setInviteOpen(true)}
          onMarkPendingOpen={() => setMarkPendingOpen(true)}
          onExportOpen={() => setExportOpen(true)}
          onArchiveOpen={() => setArchiveConfirmOpen(true)}
          onDuplicate={() => setDuplicateOpen(true)}
          effectiveSourceRequestId={em.effectiveSourceRequestId}
          effectiveSourceRequestDate={em.effectiveSourceRequestDate}
          isPerformerInvitation={em.isPerformerInvitation}
          onTabChange={(tabId) => { if (tabId === "changelog") em.markChangeLogViewed(); }}
        />

        {em.isPerformerInvitation && (
          <div className="mb-6 rounded-xl border border-primary/30 bg-primary/5 p-5">
            <div className="flex items-start gap-3">
              <Info className="h-5 w-5 text-primary mt-0.5 shrink-0" />
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-foreground">You have been invited to this event</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  By accepting, you agree to the proposed date and are willing to discuss the event details with the host.
                  Accepting does not mean all details are finalized — once both parties agree on everything, the event will be confirmed.
                </p>
                <div className="mt-4 flex items-center gap-3">
                  <Button className="gap-2" onClick={handleAcceptInvitation}>
                    <Check className="h-4 w-4" /> Accept Invitation
                  </Button>
                  <Button variant="outline" className="gap-2 text-destructive hover:text-destructive" onClick={handleDeclineInvitation}>
                    <XCircle className="h-4 w-4" /> Decline
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {em.eventMeta.pendingDateChange && (
          <div className="mt-4 mb-6">
            <DateChangeBanner
              event={event}
              pendingDateChange={em.eventMeta.pendingDateChange}
              currentUid={em.user?.uid || ""}
              userProfileIds={userProfileIds}
              onConfirm={(profileId) => em.respondToDateChange(profileId, "confirmed")}
              onDecline={(profileId) => em.respondToDateChange(profileId, "declined")}
              onCancel={() => em.cancelDateChange()}
            />
          </div>
        )}

        {em.activeTab === "budget" && em.isParent && (
          <div className="space-y-6">
            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <h3 className="font-display text-lg font-semibold mb-4">Performer Guarantees</h3>
              <div className="space-y-3">
                {em.childEvents.map(child => {
                  const deal = em.childEconomics[child.id]?.deal;
                  return (
                    <div key={child.id} className="flex items-center justify-between rounded-lg border p-3">
                      <div>
                        <p className="font-medium text-sm">
                          <ProfilePreviewPopover
                            name={child.artist}
                            profileId={child.performerProfileId}
                            onInvite={() => { setInviteDefaults({ role: "Performer", name: child.artist, eventId: child.id }); setInviteOpen(true); }}
                          />
                        </p>
                        <p className="text-xs text-muted-foreground capitalize">
                          {deal?.dealType?.replace("_", " ") || "—"}{child.roomStage ? ` · ${child.roomStage}` : ""}
                        </p>
                      </div>
                      <p className="font-semibold text-sm">{formatCurrency(deal?.artistGuarantee || 0, em.eventCurrency)}</p>
                    </div>
                  );
                })}
                <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3 font-semibold">
                  <span>Total Guarantees</span>
                  <span>{formatCurrency(em.childEvents.reduce((s, c) => s + (em.childEconomics[c.id]?.deal?.artistGuarantee || 0), 0), em.eventCurrency)}</span>
                </div>
              </div>
            </div>
            <BudgetPlannerTab canAccessBudget={em.canAccessBudget} event={event} revenue={em.revenue} eventMeta={em.eventMeta} currency={em.eventCurrency} budgetProfileChoices={em.budgetProfileChoices} budgetProfileId={em.resolvedBudgetProfileId} onBudgetProfileIdChange={em.handleBudgetProfileChange} onSave={onSaveMeta} childArtistFees={em.childEvents.map(c => ({ artist: c.artist, fee: em.childEconomics[c.id]?.deal?.artistGuarantee || 0 }))} />
          </div>
        )}
        {em.activeTab === "budget" && !em.isParent && (
          <BudgetPlannerTab canAccessBudget={em.canAccessBudget} event={event} revenue={em.revenue} eventMeta={em.eventMeta} currency={em.eventCurrency} budgetProfileChoices={em.budgetProfileChoices} budgetProfileId={em.resolvedBudgetProfileId} onBudgetProfileIdChange={em.handleBudgetProfileChange} onSave={onSaveMeta} todoBudgetItems={em.todoBudgetItems} />
        )}
        {em.activeTab === "details" && (
          <EventDetailsTab event={event} deal={em.effectiveDeal} revenue={em.revenue} eventMeta={em.eventMeta} updateEvent={em.updateEvent} updateDeal={em.updateDeal} updateRevenue={em.updateRevenue} currency={em.eventCurrency} onSave={onSaveMeta} childEvents={em.isParent ? em.childEvents : undefined} actingProfile={em.actingProfile} collaborators={em.collaborators} readOnly={em.isPerformer} onInvitePerformer={(name, childEventId) => { setInviteDefaults({ role: "Performer", name, eventId: childEventId }); setInviteOpen(true); }} />
        )}
        {em.activeTab === "agreement" && !em.isParent && (
          <AgreementTab event={event} deal={em.effectiveDeal} revenue={em.revenue} eventMeta={em.eventMeta} onSave={onSaveMeta} currency={em.eventCurrency} actingProfile={em.actingProfile} collaborators={em.collaborators} readOnly={em.isPerformer} onConfirmed={() => {
            upsertEvent({ ...event, eventStatus: "confirmed" });
            appendEventActivity(id, "status_changed", "System", {
              from: eventStatusLabels[event.eventStatus] ?? event.eventStatus,
              to: eventStatusLabels["confirmed"],
              reason: "All parties confirmed the agreement",
            });
          }} />
        )}
        {em.activeTab === "collaborators" && (
          <CollaboratorsTab event={event} collaborators={em.collaborators} profiles={em.profiles} onInviteOpen={() => setInviteOpen(true)} />
        )}
        {em.activeTab === "crew" && !em.economicsLoaded && (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-40 w-full rounded-xl" />
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
        )}
        {em.activeTab === "crew" && em.economicsLoaded && (
          <CrewTab eventMeta={em.eventMeta} event={event} collaborators={em.collaborators} onSave={onSaveMeta} actingProfile={em.actingProfile} profileTodos={em.profileTodos} saveProfileTodos={em.saveProfileTodos} isPerformer={em.isPerformer} />
        )}
        {em.activeTab === "todo" && (
          <TodoTab todos={em.profileTodos} event={event} onSaveTodos={em.saveProfileTodos} teamMemberNames={em.teamMembers.map(m => m.name)} teamMembers={em.teamMembers} onCreateMember={handleCreateTeamMember} />
        )}
        {em.activeTab === "performers" && em.isParent && (
          <PerformersTab childEvents={em.childEvents} childEconomics={em.childEconomics} eventCurrency={em.eventCurrency} />
        )}
        {em.activeTab === "settlement" && !em.isParent && !em.economicsLoaded && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="rounded-xl border bg-card p-5 shadow-sm space-y-2">
                  <Skeleton className="h-3 w-24" /><Skeleton className="h-7 w-32" /><Skeleton className="h-3 w-16" />
                </div>
              ))}
            </div>
            <div className="rounded-xl border bg-card p-6 shadow-sm space-y-3">
              <Skeleton className="h-5 w-40" />
              {[...Array(4)].map((_, i) => <div key={i} className="flex items-center justify-between"><Skeleton className="h-4 w-36" /><Skeleton className="h-4 w-20" /></div>)}
              <div className="border-t pt-3 flex items-center justify-between"><Skeleton className="h-4 w-28" /><Skeleton className="h-5 w-24" /></div>
            </div>
            <div className="rounded-xl border bg-card p-6 shadow-sm flex items-center gap-4">
              <Skeleton className="h-8 w-32 rounded-full" /><Skeleton className="h-8 w-28" /><Skeleton className="h-8 w-28" />
            </div>
          </div>
        )}
        {em.activeTab === "settlement" && !em.isParent && em.economicsLoaded && (
          <SettlementTab event={event} deal={em.effectiveDeal} revenue={em.revenue} settlement={em.settlement} updateSettlementStatus={em.updateSettlementStatus} addComment={em.addComment} generateShareLink={em.generateShareLink} currentUser={em.currentUser} />
        )}
        {em.activeTab === "messages" && <EventMessages eventId={id} />}
        {em.activeTab === "changelog" && <EventChangeLogTab eventId={id} isPerformer={em.isPerformer} childEvents={em.isParent ? em.childEvents : undefined} />}

        <InviteCollaboratorDialog open={inviteOpen} onOpenChange={(v) => { setInviteOpen(v); if (!v) setInviteDefaults({}); }} eventName={event.name} eventId={inviteDefaults.eventId || id} defaultRole={inviteDefaults.role} defaultName={inviteDefaults.name} onCollaboratorAdded={() => {
          em.refreshCollaborators();
          // When inviting a performer on a child event that's still in draft, promote it to suggested
          const targetId = inviteDefaults.eventId;
          if (targetId && targetId !== id) {
            const child = em.childEvents.find(c => c.id === targetId);
            if (child && child.eventStatus === "draft") {
              em.updateEvent(targetId, { eventStatus: "suggested" });
            }
          }
        }} />
        <ExportEventDialog open={exportOpen} onOpenChange={setExportOpen} eventName={event.name} eventId={id} eventStatus={event.eventStatus} creatorName={em.currentUser.name} teamMembers={em.teamMembers} eventData={{ event, deal: em.effectiveDeal, revenue: em.revenue, settlement: em.settlement, eventMeta: em.eventMeta, currency: em.eventCurrency }} />
        {em.isParent ? (
          <SuggestToPerformersDialog open={markPendingOpen} onOpenChange={setMarkPendingOpen} parentEventId={id} childEvents={em.childEvents} updateEvent={em.updateEvent} user={em.user} eventName={event.name} queryClient={queryClient} onCollaboratorAdded={em.refreshCollaborators} senderName={em.currentUser?.name || em.user?.displayName || em.user?.email || "A shoWMe user"} />
        ) : (
          <MarkPendingDialog open={markPendingOpen} onOpenChange={setMarkPendingOpen} event={event} sourceRequestId={em.effectiveSourceRequestId} sourceRequestDate={em.effectiveSourceRequestDate} updateEvent={em.updateEvent} user={em.user} eventName={event.name} queryClient={queryClient} onCollaboratorAdded={em.refreshCollaborators} senderName={em.currentUser?.name || em.user?.displayName || em.user?.email || "A shoWMe user"} />
        )}
        <ArchiveDialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen} eventId={id} event={event} user={em.user} archiveMutate={em.archiveEventMutation.mutate} />

        <CreateEventDialog
          externalOpen={duplicateOpen}
          onExternalOpenChange={setDuplicateOpen}
          prefillData={{
            artistName: event.artist,
            venueName: event.venue,
            dealType: em.effectiveDeal?.dealType,
            artistGuarantee: em.effectiveDeal?.artistGuarantee ? String(em.effectiveDeal.artistGuarantee) : undefined,
            artistSplit: em.effectiveDeal?.artistSplit != null ? String(em.effectiveDeal.artistSplit) : undefined,
            promoterSplit: em.effectiveDeal?.promoterSplit != null ? String(em.effectiveDeal.promoterSplit) : undefined,
            venueSplit: em.effectiveDeal?.venueSplit != null ? String(em.effectiveDeal.venueSplit) : undefined,
          } satisfies PrefillData}
          defaultStatus="draft"
          onEventCreated={(newId) => em.navigate({ to: "/events/$id", params: { id: newId } })}
        />
      </div>
    </AppLayout>
  );
}
