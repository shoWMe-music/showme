import { useState, useMemo, useEffect, useCallback } from "react";
import { useParams, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  useUpdateEvent, useArchiveEvent, useHoldRankMutations,
  useRespondToDateChange, useCancelDateChange,
} from "@/lib/queries/useEventMutations";
import {
  useEventEconomics, useAllEventEconomics, useUpdateSettlementStatus, useAddComment,
  useEvents, useEventsLoaded, useEvent, useChildEvents,
  useUpdateDeal, useUpdateRevenue, useUpdateAnyEventMeta,
  useEventActivityLog,
  queryKeys,
} from "@/lib/queries";
import { upsertShareToken, fetchEventCollaborators, fetchBookingRequestByEventId, fetchProfileTodos, upsertProfileTodos, migrateMetaTodosToProfile, type EventMeta, type Todo } from "@/lib/db";
import { useUser } from "@/lib/user-context";
import { useAuth } from "@/lib/auth-context";
import { usePublishEventToggle } from "@/hooks/usePublishEventToggle";
import { budgetProfileDocIdsForEvent, canAccessEventBudget, resolveActingProfileName, resolveActingProfileId } from "@/lib/eventPermissions";
import type { EventCollaborator, DealStructure, TicketRevenue, Settlement } from "@/lib/models";

export type TabId = "budget" | "details" | "agreement" | "crew" | "todo" | "settlement" | "messages" | "performers" | "changelog" | "collaborators";

const PARENT_TABS: TabId[] = ["todo", "budget", "details", "performers", "collaborators", "crew", "changelog"];
const STANDARD_TABS: TabId[] = ["todo", "budget", "details", "agreement", "crew", "settlement", "messages", "collaborators", "changelog"];

export function useEventManager() {
  const { id } = useParams({ from: "/events/$id" });
  const { tab: tabParam } = useSearch({ from: "/events/$id" });
  const navigate = useNavigate();
  const [collaborators, setCollaborators] = useState<EventCollaborator[]>([]);

  const refreshCollaborators = () => {
    if (id) fetchEventCollaborators(id).then(setCollaborators);
  };

  useEffect(() => { refreshCollaborators(); }, [id]);

  const allEventsMain = useEvents();
  const eventsLoaded = useEventsLoaded();
  const event = useEvent(id ?? "");
  const childEventsList = useChildEvents(id ?? "");
  const childEconomics = useAllEventEconomics(childEventsList.map((c) => c.id));
  const updateEventMutation = useUpdateEvent();
  const archiveEventMutation = useArchiveEvent();
  const updateDealMutation = useUpdateDeal();
  const updateRevenueMutation = useUpdateRevenue();
  const updateEventMetaFn = useUpdateAnyEventMeta();
  const { promoteHoldsOnDate, resolveHoldRankConflicts } = useHoldRankMutations();
  const respondToDateChangeMutation = useRespondToDateChange();
  const cancelDateChangeMutation = useCancelDateChange();
  const { currentUser, teamMembers, addTeamMember, profiles } = useUser();
  const { user } = useAuth();
  const [eventCurrency, setEventCurrency] = useState(currentUser?.currency || "EUR");

  const { isLoaded: economicsLoaded, settlement: settlementRaw, deal: dealRaw, revenue: revenueRaw, meta: eventMeta } = useEventEconomics(id ?? "");
  const updateSettlementStatusMutation = useUpdateSettlementStatus();
  const addCommentMutation = useAddComment();

  const revenue = revenueRaw || (event ? {
    eventId: event.id, ticketsSold: 0, grossRevenue: 0, ticketFees: 0,
    tax: 0, refunds: 0, doorSales: 0, productionExpenses: 0, additionalCosts: 0,
  } as TicketRevenue : undefined);

  const settlement = settlementRaw || (event ? {
    eventId: event.id, promoterPayout: 0, artistPayout: 0, venuePayout: 0, commissionPayouts: [],
    status: "open" as const, approvals: [
      { party: "Operator", approved: false },
      { party: "Performer", approved: false },
      { party: "Venue", approved: false },
    ], comments: [], revisions: [],
  } as Settlement : undefined);

  // For events created before sourceRequestId was added, look up the linked request by event_id.
  // Only runs when sourceRequestId is missing and the event is loaded.
  const linkedRequestQuery = useQuery({
    queryKey: queryKeys.bookingRequestForEvent(id ?? ""),
    queryFn: () => fetchBookingRequestByEventId(id ?? ""),
    enabled: !!id && !!event && !event.sourceRequestId,
    staleTime: Infinity,
  });

  // Backfill sourceRequestId / sourceRequestDate onto the event document once detected.
  useEffect(() => {
    if (!id || !event || event.sourceRequestId || !linkedRequestQuery.data) return;
    updateEventMetaFn(id, {}); // ensure meta exists
    updateEventMutation.mutate({
      id,
      updates: {
        sourceRequestId: linkedRequestQuery.data.id,
        ...(linkedRequestQuery.data.wanted_date ? { sourceRequestDate: linkedRequestQuery.data.wanted_date } : {}),
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedRequestQuery.data]);

  // Effective source request info: prefer fields on event, fall back to linked-request query result.
  const effectiveSourceRequestId = event?.sourceRequestId || linkedRequestQuery.data?.id;
  const effectiveSourceRequestDate = event?.sourceRequestDate || linkedRequestQuery.data?.wanted_date;

  const effectiveDeal = useMemo(
    () => dealRaw || (event ? {
      eventId: event.id, dealType: "guarantee" as const, artistGuarantee: 0,
      artistSplit: 80, promoterSplit: 10, venueSplit: 10, organizerSplit: 0,
      artistCostSplit: 0, promoterCostSplit: 50, venueCostSplit: 50, organizerCostSplit: 0, venueRental: 0,
      commissions: [],
    } satisfies DealStructure : undefined),
    [dealRaw, event],
  );

  const budgetProfileChoices = useMemo(
    () => budgetProfileDocIdsForEvent(event, user?.uid || "", profiles),
    [event, user?.uid, profiles],
  );

  const resolvedBudgetProfileId =
    (typeof eventMeta.budgetProfileId === "string" && eventMeta.budgetProfileId.trim())
      ? eventMeta.budgetProfileId.trim()
      : budgetProfileChoices[0]?.id || "";

  const isParent = !!event?.isMultiPerformer || childEventsList.length > 0;
  const isChild = !!event?.parentEventId;
  const parentEvent = isChild && event?.parentEventId
    ? allEventsMain.find((e) => e.id === event!.parentEventId)
    : undefined;
  const childEvents = event && isParent ? childEventsList : [];
  const canAccessBudget = Boolean(user?.uid && canAccessEventBudget(event, user.uid));
  const actingProfile = resolveActingProfileName(event, profiles);
  const actingProfileId = resolveActingProfileId(event, profiles);
  const todoScopeId = actingProfileId || (user?.uid ? `user_${user.uid}` : "");

  // Profile-scoped todos
  const [profileTodos, setProfileTodos] = useState<Todo[]>([]);
  const [todosLoaded, setTodosLoaded] = useState(false);

  useEffect(() => {
    if (!id || !todoScopeId) return;
    let cancelled = false;

    (async () => {
      // Try loading from profile-scoped document first
      let todos = await fetchProfileTodos(id, todoScopeId);

      // If empty, check for legacy todos in meta/main and migrate
      if (todos.length === 0) {
        todos = await migrateMetaTodosToProfile(id, todoScopeId);
      }

      if (!cancelled) {
        setProfileTodos(todos);
        setTodosLoaded(true);
      }
    })();

    return () => { cancelled = true; };
  }, [id, todoScopeId]);

  const todoBudgetItems = useMemo(
    () => profileTodos
      .filter((t: Todo) => t.budgetType && t.budgetAmount && !t.completed)
      .map((t: Todo) => ({ id: t.id, name: t.title, type: t.budgetType!, amount: t.budgetAmount! })),
    [profileTodos],
  );

  const saveProfileTodos = useCallback((todos: Todo[]) => {
    setProfileTodos(todos);
    if (id && todoScopeId) {
      upsertProfileTodos(id, todoScopeId, todos);
    }
  }, [id, todoScopeId]);

  // True when the current user is the performer on this event (not the host).
  // For multi-performer parent events, true if the user is a performer on any child event.
  const isPerformer = useMemo(() => {
    if (!event) return false;
    const myArtistProfileIds = Object.values(profiles)
      .filter(p => p.role === "performer" && p.id)
      .map(p => p.id!);
    if (myArtistProfileIds.length === 0) return false;
    const myProfileIds = Object.values(profiles).map(p => p.id).filter(Boolean) as string[];
    const isHost = myProfileIds.includes(event.hostProfileId || "");
    if (isHost) return false;

    // Single-performer event
    if (event.performerProfileId) {
      return myArtistProfileIds.includes(event.performerProfileId);
    }

    // Multi-performer parent: check if user is a performer on any child event
    if (event.isMultiPerformer && childEventsList.length > 0) {
      return childEventsList.some(child =>
        child.performerProfileId && myArtistProfileIds.includes(child.performerProfileId)
      );
    }

    return false;
  }, [event, profiles, childEventsList]);

  // True when performer is viewing a suggested (invitation) event specifically
  const isPerformerInvitation = isPerformer && event?.eventStatus === "suggested" && event?.performerResponse !== "declined";

  const userProfileIds = Object.values(profiles).map((p) => p.id).filter(Boolean) as string[];
  const updateEvent = (eid: string, updates: Partial<typeof allEventsMain[0]>) =>
    updateEventMutation.mutate({ id: eid, updates, actingProfile, collaborators, userProfileIds });
  const updateDeal = (eid: string, deal: DealStructure) =>
    updateDealMutation.mutate({ eventId: eid, deal, actingProfile });
  const updateRevenue = (eid: string, rev: TicketRevenue) =>
    updateRevenueMutation.mutate({ eventId: eid, newRevenue: rev, actingProfile });
  const updateEventMeta = (eid: string, data: Record<string, unknown>) =>
    updateEventMetaFn(eid, data);
  const handleBudgetProfileChange = (nextPid: string) => {
    if (id) updateEventMetaFn(id, { budgetProfileId: nextPid });
  };

  const togglePublish = usePublishEventToggle(updateEvent);

  const generateShareLink = (eventId: string, parties: string[]): string | null => {
    const token = `review-${eventId}`;
    if (!event || !effectiveDeal || !revenue || !settlement) {
      toast({ title: "Cannot generate share link", description: "Financial data not loaded yet. Please try again.", variant: "destructive" });
      return null;
    }
    const snapshot = { event, deal: effectiveDeal, revenue, settlement };
    void upsertShareToken(token, eventId, parties, snapshot);
    return `${window.location.origin}/review/${token}`;
  };

  const updateSettlementStatus = (eventId: string, status: Parameters<typeof updateSettlementStatusMutation.mutate>[0]["status"]) =>
    updateSettlementStatusMutation.mutate({ eventId, status, actingProfile });

  const addComment = (eventId: string, party: string, message: string, attachments?: { name: string; size: number; type: string; fileUrl: string }[]) =>
    addCommentMutation.mutate({ eventId, party, message, attachments, date: new Date().toISOString().slice(0, 10), actingProfile });

  const respondToDateChange = (profileId: string, response: "confirmed" | "declined") => {
    if (!id) return;
    respondToDateChangeMutation.mutate({ eventId: id, profileId, response, actingProfile });
  };

  const cancelDateChange = () => {
    if (!id) return;
    cancelDateChangeMutation.mutate({ eventId: id, actingProfile });
  };

  // Change log badge: count entries newer than last viewed timestamp
  const { entries: changeLogEntries } = useEventActivityLog(id ?? "");
  const changeLogStorageKey = `changelog_last_viewed_${id}`;
  const changeLogBadgeCount = useMemo(() => {
    const lastViewed = localStorage.getItem(changeLogStorageKey);
    if (!lastViewed) return changeLogEntries.length;
    return changeLogEntries.filter(e => e.timestamp > lastViewed).length;
  }, [changeLogEntries, changeLogStorageKey]);

  const markChangeLogViewed = useCallback(() => {
    localStorage.setItem(changeLogStorageKey, new Date().toISOString());
  }, [changeLogStorageKey]);

  const allTabs: { id: TabId; label: string; badge?: number }[] = isParent
    ? [
        { id: "todo", label: "To Do" },
        { id: "budget", label: "Budget Planner" },
        { id: "details", label: "Event Details" },
        { id: "performers", label: `Performers (${childEvents.length})` },
        { id: "collaborators", label: "Collaborators" },
        { id: "crew", label: "Team / Crew" },
        { id: "changelog", label: "Event History", badge: changeLogBadgeCount },
      ]
    : [
        { id: "todo", label: "To Do" },
        { id: "budget", label: "Budget Planner" },
        { id: "details", label: "Event Details" },
        { id: "agreement", label: "Agreement" },
        { id: "crew", label: "Team / Crew" },
        { id: "settlement", label: "Settlement" },
        { id: "messages", label: "Messages" },
        { id: "collaborators", label: "Collaborators" },
        { id: "changelog", label: "Event History", badge: changeLogBadgeCount },
      ];
  const PERFORMER_TABS: TabId[] = ["details", "agreement", "crew", "messages", "changelog"];
  const filteredTabs = isPerformer
    ? allTabs.filter((t) => PERFORMER_TABS.includes(t.id))
    : allTabs;
  const tabs = filteredTabs;

  const getAllowedTabs = useCallback((): TabId[] => {
    if (isPerformer) return PERFORMER_TABS;
    return (isParent ? PARENT_TABS : STANDARD_TABS) as TabId[];
  }, [isParent, isPerformer]);

  const activeTab = useMemo((): TabId => {
    const allowed = getAllowedTabs();
    if (tabParam && allowed.includes(tabParam as TabId)) return tabParam as TabId;
    return allowed.includes("details") ? "details" : allowed[0] ?? "details";
  }, [getAllowedTabs, tabParam]);

  // Redirect performers viewing a parent event to their specific child event
  useEffect(() => {
    if (!eventsLoaded || !event || !isParent || !isPerformer) return;
    const myArtistProfileIds = Object.values(profiles)
      .filter(p => p.role === "performer" && p.id)
      .map(p => p.id!);
    const myChild = childEventsList.find(
      c => c.performerProfileId && myArtistProfileIds.includes(c.performerProfileId),
    );
    if (myChild) {
      navigate({ to: "/events/$id", params: { id: myChild.id }, replace: true });
    }
  }, [eventsLoaded, event, isParent, isPerformer, childEventsList, profiles, navigate]);

  useEffect(() => {
    if (!eventsLoaded || !id) return;
    const allowed = getAllowedTabs();
    if (tabParam && !allowed.includes(tabParam as TabId)) {
      navigate({ to: "/events/$id", params: { id }, search: {}, replace: true });
    }
  }, [eventsLoaded, id, getAllowedTabs, tabParam, navigate]);

  return {
    id, navigate, eventsLoaded, event, isParent, isChild, isPerformer, isPerformerInvitation, parentEvent, childEvents, childEconomics,
    collaborators, setCollaborators, refreshCollaborators, eventCurrency, setEventCurrency,
    economicsLoaded, eventMeta, effectiveDeal, revenue, settlement,
    todoBudgetItems, budgetProfileChoices, resolvedBudgetProfileId, canAccessBudget,
    tabs, activeTab,
    updateEvent, updateDeal, updateRevenue, updateEventMeta, archiveEventMutation,
    togglePublish, promoteHoldsOnDate, resolveHoldRankConflicts,
    generateShareLink, updateSettlementStatus, addComment, handleBudgetProfileChange,
    respondToDateChange, cancelDateChange,
    currentUser, teamMembers, addTeamMember, user, actingProfile, profiles,
    effectiveSourceRequestId, effectiveSourceRequestDate,
    profileTodos, saveProfileTodos, todosLoaded, todoScopeId,
    markChangeLogViewed,
  };
}
