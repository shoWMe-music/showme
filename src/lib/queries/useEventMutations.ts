/**
 * Event-level mutation hooks.
 *
 * Fully implemented: useUpdateEvent, useArchiveEvent, useUnarchiveEvent,
 * useAddEvent, useAddMultiPerformerEvent, useAddChildEvent,
 * useRemoveChildEvent, useConvertToMultiPerformer.
 */

import { createElement } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { getAuthClient } from "@/lib/firebaseAuth";
import {
  upsertEvent,
  upsertDeal,
  upsertRevenue,
  upsertSettlement,
  upsertShareToken,
  appendEventActivity,
  upsertEventMeta,
  clearPendingDateChange,
  fetchProfileOwnerUid,
  moveMessages,
  addEventCollaborator,
  fetchEventMeta,
} from "@/lib/db";
import type { PendingDateChange, DateChangeConfirmation } from "@/lib/db";
import type { Event, EventCollaborator, DealStructure, Settlement, SettlementStatus } from "@/lib/models";
import { eventStatusLabels, collaboratorIsActive } from "@/lib/models";
import { isPrimaryEventOwner } from "@/lib/eventPermissions";
import type { SharedProfile } from "@/lib/user-context";
import { buildSettlementUpdate, emptyRevenue } from "@/lib/settlementUtils";
import { toast } from "@/hooks/use-toast";
import { queryKeys } from "./keys";

function savedToast(label: string) {
  toast({
    title: createElement("span", { className: "flex items-center gap-2" },
      createElement(CheckCircle2, { className: "h-4 w-4 text-emerald-500" }),
      label,
    ),
    duration: 1000,
  });
}
import type { ShareToken } from "./useShareTokensQuery";
import type { EventEconomicsData } from "./useEventEconomics";
import type { EventStatus } from "@/lib/models";

// ── Parent status derivation ─────────────────────────────────────────────────

const STATUS_RANK: Record<EventStatus, number> = {
  cancelled: -1,
  draft: 0,
  suggested: 1,
  on_hold: 2,
  pending: 3,
  confirmed: 4,
  concluded: 5,
};

/**
 * Derive the parent event status from its children.
 * - All children at least pending → parent becomes pending
 * - All children at least confirmed → parent becomes confirmed
 * - All children concluded → parent becomes concluded
 * Cancelled children are ignored (they don't block progression).
 */
function deriveParentStatus(children: Event[]): EventStatus | null {
  const active = children.filter((c) => !c.archived && c.eventStatus !== "cancelled");
  if (active.length === 0) return null;
  const minRank = Math.min(...active.map((c) => STATUS_RANK[c.eventStatus] ?? 0));
  if (minRank >= STATUS_RANK.concluded) return "concluded";
  if (minRank >= STATUS_RANK.confirmed) return "confirmed";
  if (minRank >= STATUS_RANK.pending) return "pending";
  return null;
}

// ── Date change confirmation helpers ──────────────────────────────────────────

const DATE_CHANGE_FIELDS: (keyof Event)[] = ["date", "startTime", "endTime"];

export interface DateChangeParty {
  profileId: string;
  role: "performer" | "venue";
  profileName: string;
  onPlatform: boolean;
}

/**
 * Determines which profiles need to confirm a date change.
 * - Performer: event.performerProfileId or collaborators with eventRole "artist"
 * - Venue: collaborators with eventRole "venue" (only if organizer is NOT the venue)
 * Parties whose profile is controlled by the current user (proposer) are excluded —
 * you don't need to confirm your own change.
 */
export function getDateChangeParties(
  event: Event,
  collaborators: EventCollaborator[],
  currentUserProfileIds?: string[],
): DateChangeParty[] {
  const parties: DateChangeParty[] = [];
  const myIds = new Set(currentUserProfileIds ?? []);

  // Performer party
  const performerCollab = collaborators.find(
    (c) => c.eventRole === "performer" && collaboratorIsActive(c.status),
  );
  const performerProfileId = event.performerProfileId || performerCollab?.profileId;
  if (performerProfileId) {
    // Skip if the current user controls this profile
    if (!myIds.has(performerProfileId)) {
      parties.push({
        profileId: performerProfileId,
        role: "performer",
        profileName: performerCollab?.name || event.artist || "Performer",
        onPlatform: true,
      });
    }
  } else if (event.artist) {
    // Off-platform performer (no profileId, just a name)
    parties.push({
      profileId: `ext-performer-${event.id}`,
      role: "performer",
      profileName: event.artist,
      onPlatform: false,
    });
  }

  // Venue party (only if organizer is NOT the venue)
  if (event.operatorType !== "venue") {
    const venueCollab = collaborators.find(
      (c) => c.eventRole === "venue" && collaboratorIsActive(c.status),
    );
    if (venueCollab?.profileId) {
      // Skip if the current user controls this profile
      if (!myIds.has(venueCollab.profileId)) {
        parties.push({
          profileId: venueCollab.profileId,
          role: "venue",
          profileName: venueCollab.name || event.venue || "Venue",
          onPlatform: true,
        });
      }
    } else if (event.venue) {
      parties.push({
        profileId: `ext-venue-${event.id}`,
        role: "venue",
        profileName: event.venue,
        onPlatform: false,
      });
    }
  }

  return parties;
}

// ── useUpdateEvent ─────────────────────────────────────────────────────────────

interface UpdateEventVars {
  id: string;
  updates: Partial<Event>;
  actingProfile?: string;
  /** Pass collaborators to enable date-change confirmation flow. */
  collaborators?: EventCollaborator[];
  /** Profile IDs the current user controls — used to skip self-confirmation. */
  userProfileIds?: string[];
}

export function useUpdateEvent() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const uid = user?.uid ?? "";

  return useMutation({
    mutationFn: async ({ id, updates, collaborators, userProfileIds }: UpdateEventVars) => {
      const data = queryClient.getQueryData<Event[]>(queryKeys.events(uid));
      const current = data?.find((e) => e.id === id);
      if (!current) return;

      // Check if any date fields are changing
      const dateChanges: Partial<Pick<Event, "date" | "startTime" | "endTime">> = {};
      let hasDateChange = false;
      for (const field of DATE_CHANGE_FIELDS) {
        if (field in updates && updates[field] !== current[field]) {
          (dateChanges as Record<string, unknown>)[field] = updates[field];
          hasDateChange = true;
        }
      }

      // If date fields changed and there are parties to confirm, propose instead of apply
      if (hasDateChange && collaborators) {
        const parties = getDateChangeParties(current, collaborators, userProfileIds);
        if (parties.length > 0) {
          // Build pending date change
          const previousValues: PendingDateChange["previousValues"] = {};
          const proposedValues: PendingDateChange["proposedValues"] = {};
          for (const field of DATE_CHANGE_FIELDS) {
            if (field in dateChanges) {
              (previousValues as Record<string, unknown>)[field] = current[field] ?? "";
              (proposedValues as Record<string, unknown>)[field] = dateChanges[field as keyof typeof dateChanges];
            }
          }

          const confirmations: Record<string, DateChangeConfirmation> = {};
          for (const party of parties) {
            confirmations[party.profileId] = {
              status: "pending",
              role: party.role,
              profileName: party.profileName,
              onPlatform: party.onPlatform,
            };
          }

          const u = getAuthClient().currentUser;
          const pendingDateChange: PendingDateChange = {
            id: `dc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            proposedBy: u?.uid || uid,
            proposedAt: new Date().toISOString(),
            previousValues,
            proposedValues,
            confirmations,
          };

          // Strip date fields from the event update — they stay unchanged until confirmed
          const nonDateUpdates = { ...updates };
          for (const field of DATE_CHANGE_FIELDS) {
            delete (nonDateUpdates as Record<string, unknown>)[field];
          }

          await upsertEventMeta(id, { pendingDateChange });

          // Apply remaining (non-date) updates if any
          const nonDateKeys = Object.keys(nonDateUpdates);
          if (nonDateKeys.length > 0) {
            await upsertEvent({ ...current, ...nonDateUpdates });
          }

          return { dateChangeProposed: true, pendingDateChange };
        }
      }

      // Normal path — no date confirmation needed
      const merged = { ...current, ...updates };

      // When activating an event with a performer, ensure their UID is in accessUids
      if (
        updates.eventStatus &&
        (updates.eventStatus === "suggested" || updates.eventStatus === "pending") &&
        merged.performerProfileId
      ) {
        try {
          const performerUid = await fetchProfileOwnerUid(merged.performerProfileId);
          if (performerUid) {
            merged.accessUids = [...(merged.accessUids || []), performerUid];
          }
        } catch { /* non-critical */ }
      }

      await upsertEvent(merged);

      // Cascade cancellation to all children of a multi-performer parent
      if (
        updates.eventStatus === "cancelled" &&
        current.isMultiPerformer &&
        current.childEventIds?.length
      ) {
        const allEvents = queryClient.getQueryData<Event[]>(queryKeys.events(uid)) ?? [];
        const children = allEvents.filter(
          (e) => current.childEventIds!.includes(e.id) && !e.archived && e.eventStatus !== "cancelled",
        );
        for (const child of children) {
          await upsertEvent({ ...child, eventStatus: "cancelled" });
        }
        queryClient.setQueryData<Event[]>(queryKeys.events(uid), (old) => {
          if (!old) return old;
          const childIds = new Set(current.childEventIds);
          return old.map((e) =>
            childIds.has(e.id) ? { ...e, eventStatus: "cancelled" as const } : e,
          );
        });
      }

      return { dateChangeProposed: false };
    },
    onMutate: async ({ id, updates, collaborators, userProfileIds }: UpdateEventVars) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.events(uid) });
      const snapshot = queryClient.getQueryData<Event[]>(queryKeys.events(uid));

      // For optimistic update: if date change will be proposed, don't apply date fields
      const current = snapshot?.find((e) => e.id === id);
      let optimisticUpdates = updates;
      if (current && collaborators) {
        let hasDateChange = false;
        for (const field of DATE_CHANGE_FIELDS) {
          if (field in updates && updates[field] !== current[field]) {
            hasDateChange = true;
            break;
          }
        }
        if (hasDateChange) {
          const parties = getDateChangeParties(current, collaborators, userProfileIds);
          if (parties.length > 0) {
            optimisticUpdates = { ...updates };
            for (const field of DATE_CHANGE_FIELDS) {
              delete (optimisticUpdates as Record<string, unknown>)[field];
            }
          }
        }
      }

      queryClient.setQueryData<Event[]>(queryKeys.events(uid), (old) => {
        if (!old) return old;
        return old.map((e) => (e.id !== id ? e : { ...e, ...optimisticUpdates }));
      });

      return { snapshot };
    },
    onSuccess: (result, { id, updates, actingProfile, collaborators }, context) => {
      const oldEvent = context?.snapshot?.find((e) => e.id === id);
      if (!oldEvent) return;

      const u = getAuthClient().currentUser;
      const by = u?.displayName || u?.email || "Unknown";
      const invalidate = () => void queryClient.invalidateQueries({ queryKey: queryKeys.eventActivity(id) });

      // Date change was proposed — log activity and show toast
      if (result?.dateChangeProposed && result.pendingDateChange) {
        // Set the proposedByProfile now that we have actingProfile
        if (actingProfile) {
          result.pendingDateChange.proposedByProfile = actingProfile;
          void upsertEventMeta(id, { pendingDateChange: result.pendingDateChange });
        }

        const details: Record<string, string> = {};
        const pv = result.pendingDateChange.proposedValues;
        const prev = result.pendingDateChange.previousValues;
        if (pv.date) details.date = `${prev.date || ""} → ${pv.date}`;
        if (pv.startTime) details.startTime = `${prev.startTime || ""} → ${pv.startTime}`;
        if (pv.endTime) details.endTime = `${prev.endTime || ""} → ${pv.endTime}`;

        appendEventActivity(id, "date_change_proposed", by, details, invalidate, actingProfile);

        const partyNames = Object.values(result.pendingDateChange.confirmations)
          .map((c) => c.profileName)
          .join(", ");
        toast({
          title: createElement("span", { className: "flex items-center gap-2" },
            createElement(CheckCircle2, { className: "h-4 w-4 text-amber-500" }),
            "Date change proposed",
          ),
          description: `Awaiting confirmation from ${partyNames}`,
          duration: 3000,
        });

        // Invalidate meta so banner appears
        void queryClient.invalidateQueries({ queryKey: queryKeys.eventEconomics(id) });
        return;
      }

      if (updates.performerResponse === "accepted") {
        const performerName = oldEvent.artist || "Performer";
        appendEventActivity(id, "performer_accepted", "System", {
          performer: performerName,
        }, invalidate);
        savedToast("Invitation accepted");
      } else if (updates.performerResponse === "declined") {
        const performerName = oldEvent.artist || "Performer";
        appendEventActivity(id, "performer_declined", "System", {
          performer: performerName,
        }, invalidate);
        savedToast("Invitation declined");
      } else if (updates.eventStatus && updates.eventStatus !== oldEvent.eventStatus) {
        appendEventActivity(id, "status_changed", by, {
          from: eventStatusLabels[oldEvent.eventStatus] ?? oldEvent.eventStatus,
          to: eventStatusLabels[updates.eventStatus] ?? updates.eventStatus,
        }, invalidate, actingProfile);
        savedToast(`Status changed to ${eventStatusLabels[updates.eventStatus] ?? updates.eventStatus}`);
      }

      // If a child event's status changed, derive the parent status
      if (updates.eventStatus && oldEvent.parentEventId) {
        const allEvents = queryClient.getQueryData<Event[]>(queryKeys.events(uid)) ?? [];
        const parent = allEvents.find((e) => e.id === oldEvent.parentEventId);
        if (parent?.isMultiPerformer) {
          const children = allEvents.filter(
            (e) => parent.childEventIds?.includes(e.id) && !e.archived,
          );
          const derivedStatus = deriveParentStatus(children);
          if (derivedStatus && derivedStatus !== parent.eventStatus) {
            queryClient.setQueryData<Event[]>(queryKeys.events(uid), (old) => {
              if (!old) return old;
              return old.map((e) =>
                e.id !== parent.id ? e : { ...e, eventStatus: derivedStatus },
              );
            });
            void upsertEvent({ ...parent, eventStatus: derivedStatus });
          }
        }
      }

      const DETAIL_FIELDS: (keyof Event)[] = [
        "name", "date", "venue", "artist", "notes", "city",
        "capacity", "ticketingProvider", "roomStage",
        "startTime", "endTime", "doorTime", "curfew",
      ];
      const changedDetails: Record<string, string> = {};
      for (const field of DETAIL_FIELDS) {
        if (field in updates && updates[field] !== oldEvent[field]) {
          changedDetails[field] = `${String(oldEvent[field] ?? "")} → ${String(updates[field] ?? "")}`;
        }
      }
      if (Object.keys(changedDetails).length > 0) {
        appendEventActivity(id, "details_updated", by, changedDetails, invalidate, actingProfile);
        const fields = Object.keys(changedDetails);
        const label = fields.length === 1
          ? `${fields[0].charAt(0).toUpperCase() + fields[0].slice(1)} saved`
          : "Event details saved";
        savedToast(label);
      }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) {
        queryClient.setQueryData(queryKeys.events(uid), ctx.snapshot);
      }
      toast({ title: "Failed to save event", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.events(uid) });
    },
  });
}

// ── useArchiveEvent ────────────────────────────────────────────────────────────

export function useArchiveEvent() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const uid = user?.uid ?? "";

  return useMutation({
    mutationFn: async ({ id, actingProfile }: { id: string; actingProfile?: string }) => {
      const data = queryClient.getQueryData<Event[]>(queryKeys.events(uid));
      const e = data?.find((x) => x.id === id);
      if (!uid || !e || !isPrimaryEventOwner(e, uid)) return;
      await upsertEvent({ ...e, archived: true });
      const u = getAuthClient().currentUser;
      const by = u?.displayName || u?.email || "Unknown";
      appendEventActivity(id, "archived", by, undefined, undefined, actingProfile);
      savedToast("Event archived");
    },
    onMutate: async ({ id }: { id: string; actingProfile?: string }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.events(uid) });
      const snapshot = queryClient.getQueryData<Event[]>(queryKeys.events(uid));

      queryClient.setQueryData<Event[]>(queryKeys.events(uid), (old) => {
        if (!old) return old;
        return old.map((e) => (e.id !== id ? e : { ...e, archived: true }));
      });

      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) {
        queryClient.setQueryData(queryKeys.events(uid), ctx.snapshot);
      }
      toast({ title: "Failed to archive event", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.events(uid) });
    },
  });
}

// ── useUnarchiveEvent ──────────────────────────────────────────────────────────

export function useUnarchiveEvent() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const uid = user?.uid ?? "";

  return useMutation({
    mutationFn: async ({ id, actingProfile }: { id: string; actingProfile?: string }) => {
      const data = queryClient.getQueryData<Event[]>(queryKeys.events(uid));
      const e = data?.find((x) => x.id === id);
      if (!uid || !e || !isPrimaryEventOwner(e, uid)) return;
      await upsertEvent({ ...e, archived: false });
      const u = getAuthClient().currentUser;
      const by = u?.displayName || u?.email || "Unknown";
      appendEventActivity(id, "unarchived", by, undefined, undefined, actingProfile);
      savedToast("Event unarchived");
    },
    onMutate: async ({ id }: { id: string; actingProfile?: string }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.events(uid) });
      const snapshot = queryClient.getQueryData<Event[]>(queryKeys.events(uid));

      queryClient.setQueryData<Event[]>(queryKeys.events(uid), (old) => {
        if (!old) return old;
        return old.map((e) => (e.id !== id ? e : { ...e, archived: false }));
      });

      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) {
        queryClient.setQueryData(queryKeys.events(uid), ctx.snapshot);
      }
      toast({ title: "Failed to unarchive event", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.events(uid) });
    },
  });
}

// ── useRespondToDateChange ────────────────────────────────────────────────────

export function useRespondToDateChange() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const uid = user?.uid ?? "";

  return useMutation({
    mutationFn: async ({
      eventId,
      profileId,
      response,
      actingProfile,
    }: {
      eventId: string;
      profileId: string;
      response: "confirmed" | "declined";
      actingProfile?: string;
    }) => {
      // Fetch current meta to get pending date change
      const meta = await fetchEventMeta(eventId);
      const pending = meta.pendingDateChange;
      if (!pending) throw new Error("No pending date change");

      const confirmation = pending.confirmations[profileId];
      if (!confirmation) throw new Error("Profile not part of this date change");

      const u = getAuthClient().currentUser;
      const by = u?.displayName || u?.email || "Unknown";

      // Update the confirmation
      confirmation.status = response;
      confirmation.respondedAt = new Date().toISOString();
      confirmation.respondedBy = u?.uid || uid;
      confirmation.respondedByName = by;

      const allConfirmed = Object.values(pending.confirmations).every(
        (c) => c.status === "confirmed",
      );

      if (response === "declined") {
        // Save updated confirmations (keep pending visible so organizer sees decline)
        await upsertEventMeta(eventId, { pendingDateChange: pending });
        appendEventActivity(
          eventId,
          "date_change_declined",
          by,
          { declinedBy: confirmation.profileName },
          () => void queryClient.invalidateQueries({ queryKey: queryKeys.eventActivity(eventId) }),
          actingProfile,
        );
        return { applied: false, declined: true };
      }

      if (allConfirmed) {
        // Apply the date change to the event
        const data = queryClient.getQueryData<Event[]>(queryKeys.events(uid));
        const current = data?.find((e) => e.id === eventId);
        if (current) {
          const dateUpdates: Partial<Event> = {};
          if (pending.proposedValues.date) dateUpdates.date = pending.proposedValues.date;
          if (pending.proposedValues.startTime) dateUpdates.startTime = pending.proposedValues.startTime;
          if (pending.proposedValues.endTime) dateUpdates.endTime = pending.proposedValues.endTime;
          await upsertEvent({ ...current, ...dateUpdates });

          // Optimistic cache update
          queryClient.setQueryData<Event[]>(queryKeys.events(uid), (old) => {
            if (!old) return old;
            return old.map((e) =>
              e.id !== eventId ? e : { ...e, ...dateUpdates },
            );
          });
        }

        // Clear pending date change
        await clearPendingDateChange(eventId);

        const details: Record<string, string> = {};
        if (pending.proposedValues.date) details.date = `${pending.previousValues.date || ""} → ${pending.proposedValues.date}`;
        if (pending.proposedValues.startTime) details.startTime = `${pending.previousValues.startTime || ""} → ${pending.proposedValues.startTime}`;
        if (pending.proposedValues.endTime) details.endTime = `${pending.previousValues.endTime || ""} → ${pending.proposedValues.endTime}`;

        appendEventActivity(
          eventId,
          "date_change_confirmed",
          by,
          details,
          () => void queryClient.invalidateQueries({ queryKey: queryKeys.eventActivity(eventId) }),
          actingProfile,
        );

        return { applied: true, declined: false };
      }

      // Partially confirmed — save updated confirmations
      await upsertEventMeta(eventId, { pendingDateChange: pending });
      appendEventActivity(
        eventId,
        "date_change_confirmed",
        by,
        { confirmedBy: confirmation.profileName },
        () => void queryClient.invalidateQueries({ queryKey: queryKeys.eventActivity(eventId) }),
        actingProfile,
      );

      return { applied: false, declined: false };
    },
    onSuccess: (result, { eventId }) => {
      if (result?.applied) {
        savedToast("Date change confirmed and applied");
      } else if (result?.declined) {
        toast({
          title: createElement("span", { className: "flex items-center gap-2" },
            createElement(CheckCircle2, { className: "h-4 w-4 text-amber-500" }),
            "Date change declined",
          ),
          duration: 2000,
        });
      } else {
        savedToast("Date change confirmed");
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.eventEconomics(eventId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.events(uid) });
    },
    onError: () => {
      toast({ title: "Failed to respond to date change", variant: "destructive" });
    },
  });
}

// ── useCancelDateChange ──────────────────────────────────────────────────────

export function useCancelDateChange() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const uid = user?.uid ?? "";

  return useMutation({
    mutationFn: async ({ eventId, actingProfile }: { eventId: string; actingProfile?: string }) => {
      await clearPendingDateChange(eventId);
      const u = getAuthClient().currentUser;
      const by = u?.displayName || u?.email || "Unknown";
      appendEventActivity(
        eventId,
        "date_change_declined",
        by,
        { cancelledBy: "organizer" },
        () => void queryClient.invalidateQueries({ queryKey: queryKeys.eventActivity(eventId) }),
        actingProfile,
      );
    },
    onSuccess: (_data, { eventId }) => {
      savedToast("Date change cancelled");
      void queryClient.invalidateQueries({ queryKey: queryKeys.eventEconomics(eventId) });
    },
    onError: () => {
      toast({ title: "Failed to cancel date change", variant: "destructive" });
    },
  });
}

// ── initEventData helper ──────────────────────────────────────────────────────
// Initialises data for a new event: writes to Firestore and updates the TQ cache.
// local useState.

async function initEventData(
  event: Event,
  deal: DealStructure,
  queryClient: ReturnType<typeof useQueryClient>,
  uid: string,
) {
  const rev = emptyRevenue(event.id);
  const settlement: Settlement = buildSettlementUpdate(deal, rev, undefined);
  const token = `review-${event.id}`;
  const shareToken: ShareToken = {
    token,
    eventId: event.id,
    createdAt: new Date().toISOString().slice(0, 10),
    parties: ["Performer", "Agent", "Venue"],
  };

  // Optimistic: prepend event to events cache, add token to shareTokens cache
  queryClient.setQueryData<Event[]>(queryKeys.events(uid), (old) => {
    if (!old) return old;
    return [event, ...old];
  });
  queryClient.setQueryData<Record<string, ShareToken>>(queryKeys.shareTokens(uid), (old) => {
    return { ...(old ?? {}), [token]: shareToken };
  });

  // Set economics cache so pages that open immediately don't refetch
  queryClient.setQueryData<EventEconomicsData>(queryKeys.eventEconomics(event.id), {
    deal,
    revenue: rev,
    settlement,
    meta: {},
  });

  // Persist to Firestore sequentially to avoid race conditions
  await upsertEvent(event);
  await upsertDeal(event.id, deal);
  await upsertRevenue(event.id, rev);
  await upsertSettlement(event.id, settlement);
  await upsertShareToken(token, event.id, ["Performer", "Agent", "Venue"], {
    event,
    deal,
    revenue: rev,
    settlement,
  });
}

// ── useAddEvent ────────────────────────────────────────────────────────────────

export function useAddEvent() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const uid = user?.uid ?? "";

  return useMutation({
    mutationFn: async ({ event, deal }: { event: Event; deal: DealStructure }): Promise<void> => {
      await initEventData(event, deal, queryClient, uid);
    },
    onError: () => {
      toast({ title: "Failed to save event", variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: queryKeys.events(uid) });
    },
  });
}

// ── useAddMultiPerformerEvent ──────────────────────────────────────────────────

export function useAddMultiPerformerEvent() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const uid = user?.uid ?? "";

  return useMutation({
    mutationFn: async ({
      parent,
      children,
    }: {
      parent: Event;
      children: { event: Event; deal: DealStructure }[];
    }): Promise<void> => {
      const parentWithChildren: Event = {
        ...parent,
        isMultiPerformer: true,
        childEventIds: children.map((c) => c.event.id),
      };

      // Optimistic: prepend parent to events cache
      queryClient.setQueryData<Event[]>(queryKeys.events(uid), (old) => {
        if (!old) return old;
        return [parentWithChildren, ...old];
      });

      await upsertEvent(parentWithChildren);

      for (const child of children) {
        await initEventData(
          { ...child.event, parentEventId: parent.id },
          child.deal,
          queryClient,
          uid,
        );
      }
    },
    onError: () => {
      toast({ title: "Failed to save event", variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: queryKeys.events(uid) });
    },
  });
}

// ── useAddChildEvent ───────────────────────────────────────────────────────────

export function useAddChildEvent() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const uid = user?.uid ?? "";

  return useMutation({
    mutationFn: async ({
      parentId,
      event,
      deal,
    }: {
      parentId: string;
      event: Event;
      deal: DealStructure;
    }): Promise<void> => {
      // Init child event data (also updates cache + persists)
      await initEventData({ ...event, parentEventId: parentId }, deal, queryClient, uid);

      // Update parent's childEventIds in cache + Firestore
      let parentEvent: Event | undefined;
      queryClient.setQueryData<Event[]>(queryKeys.events(uid), (old) => {
        if (!old) return old;
        return old.map((e) => {
          if (e.id !== parentId) return e;
          parentEvent = { ...e, childEventIds: [...(e.childEventIds || []), event.id] };
          return parentEvent!;
        });
      });
      if (parentEvent) {
        await upsertEvent(parentEvent);
        // Derive parent status from children
        const allEvents = queryClient.getQueryData<Event[]>(queryKeys.events(uid)) ?? [];
        const children = allEvents.filter(
          (e) => parentEvent.childEventIds?.includes(e.id) && !e.archived,
        );
        const derivedStatus = deriveParentStatus(children);
        if (derivedStatus && derivedStatus !== parentEvent.eventStatus) {
          queryClient.setQueryData<Event[]>(queryKeys.events(uid), (old) => {
            if (!old) return old;
            return old.map((e) =>
              e.id !== parentId ? e : { ...e, eventStatus: derivedStatus },
            );
          });
          await upsertEvent({ ...parentEvent, eventStatus: derivedStatus });
        }
      }
    },
    onError: () => {
      toast({ title: "Failed to save event", variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: queryKeys.events(uid) });
    },
  });
}

// ── useRemoveChildEvent ────────────────────────────────────────────────────────

export function useRemoveChildEvent() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const uid = user?.uid ?? "";

  return useMutation({
    mutationFn: async ({ parentId, childId }: { parentId: string; childId: string }): Promise<void> => {
      const data = queryClient.getQueryData<Event[]>(queryKeys.events(uid));
      const childEvent = data?.find((e) => e.id === childId);
      const parentEvent = data?.find((e) => e.id === parentId);

      // Optimistic update
      queryClient.setQueryData<Event[]>(queryKeys.events(uid), (old) => {
        if (!old) return old;
        return old.map((e) => {
          if (e.id === childId) return { ...e, archived: true };
          if (e.id === parentId)
            return { ...e, childEventIds: (e.childEventIds || []).filter((id) => id !== childId) };
          return e;
        });
      });

      if (childEvent) {
        await upsertEvent({ ...childEvent, archived: true });
        // Invalidate child economics so stale data doesn't linger
        queryClient.invalidateQueries({ queryKey: queryKeys.eventEconomics(childId) });
      }
      if (parentEvent) {
        await upsertEvent({
          ...parentEvent,
          childEventIds: (parentEvent.childEventIds || []).filter((id) => id !== childId),
        });
      }

      // Derive parent status after removing child
      const allEventsAfter = queryClient.getQueryData<Event[]>(queryKeys.events(uid)) ?? [];
      const updatedParent = allEventsAfter.find((e) => e.id === parentId);
      if (updatedParent?.isMultiPerformer) {
        const remainingChildren = allEventsAfter.filter(
          (e) => updatedParent.childEventIds?.includes(e.id) && !e.archived,
        );
        const derivedStatus = deriveParentStatus(remainingChildren);
        if (derivedStatus && derivedStatus !== updatedParent.eventStatus) {
          queryClient.setQueryData<Event[]>(queryKeys.events(uid), (old) => {
            if (!old) return old;
            return old.map((e) =>
              e.id !== parentId ? e : { ...e, eventStatus: derivedStatus },
            );
          });
          await upsertEvent({ ...updatedParent, eventStatus: derivedStatus });
        }
      }
    },
    onError: () => {
      toast({ title: "Failed to update event", variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: queryKeys.events(uid) });
    },
  });
}

// ── useConvertToMultiPerformer ─────────────────────────────────────────────────

export function useConvertToMultiPerformer() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const uid = user?.uid ?? "";

  return useMutation({
    mutationFn: async ({ eventId }: { eventId: string }): Promise<string> => {
      const data = queryClient.getQueryData<Event[]>(queryKeys.events(uid));
      const parent = data?.find((e) => e.id === eventId);
      if (!parent || parent.isMultiPerformer) return eventId;

      const economics = queryClient.getQueryData<EventEconomicsData>(
        queryKeys.eventEconomics(eventId),
      );
      const existingDeal = economics?.deal;

      const childId = `EVT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const childEvent: Event = {
        id: childId,
        name: `${parent.name} — ${parent.artist}`,
        date: parent.date,
        venue: parent.venue,
        artist: parent.artist,
        operator: parent.operator,
        operatorType: parent.operatorType,
        capacity: parent.capacity,
        ticketingProvider: parent.ticketingProvider,
        eventStatus: parent.eventStatus,
        status: "open" as SettlementStatus,
        parentEventId: eventId,
        childEventIds: [],
        isMultiPerformer: false,
        archived: false,
        published: false,
        hostProfileId: parent.hostProfileId,
        accessProfileIds: parent.accessProfileIds,
        accessUids: parent.accessUids,
        ...(parent.roomStage ? { roomStage: parent.roomStage } : {}),
        ...(parent.holdRank != null ? { holdRank: parent.holdRank } : {}),
        ...(parent.performerProfileId ? { performerProfileId: parent.performerProfileId } : {}),
      };
      const childDeal: DealStructure = existingDeal
        ? { ...existingDeal, eventId: childId }
        : {
            eventId: childId,
            dealType: "guarantee",
            artistGuarantee: 0,
            artistSplit: 70,
            promoterSplit: 20,
            venueSplit: 10,
            organizerSplit: 0,
            artistCostSplit: 0,
            promoterCostSplit: 0,
            venueCostSplit: 0,
            organizerCostSplit: 0,
            venueRental: 0,
            commissions: [],
          };

      // Optimistic: mark parent as multi-performer with suggested status
      queryClient.setQueryData<Event[]>(queryKeys.events(uid), (old) => {
        if (!old) return old;
        return old.map((e) =>
          e.id !== eventId ? e : { ...e, isMultiPerformer: true, childEventIds: [childId], eventStatus: "suggested" as const },
        );
      });

      await initEventData(childEvent, childDeal, queryClient, uid);
      await upsertEvent({ ...parent, isMultiPerformer: true, childEventIds: [childId], eventStatus: "suggested" });

      // Add the existing performer as a collaborator on both child and parent
      if (parent.artist) {
        const childCollaborator: EventCollaborator = {
          id: `collab-${childId}-performer`,
          email: "",
          name: parent.artist,
          eventRole: "performer",
          status: "active",
          invitedAt: new Date().toISOString(),
          profileId: parent.performerProfileId || undefined,
        };
        await addEventCollaborator(childId, childCollaborator);

        // For parent, use a stable ID to avoid duplicates on repeated conversions
        const parentCollaborator: EventCollaborator = {
          ...childCollaborator,
          id: `collab-${eventId}-performer`,
        };
        await addEventCollaborator(eventId, parentCollaborator);
      }

      // Log initial activity on the child so performers see it in their changelog
      await appendEventActivity(childId, "status_changed", "System", {
        from: "—",
        to: eventStatusLabels[parent.eventStatus] ?? parent.eventStatus,
      });

      // Move existing messages from parent to the first child event
      await moveMessages(eventId, childId);

      return childId;
    },
    onError: () => {
      toast({ title: "Failed to convert event", variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: queryKeys.events(uid) });
    },
  });
}

/**
 * Hold-rank management.
 * Reads events from the events cache, computes new holdRanks and
 * persists each changed event via upsertEvent.
 *
 * Returns plain functions (not .mutate() wrappers) to match the call-site API.
 */
export function useHoldRankMutations() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const uid = user?.uid ?? "";

  /**
   * When an event leaves a hold (status change / cancel), shift every remaining
   * hold on the same date/venue/room that was ranked above the removed rank
   * down by one, so ranks stay contiguous.
   */
  const promoteHoldsOnDate = (
    date: string,
    venue: string,
    roomStage: string,
    removedRank: number,
  ): void => {
    const events = queryClient.getQueryData<Event[]>(queryKeys.events(uid));
    if (!events) return;

    const holdsOnDate = events.filter(
      (e) =>
        e.date === date &&
        e.venue === venue &&
        (e.roomStage || "") === roomStage &&
        e.eventStatus === "on_hold" &&
        !e.archived,
    );

    const localRanks: Record<string, number> = {};
    holdsOnDate.forEach((e) => { localRanks[e.id] = e.holdRank || 1; });

    holdsOnDate.forEach((e) => {
      const rank = localRanks[e.id];
      if (rank > removedRank) localRanks[e.id] = rank - 1;
    });

    // Uniqueness pass
    let changed = true;
    let iterations = 0;
    while (changed && iterations < 50) {
      changed = false;
      iterations++;
      const ids = Object.keys(localRanks);
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          if (localRanks[ids[i]] === localRanks[ids[j]]) {
            localRanks[ids[j]] += 1;
            changed = true;
          }
        }
      }
    }

    // Optimistic cache update
    queryClient.setQueryData<Event[]>(queryKeys.events(uid), (old) => {
      if (!old) return old;
      return old.map((e) => {
        if (!Object.prototype.hasOwnProperty.call(localRanks, e.id)) return e;
        return { ...e, holdRank: localRanks[e.id] };
      });
    });

    // Persist changed events
    holdsOnDate.forEach((e) => {
      const newRank = localRanks[e.id];
      if (newRank !== (e.holdRank || 1)) {
        void upsertEvent({ ...e, holdRank: newRank });
      }
    });
  };

  /**
   * When an event is placed at a rank, shift other holds on the same
   * date/venue/room to resolve conflicts and maintain a unique ordering.
   */
  const resolveHoldRankConflicts = (
    targetEventId: string,
    date: string,
    venue: string,
    roomStage: string,
    newRank: number,
  ): void => {
    const events = queryClient.getQueryData<Event[]>(queryKeys.events(uid));
    if (!events) return;

    const holdsOnDate = events.filter(
      (e) =>
        e.date === date &&
        e.venue === venue &&
        (e.roomStage || "") === roomStage &&
        e.eventStatus === "on_hold" &&
        !e.archived,
    );

    const holdIds = new Set(holdsOnDate.map((e) => e.id));
    holdIds.add(targetEventId);

    const localRanks: Record<string, number> = {};
    holdIds.forEach((eid) => {
      const ev = events.find((e) => e.id === eid);
      localRanks[eid] = ev?.holdRank || 1;
    });

    const oldRank = localRanks[targetEventId] ?? newRank;
    localRanks[targetEventId] = newRank;

    const otherIds = Object.keys(localRanks).filter((id) => id !== targetEventId);
    if (oldRank !== newRank) {
      if (oldRank < newRank) {
        otherIds.forEach((id) => {
          const r = localRanks[id];
          if (r > oldRank && r <= newRank) localRanks[id] = r - 1;
        });
      } else {
        otherIds.forEach((id) => {
          const r = localRanks[id];
          if (r >= newRank && r < oldRank) localRanks[id] = r + 1;
        });
      }
    } else {
      otherIds.sort((a, b) => localRanks[a] - localRanks[b]);
      let bump = newRank;
      otherIds.forEach((id) => {
        if (localRanks[id] === bump) { localRanks[id] = localRanks[id] + 1; bump = localRanks[id]; }
      });
    }

    // Uniqueness safety pass
    let changed = true;
    let iterations = 0;
    while (changed && iterations < 50) {
      changed = false;
      iterations++;
      const ids = Object.keys(localRanks);
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          if (localRanks[ids[i]] === localRanks[ids[j]]) {
            const bumpId = ids[j] === targetEventId ? ids[i] : ids[j];
            localRanks[bumpId] += 1;
            changed = true;
          }
        }
      }
    }

    // Optimistic cache update
    queryClient.setQueryData<Event[]>(queryKeys.events(uid), (old) => {
      if (!old) return old;
      return old.map((e) => {
        if (!Object.prototype.hasOwnProperty.call(localRanks, e.id)) return e;
        return { ...e, holdRank: localRanks[e.id] };
      });
    });

    // Persist changed events
    holdIds.forEach((eid) => {
      const ev = events.find((e) => e.id === eid);
      if (ev) {
        const newHoldRank = localRanks[eid];
        if (newHoldRank !== (ev.holdRank || 1) || eid === targetEventId) {
          void upsertEvent({ ...ev, holdRank: newHoldRank });
        }
      }
    });
  };

  return { promoteHoldsOnDate, resolveHoldRankConflicts };
}
