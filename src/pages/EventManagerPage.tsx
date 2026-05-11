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
import { userHasEventAccess } from "@/lib/eventPermissions";
import type { PrefillData } from "@/components/create-event/types";

export default function EventManagerPage() {
  const em = useEventManager();
  const queryClient = useQueryClient();
  const updateEventMutation = useUpdateEvent();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteDefaults, setInviteDefaults] = useState<{ role?: string; name?: string; eventId?: string }>({});
  // Set when the rich invite dialog is opened from the "Suggest to Performer"
  // button (no performer linked yet). On successful invitation, the parent
  // event must flip from draft → suggested. The MarkPendingDialog confirm path
  // doesn't cover this case anymore; the rich dialog does.
  const [flipToSuggestedOnInvite, setFlipToSuggestedOnInvite] = useState(false);
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

  // Collect profile IDs the current user controls (for date change banner matching).
  // Sourced from allProfiles (flat, no slot dedupe) so users with multiple
  // profiles per role — e.g. a performer profile + a collaborator stub also
  // tagged performer — see all of them, not just whichever the slot Record kept.
  const userProfileIds = useMemo(
    () => em.allProfiles.map((p) => p.id).filter(Boolean) as string[],
    [em.allProfiles],
  );

  // For single-performer events, surface the deal.artistGuarantee in the Budget
  // Calculator's performer-fee row. Memoized so the BudgetCalculator's effect
  // doesn't re-run on every parent render.
  const singlePerformerFees = useMemo(() => {
    if (em.isParent || !em.event) return undefined;
    return [{ artist: em.event.artist || "Performer", fee: em.effectiveDeal?.artistGuarantee ?? 0 }];
  }, [em.isParent, em.event?.artist, em.effectiveDeal?.artistGuarantee]);

  if (!em.eventsLoaded || em.eventLoading) return <EventManagerSkeleton />;
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

  // The Firestore rules grant public read access to any published+confirmed
  // event so the /event/$id surface and Share & Export can render anonymously.
  // That same read-permission means a signed-in user typing the manager URL
  // for an event they're not on would otherwise see the full editor. Gate it
  // explicitly here: only members of the event (via uid or one of their
  // profiles) get the manager view; everyone else is bounced to the public
  // viewer if it exists, or to their events list.
  const hasAccess =
    userHasEventAccess(em.event, em.user?.uid, userProfileIds) || em.isPerformer;
  if (!hasAccess) {
    const isPublic = em.event.published === true && em.event.eventStatus === "confirmed";
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center px-6">
          <p className="text-lg font-semibold">You don't have access to this event</p>
          <p className="text-sm text-muted-foreground max-w-md">
            Ask the event owner to invite you as a collaborator.
          </p>
          <div className="flex gap-2">
            <Link to="/events" className="text-sm text-primary hover:underline">Back to events</Link>
            {isPublic && (
              <Link to="/event/$id" params={{ id: em.id! }} className="text-sm text-primary hover:underline">
                View public page
              </Link>
            )}
          </div>
        </div>
      </AppLayout>
    );
  }

  const { event, id } = em;
  const onSaveMeta = (d: Partial<EventMeta>) => { if (id) em.updateEventMeta(id, d); };

  // "Suggest to Performer" — when no performer is linked and there's no source
  // request, the user is really trying to invite someone. Route to the rich
  // InviteCollaboratorDialog so the experience matches inviting a collaborator
  // from the performer card. Status flip happens in onCollaboratorAdded.
  const handleMarkPendingClick = () => {
    if (em.isParent) {
      setMarkPendingOpen(true);
      return;
    }
    const fromRequest = !!em.effectiveSourceRequestId;
    const onPlatform = !!event.performerProfileId;
    const needsInvitation = event.eventStatus === "draft" && !fromRequest && !onPlatform;
    if (needsInvitation) {
      setFlipToSuggestedOnInvite(true);
      setInviteDefaults({ role: "Performer", name: event.artist, eventId: id });
      setInviteOpen(true);
      return;
    }
    setMarkPendingOpen(true);
  };
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
          onMarkPendingOpen={handleMarkPendingClick}
          onExportOpen={() => setExportOpen(true)}
          onArchiveOpen={() => setArchiveConfirmOpen(true)}
          onDuplicate={() => setDuplicateOpen(true)}
          effectiveSourceRequestId={em.effectiveSourceRequestId}
          effectiveSourceRequestDate={em.effectiveSourceRequestDate}
          isPerformer={em.isPerformer}
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

        {event.autoCancelledReason === "expired_unconfirmed" && (
          <div className="mt-4 mb-6 rounded-xl border-2 border-red-400/50 bg-red-50/80 dark:bg-red-950/20 dark:border-red-500/30 p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-red-100 dark:bg-red-900/40 p-2 shrink-0 mt-0.5">
                <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-sm">Event auto-cancelled</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  The event date passed without being confirmed, so the system moved it to Cancelled. It stays in your records for any settlement or follow-up.
                </p>
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
          <BudgetPlannerTab canAccessBudget={em.canAccessBudget} event={event} revenue={em.revenue} eventMeta={em.eventMeta} currency={em.eventCurrency} budgetProfileChoices={em.budgetProfileChoices} budgetProfileId={em.resolvedBudgetProfileId} onBudgetProfileIdChange={em.handleBudgetProfileChange} onSave={onSaveMeta} todoBudgetItems={em.todoBudgetItems} childArtistFees={singlePerformerFees} />
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
          }} onReopened={(reason) => {
            if (event.eventStatus !== "confirmed") return;
            upsertEvent({ ...event, eventStatus: "pending" });
            appendEventActivity(id, "status_changed", "System", {
              from: eventStatusLabels["confirmed"],
              to: eventStatusLabels["pending"] ?? "pending",
              reason,
            });
          }} />
        )}
        {em.activeTab === "collaborators" && (
          <CollaboratorsTab event={event} collaborators={em.collaborators} profiles={em.profiles} onRefresh={em.refreshCollaborators} />
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

        <InviteCollaboratorDialog open={inviteOpen} onOpenChange={(v) => { setInviteOpen(v); if (!v) { setInviteDefaults({}); setFlipToSuggestedOnInvite(false); } }} eventName={event.name} eventId={inviteDefaults.eventId || id} defaultRole={inviteDefaults.role} defaultName={inviteDefaults.name} restrictToViewOnly={em.isPerformer} onCollaboratorAdded={() => {
          em.refreshCollaborators();
          const targetId = inviteDefaults.eventId;
          // "Suggest to Performer" routed here because no performer was linked.
          // Promote the (single) event from draft → suggested now that the
          // invitation exists.
          if (flipToSuggestedOnInvite && targetId === id && event.eventStatus === "draft") {
            em.updateEvent(id, { eventStatus: "suggested" });
            setFlipToSuggestedOnInvite(false);
          } else if (targetId && targetId !== id) {
            // Inviting a performer on a child event that's still in draft — promote it to suggested
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
          <MarkPendingDialog open={markPendingOpen} onOpenChange={setMarkPendingOpen} event={event} sourceRequestId={em.effectiveSourceRequestId} sourceRequestDate={em.effectiveSourceRequestDate} updateEvent={em.updateEvent} />
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
