/**
 * Event-level mutation hooks.
 *
 * Fully implemented: useUpdateEvent, useArchiveEvent, useUnarchiveEvent,
 * useAddEvent, useAddMultiPerformerEvent, useAddChildEvent,
 * useRemoveChildEvent, useConvertToMultiPerformer, useDuplicateEvent,
 * useDeleteEvent.
 */

import { createElement } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { deleteDoc, doc } from "firebase/firestore";
import { getFirestoreDb } from "@/integrations/firebase/app";

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
  fetchProfiles,
  fetchRiders,
  upsertRider,
} from "@/lib/db";
import type { PendingDateChange, DateChangeConfirmation } from "@/lib/db";
import type { Event, EventCollaborator, DealStructure, Settlement, SettlementStatus, Rider, RiderType } from "@/lib/models";
import { eventStatusLabels, collaboratorIsActive } from "@/lib/models";
import type { ProfileDocument } from "@/lib/user-context";
import { isPrimaryEventOwner } from "@/lib/eventPermissions";
import type { SharedProfile } from "@/lib/user-context";
import { buildSettlementUpdate, emptyRevenue } from "@/lib/settlementUtils";
import { newShareToken } from "@/lib/shareToken";
import { toast } from "@/hooks/use-toast";
import { queryKeys } from "./keys";

/**
 * Get cached events data using prefix-matching on the events query key.
 * The events query key now includes a profileKey suffix for draft filtering,
 * so exact-match getQueryData won't work — we need getQueriesData.
 */
function getEventsData(queryClient: ReturnType<typeof useQueryClient>, uid: string): Event[] | undefined {
  const entries = queryClient.getQueriesData<Event[]>({ queryKey: queryKeys.events(uid) });
  // Return the first (and usually only) matching entry's data
  return entries[0]?.[1] ?? undefined;
}

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
 * - Single-performer event: event.performerProfileId or the active performer collaborator.
 * - Multi-performer parent: every child event's performer (each child's
 *   performerProfileId or off-platform artist).
 * - Venue: collaborators with eventRole "venue" (only if organizer is NOT the venue).
 *
 * Parties whose profile is controlled by the current user (proposer) are excluded —
 * you don't need to confirm your own change.
 */
export function getDateChangeParties(
  event: Event,
  collaborators: EventCollaborator[],
  currentUserProfileIds?: string[],
  childEvents?: Event[],
): DateChangeParty[] {
  const parties: DateChangeParty[] = [];
  const myIds = new Set(currentUserProfileIds ?? []);
  const seenProfileIds = new Set<string>();

  // Performer parties — multi-performer parent: one per active child
  if (event.isMultiPerformer && childEvents && childEvents.length > 0) {
    for (const child of childEvents) {
      if (child.archived || child.eventStatus === "cancelled") continue;
      const childPid = child.performerProfileId;
      if (childPid) {
        if (myIds.has(childPid) || seenProfileIds.has(childPid)) continue;
        seenProfileIds.add(childPid);
        parties.push({
          profileId: childPid,
          role: "performer",
          profileName: child.artist || "Performer",
          onPlatform: true,
        });
      } else if (child.artist) {
        const syntheticId = `ext-performer-${child.id}`;
        if (seenProfileIds.has(syntheticId)) continue;
        seenProfileIds.add(syntheticId);
        parties.push({
          profileId: syntheticId,
          role: "performer",
          profileName: child.artist,
          onPlatform: false,
        });
      }
    }
  } else {
    // Single performer
    const performerCollab = collaborators.find(
      (c) => c.eventRole === "performer" && collaboratorIsActive(c.status),
    );
    const performerProfileId = event.performerProfileId || performerCollab?.profileId;
    if (performerProfileId) {
      if (!myIds.has(performerProfileId)) {
        parties.push({
          profileId: performerProfileId,
          role: "performer",
          profileName: performerCollab?.name || event.artist || "Performer",
          onPlatform: true,
        });
      }
    } else if (event.artist) {
      parties.push({
        profileId: `ext-performer-${event.id}`,
        role: "performer",
        profileName: event.artist,
        onPlatform: false,
      });
    }
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
  /** Child events for a multi-performer parent — drives per-performer confirmation. */
  childEvents?: Event[];
}

export function useUpdateEvent() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const uid = user?.uid ?? "";

  return useMutation({
    mutationFn: async ({ id, updates, collaborators, userProfileIds, childEvents }: UpdateEventVars) => {
      const data = getEventsData(queryClient, uid);
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
        const parties = getDateChangeParties(current, collaborators, userProfileIds, childEvents);
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

          // Mirror to active children so each child's performer sees the banner
          // when viewing their child event. The parent remains the source of
          // truth — child responses are relayed back via cloud function.
          if (current.isMultiPerformer && childEvents) {
            for (const child of childEvents) {
              if (child.archived || child.eventStatus === "cancelled") continue;
              await upsertEventMeta(child.id, { pendingDateChange });
            }
          }

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
        const allEvents = getEventsData(queryClient, uid) ?? [];
        const children = allEvents.filter(
          (e) => current.childEventIds!.includes(e.id) && !e.archived && e.eventStatus !== "cancelled",
        );
        for (const child of children) {
          await upsertEvent({ ...child, eventStatus: "cancelled" });
        }
        queryClient.setQueriesData<Event[]>({ queryKey: queryKeys.events(uid) }, (old) => {
          if (!old) return old;
          const childIds = new Set(current.childEventIds);
          return old.map((e) =>
            childIds.has(e.id) ? { ...e, eventStatus: "cancelled" as const } : e,
          );
        });
      }

      return { dateChangeProposed: false };
    },
    onMutate: async ({ id, updates, collaborators, userProfileIds, childEvents }: UpdateEventVars) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.events(uid) });
      const snapshot = getEventsData(queryClient, uid);

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
          const parties = getDateChangeParties(current, collaborators, userProfileIds, childEvents);
          if (parties.length > 0) {
            optimisticUpdates = { ...updates };
            for (const field of DATE_CHANGE_FIELDS) {
              delete (optimisticUpdates as Record<string, unknown>)[field];
            }
          }
        }
      }

      queryClient.setQueriesData<Event[]>({ queryKey: queryKeys.events(uid) }, (old) => {
        if (!old) return old;
        return old.map((e) => (e.id !== id ? e : { ...e, ...optimisticUpdates }));
      });
      // The calendar uses a separate date-range query that's not a prefix of
      // queryKeys.events — patch it explicitly so calendar UI reflects the
      // change without waiting for invalidation.
      queryClient.setQueriesData<Event[]>({ queryKey: ["calendarEvents", uid] }, (old) => {
        if (!old) return old;
        return old.map((e) => (e.id !== id ? e : { ...e, ...optimisticUpdates }));
      });

      return { snapshot };
    },
    onSuccess: (result, { id, updates, actingProfile, collaborators, childEvents }, context) => {
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
          const updatedPending = result.pendingDateChange;
          void upsertEventMeta(id, { pendingDateChange: updatedPending });
          // Re-mirror to active children
          if (oldEvent.isMultiPerformer && childEvents) {
            for (const child of childEvents) {
              if (child.archived || child.eventStatus === "cancelled") continue;
              void upsertEventMeta(child.id, { pendingDateChange: updatedPending });
            }
          }
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

        // Wave 7 C3 — Now that the performer has accepted, migrate their
        // profile riders + catering/accommodation notes onto the event. The
        // copy was deferred from event creation until this moment so the
        // performer doesn't see their docs uploaded behind their back.
        const performerProfileIdToMigrate = oldEvent.performerProfileId;
        if (performerProfileIdToMigrate) {
          void migrateCollaboratorRidersOnAccept({ eventId: id, profileId: performerProfileIdToMigrate })
            .catch(() => { /* non-critical */ });
        }
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
        const allEvents = getEventsData(queryClient, uid) ?? [];
        const parent = allEvents.find((e) => e.id === oldEvent.parentEventId);
        if (parent?.isMultiPerformer) {
          const children = allEvents.filter(
            (e) => parent.childEventIds?.includes(e.id) && !e.archived,
          );
          const derivedStatus = deriveParentStatus(children);
          if (derivedStatus && derivedStatus !== parent.eventStatus) {
            queryClient.setQueriesData<Event[]>({ queryKey: queryKeys.events(uid) }, (old) => {
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
        queryClient.setQueriesData({ queryKey: queryKeys.events(uid) }, () => ctx.snapshot);
      }
      toast({ title: "Failed to save event", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.events(uid) });
      // Calendar uses a different prefix; invalidate explicitly so it picks
      // up server truth (or recovers from drift after a failed optimistic
      // update).
      queryClient.invalidateQueries({ queryKey: ["calendarEvents", uid] });
    },
  });
}

// ── Collaborator rider migration (Wave 7 C3) ─────────────────────────────────

const PROFILE_DOC_TYPE_TO_RIDER_TYPE: Record<ProfileDocument["type"], RiderType> = {
  tech_rider: "technical",
  hospitality_rider: "hospitality",
  other: "custom",
};

/**
 * Build Rider entries from an accepting collaborator's profile.
 *
 * Pure so it can be unit-tested. Maps profile-level documents 1:1 to event
 * Riders, plus inlines `cateringNotes` and `accommodationNotes` as
 * description-only Riders. The profile id is stored on each Rider via
 * `ownerProfileId` so the collaborator retains write access through Firestore
 * rules.
 *
 * `eventRole` only affects the description prefix (so the existing-rider
 * dedupe heuristic below can spot duplicate "From <name> profile" entries).
 */
export function buildRidersFromProfileForEvent(
  profile: { id?: string; name?: string; documents?: ProfileDocument[]; cateringNotes?: string; accommodationNotes?: string; },
): Rider[] {
  const out: Rider[] = [];
  const profileName = profile.name || "Profile";
  const ownerProfileId = profile.id;
  for (const doc of profile.documents ?? []) {
    out.push({
      id: `R-collab-${ownerProfileId || "x"}-${doc.id}`,
      name: doc.name,
      type: PROFILE_DOC_TYPE_TO_RIDER_TYPE[doc.type] || "custom",
      description: `From ${profileName} profile`,
      fileUrl: doc.url,
      fileName: doc.name,
      ...(ownerProfileId ? { ownerProfileId } : {}),
    });
  }
  if (profile.cateringNotes && profile.cateringNotes.trim()) {
    out.push({
      id: `R-collab-${ownerProfileId || "x"}-catering`,
      name: "Catering Requirements",
      type: "catering",
      description: profile.cateringNotes,
      ...(ownerProfileId ? { ownerProfileId } : {}),
    });
  }
  if (profile.accommodationNotes && profile.accommodationNotes.trim()) {
    out.push({
      id: `R-collab-${ownerProfileId || "x"}-accommodation`,
      name: "Accommodation Requirements",
      type: "hospitality",
      description: profile.accommodationNotes,
      ...(ownerProfileId ? { ownerProfileId } : {}),
    });
  }
  return out;
}

/**
 * Migrate an accepting collaborator's riders + documents onto an event.
 *
 * Wave 7 C3 split the rider-copy from event creation: collaborator riders no
 * longer migrate eagerly when an event is created (see `useCreateEventSubmit`).
 * Instead they're copied here, the moment a performer or venue collaborator
 * confirms their invitation. The accepting user is the one performing this
 * call, so `fetchProfiles()` will return their owned/membered profiles —
 * exactly the data we need to read from.
 *
 * Idempotent — if a rider with the same id already exists on the event, the
 * upsert merges (no duplicates). If the profile is unreadable in this
 * session (e.g. acted on someone else's behalf), the migration silently
 * no-ops; the caller still gets a resolved promise.
 *
 * Pure function (not a hook) so it can be invoked from inside other
 * mutations' `onSuccess` callbacks (e.g. `useUpdateEvent` on
 * `performerResponse === "accepted"`).
 */
export async function migrateCollaboratorRidersOnAccept(
  args: { eventId: string; profileId: string },
): Promise<{ copied: number }> {
  const { eventId, profileId } = args;
  if (!eventId || !profileId) return { copied: 0 };
  let profile: { id?: string; name?: string; documents?: ProfileDocument[]; cateringNotes?: string; accommodationNotes?: string; } | undefined;
  try {
    const { all } = await fetchProfiles();
    profile = all.find((p) => p.id === profileId);
  } catch {
    // Permission denied or no auth — skip migration silently.
    return { copied: 0 };
  }
  if (!profile) return { copied: 0 };

  const riders = buildRidersFromProfileForEvent(profile);
  if (riders.length === 0) return { copied: 0 };

  // Skip riders whose id already exists on the event (idempotent).
  let existingIds = new Set<string>();
  try {
    const existing = await fetchRiders(eventId);
    existingIds = new Set(existing.map((r) => r.id));
  } catch {
    /* read may fail under restrictive rules; fall through and let upsert merge */
  }

  let copied = 0;
  for (const rider of riders) {
    if (existingIds.has(rider.id)) continue;
    try {
      await upsertRider(eventId, rider);
      copied += 1;
    } catch {
      // non-critical — one bad rider doesn't fail the rest
    }
  }
  return { copied };
}

/** Thin React Query wrapper around `migrateCollaboratorRidersOnAccept`. */
export function useMigrateCollaboratorRidersOnAccept() {
  return useMutation({
    mutationFn: migrateCollaboratorRidersOnAccept,
  });
}

/**
 * Wave 7 C3 — venue-accept counterpart to `performerResponse === "accepted"`.
 *
 * The performer-accept flow flips `event.performerResponse` (handled inside
 * `useUpdateEvent`). The venue-accept flow flips an `EventCollaborator`
 * subdoc from pending → active. This mutation is the single wiring point
 * for that flip: it persists the status update via `addEventCollaborator`
 * and then migrates the accepting profile's riders/documents onto the
 * event using the same helper as the performer path.
 *
 * The previous status MUST be a non-active state (pending, invited,
 * declined, revoked, accepted-but-not-yet-active). When the supplied
 * collaborator already has an active status, this is a no-op for the
 * status write but still runs the rider migration (idempotent — see
 * `migrateCollaboratorRidersOnAccept`).
 */
export function useAcceptEventCollaborator() {
  return useMutation({
    mutationFn: async (
      args: { eventId: string; collaborator: EventCollaborator },
    ): Promise<{ migrated: number }> => {
      const { eventId, collaborator } = args;
      // Flip status to active (merge — preserves all other fields).
      await addEventCollaborator(eventId, { ...collaborator, status: "active" });
      // Migrate the accepting profile's riders/documents onto the event.
      if (collaborator.profileId) {
        const result = await migrateCollaboratorRidersOnAccept({ eventId, profileId: collaborator.profileId });
        return { migrated: result.copied };
      }
      return { migrated: 0 };
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
      const data = getEventsData(queryClient, uid);
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
      const snapshot = getEventsData(queryClient, uid);

      queryClient.setQueriesData<Event[]>({ queryKey: queryKeys.events(uid) }, (old) => {
        if (!old) return old;
        return old.map((e) => (e.id !== id ? e : { ...e, archived: true }));
      });

      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) {
        queryClient.setQueriesData({ queryKey: queryKeys.events(uid) }, () => ctx.snapshot);
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
      const data = getEventsData(queryClient, uid);
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
      const snapshot = getEventsData(queryClient, uid);

      queryClient.setQueriesData<Event[]>({ queryKey: queryKeys.events(uid) }, (old) => {
        if (!old) return old;
        return old.map((e) => (e.id !== id ? e : { ...e, archived: false }));
      });

      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) {
        queryClient.setQueriesData({ queryKey: queryKeys.events(uid) }, () => ctx.snapshot);
      }
      toast({ title: "Failed to unarchive event", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.events(uid) });
    },
  });
}

// ── useDeleteEvent ─────────────────────────────────────────────────────────────

/**
 * Hard-delete an event document from Firestore. Used for drafts where the user
 * wants to discard rather than archive. Subcollections (deal/revenue/settlement/
 * riders/etc) are left in place — they're orphaned but inaccessible without the
 * parent doc, and Firestore reads against them require a parent reference.
 *
 * Authorization: only the primary owner (uid in primary_owner_uid or first
 * accessUid) can delete. Server-side rules also enforce this.
 */
export function useDeleteEvent() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const uid = user?.uid ?? "";

  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const data = getEventsData(queryClient, uid);
      const e = data?.find((x) => x.id === id);
      if (!uid || !e || !isPrimaryEventOwner(e, uid)) return;
      await deleteDoc(doc(getFirestoreDb(), "events", id));
      savedToast("Event deleted");
    },
    onMutate: async ({ id }: { id: string }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.events(uid) });
      const snapshot = getEventsData(queryClient, uid);

      // Optimistic: remove the event from cache
      queryClient.setQueriesData<Event[]>({ queryKey: queryKeys.events(uid) }, (old) => {
        if (!old) return old;
        return old.filter((e) => e.id !== id);
      });

      return { snapshot };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) {
        queryClient.setQueriesData({ queryKey: queryKeys.events(uid) }, () => ctx.snapshot);
      }
      toast({ title: "Failed to delete event", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.events(uid) });
    },
  });
}

// ── useDuplicateEvent ──────────────────────────────────────────────────────────

/**
 * Create a duplicate of an existing event as a draft. Copies all top-level
 * event fields except identifiers, parent/child references, status, and
 * archive/published flags. Subcollections (riders, agreements, crew, schedule,
 * messages, settlement) are NOT copied — only the top-level event document.
 */
export function useDuplicateEvent() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const uid = user?.uid ?? "";

  return useMutation({
    mutationFn: async ({ eventId }: { eventId: string }): Promise<string | null> => {
      const data = getEventsData(queryClient, uid);
      const source = data?.find((e) => e.id === eventId);
      if (!source) return null;

      // New ID for the duplicate.
      const newId = `EVT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      // Build the duplicate by spreading source and overriding identity / state
      // fields. Strip parent/child links so the duplicate stands alone.
      const {
        id: _id,
        parentEventId: _p,
        childEventIds: _c,
        sourceRequestId: _src,
        sourceRequestDate: _srcDate,
        accessUids: _accessUids,
        accessProfileIds: _accessProfileIds,
        ...rest
      } = source;
      void _id; void _p; void _c; void _src; void _srcDate; void _accessUids; void _accessProfileIds;

      const duplicate: Event = {
        ...rest,
        id: newId,
        name: `${source.name} (Copy)`,
        eventStatus: "draft",
        status: "draft",
        archived: false,
        published: false,
        isMultiPerformer: false,
        // accessUids/accessProfileIds are seeded by upsertEvent based on the
        // current uid + hostProfileId, so we omit them and let it rebuild.
      };

      await upsertEvent(duplicate);

      // Optimistic cache update — prepend the duplicate so it appears at the top.
      queryClient.setQueriesData<Event[]>({ queryKey: queryKeys.events(uid) }, (old) => {
        if (!old) return old;
        return [duplicate, ...old];
      });

      return newId;
    },
    onSuccess: (newId) => {
      if (newId) savedToast("Event duplicated");
    },
    onError: () => {
      toast({ title: "Failed to duplicate event", variant: "destructive" });
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

      const data = getEventsData(queryClient, uid);
      const current = data?.find((e) => e.id === eventId);
      const isChild = !!current?.parentEventId;
      const activeChildren =
        current?.isMultiPerformer && current.childEventIds?.length && data
          ? data.filter(
              (e) =>
                current.childEventIds!.includes(e.id) &&
                !e.archived &&
                e.eventStatus !== "cancelled",
            )
          : [];

      // Performer responding on a child event — write to child's meta only.
      // The cloud function (onEventMetaUpdated) relays the response to the
      // parent's meta and triggers all-confirmed application.
      if (isChild) {
        await upsertEventMeta(eventId, { pendingDateChange: pending });
        appendEventActivity(
          eventId,
          response === "declined" ? "date_change_declined" : "date_change_confirmed",
          by,
          response === "declined"
            ? { declinedBy: confirmation.profileName }
            : { confirmedBy: confirmation.profileName },
          () => void queryClient.invalidateQueries({ queryKey: queryKeys.eventActivity(eventId) }),
          actingProfile,
        );
        return { applied: false, declined: response === "declined" };
      }

      const allConfirmed = Object.values(pending.confirmations).every(
        (c) => c.status === "confirmed",
      );

      if (response === "declined") {
        // Save updated confirmations (keep pending visible so organizer sees decline)
        await upsertEventMeta(eventId, { pendingDateChange: pending });
        // Mirror to active children
        for (const child of activeChildren) {
          await upsertEventMeta(child.id, { pendingDateChange: pending });
        }
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
        if (current) {
          const dateUpdates: Partial<Event> = {};
          if (pending.proposedValues.date) dateUpdates.date = pending.proposedValues.date;
          if (pending.proposedValues.startTime) dateUpdates.startTime = pending.proposedValues.startTime;
          if (pending.proposedValues.endTime) dateUpdates.endTime = pending.proposedValues.endTime;
          await upsertEvent({ ...current, ...dateUpdates });

          // Cascade to children of a multi-performer parent so their dates stay in sync.
          const cascadeIds: string[] = [];
          for (const child of activeChildren) {
            await upsertEvent({ ...child, ...dateUpdates });
            cascadeIds.push(child.id);
          }

          // Optimistic cache update for the event + any cascaded children
          const updatedIds = new Set<string>([eventId, ...cascadeIds]);
          queryClient.setQueriesData<Event[]>({ queryKey: queryKeys.events(uid) }, (old) => {
            if (!old) return old;
            return old.map((e) =>
              updatedIds.has(e.id) ? { ...e, ...dateUpdates } : e,
            );
          });

          // Invalidate child economics so any open child views refresh.
          for (const cid of cascadeIds) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.eventEconomics(cid) });
          }
        }

        // Clear pending date change from parent + all active children
        await clearPendingDateChange(eventId);
        for (const child of activeChildren) {
          await clearPendingDateChange(child.id);
        }

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

      // Partially confirmed — save updated confirmations + mirror to children
      await upsertEventMeta(eventId, { pendingDateChange: pending });
      for (const child of activeChildren) {
        await upsertEventMeta(child.id, { pendingDateChange: pending });
      }
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

      // Also clear from children of a multi-performer parent
      const data = getEventsData(queryClient, uid);
      const current = data?.find((e) => e.id === eventId);
      if (current?.isMultiPerformer && current.childEventIds?.length && data) {
        const childIdSet = new Set(current.childEventIds);
        const activeChildren = data.filter(
          (e) => childIdSet.has(e.id) && !e.archived && e.eventStatus !== "cancelled",
        );
        for (const child of activeChildren) {
          await clearPendingDateChange(child.id);
        }
      }

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
  const token = newShareToken();
  const shareToken: ShareToken = {
    token,
    eventId: event.id,
    createdAt: new Date().toISOString().slice(0, 10),
    parties: ["Performer", "Agent", "Venue"],
  };

  // Optimistic: prepend event to events cache, add token to shareTokens cache
  queryClient.setQueriesData<Event[]>({ queryKey: queryKeys.events(uid) }, (old) => {
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
      queryClient.setQueriesData<Event[]>({ queryKey: queryKeys.events(uid) }, (old) => {
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
      queryClient.setQueriesData<Event[]>({ queryKey: queryKeys.events(uid) }, (old) => {
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
        const allEvents = getEventsData(queryClient, uid) ?? [];
        const children = allEvents.filter(
          (e) => parentEvent.childEventIds?.includes(e.id) && !e.archived,
        );
        const derivedStatus = deriveParentStatus(children);
        if (derivedStatus && derivedStatus !== parentEvent.eventStatus) {
          queryClient.setQueriesData<Event[]>({ queryKey: queryKeys.events(uid) }, (old) => {
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
      const data = getEventsData(queryClient, uid);
      const childEvent = data?.find((e) => e.id === childId);
      const parentEvent = data?.find((e) => e.id === parentId);

      // Optimistic update
      queryClient.setQueriesData<Event[]>({ queryKey: queryKeys.events(uid) }, (old) => {
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
      const allEventsAfter = getEventsData(queryClient, uid) ?? [];
      const updatedParent = allEventsAfter.find((e) => e.id === parentId);
      if (updatedParent?.isMultiPerformer) {
        const remainingChildren = allEventsAfter.filter(
          (e) => updatedParent.childEventIds?.includes(e.id) && !e.archived,
        );
        const derivedStatus = deriveParentStatus(remainingChildren);
        if (derivedStatus && derivedStatus !== updatedParent.eventStatus) {
          queryClient.setQueriesData<Event[]>({ queryKey: queryKeys.events(uid) }, (old) => {
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
      const data = getEventsData(queryClient, uid);
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
      queryClient.setQueriesData<Event[]>({ queryKey: queryKeys.events(uid) }, (old) => {
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
    const events = getEventsData(queryClient, uid);
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

    // Optimistic cache update — patch both the events query and the calendar
    // date-range query (different prefixes, so neither implies the other).
    const patchHoldRanks = (old: Event[] | undefined) => {
      if (!old) return old;
      return old.map((e) => {
        if (!Object.prototype.hasOwnProperty.call(localRanks, e.id)) return e;
        return { ...e, holdRank: localRanks[e.id] };
      });
    };
    queryClient.setQueriesData<Event[]>({ queryKey: queryKeys.events(uid) }, patchHoldRanks);
    queryClient.setQueriesData<Event[]>({ queryKey: ["calendarEvents", uid] }, patchHoldRanks);

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
    const events = getEventsData(queryClient, uid);
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

    // Optimistic cache update — patch both the events query and the calendar
    // date-range query (different prefixes, so neither implies the other).
    const patchHoldRanks = (old: Event[] | undefined) => {
      if (!old) return old;
      return old.map((e) => {
        if (!Object.prototype.hasOwnProperty.call(localRanks, e.id)) return e;
        return { ...e, holdRank: localRanks[e.id] };
      });
    };
    queryClient.setQueriesData<Event[]>({ queryKey: queryKeys.events(uid) }, patchHoldRanks);
    queryClient.setQueriesData<Event[]>({ queryKey: ["calendarEvents", uid] }, patchHoldRanks);

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

  /**
   * Detect any (date, venue, room) groups where multiple on-hold events share
   * the same holdRank, and renumber them deterministically (sort by current
   * rank ASC, then id ASC; assign 1..N). Persists corrections and updates the
   * cache. Idempotent — safe to call repeatedly. Self-healing safety net for
   * any code path that creates/edits an on-hold event without going through
   * `resolveHoldRankConflicts`.
   */
  const normalizeAllHoldRanks = (eventList?: Event[]): void => {
    const events = eventList ?? getEventsData(queryClient, uid);
    if (!events) return;

    const holdsByKey = new Map<string, Event[]>();
    for (const e of events) {
      if (e.eventStatus !== "on_hold" || e.archived) continue;
      const key = `${e.date}|${e.venue}|${e.roomStage || ""}`;
      const list = holdsByKey.get(key);
      if (list) list.push(e); else holdsByKey.set(key, [e]);
    }

    const corrections = new Map<string, number>();
    for (const group of holdsByKey.values()) {
      if (group.length < 2) continue;
      const ranks = group.map((e) => e.holdRank || 1);
      const hasDupes = new Set(ranks).size !== ranks.length;
      if (!hasDupes) continue;
      const sorted = [...group].sort((a, b) => {
        const ra = a.holdRank || 1;
        const rb = b.holdRank || 1;
        if (ra !== rb) return ra - rb;
        return a.id.localeCompare(b.id);
      });
      sorted.forEach((e, i) => {
        const next = i + 1;
        if ((e.holdRank || 1) !== next) corrections.set(e.id, next);
      });
    }

    if (corrections.size === 0) return;

    const patch = (old: Event[] | undefined) => {
      if (!old) return old;
      return old.map((e) => corrections.has(e.id) ? { ...e, holdRank: corrections.get(e.id)! } : e);
    };
    queryClient.setQueriesData<Event[]>({ queryKey: queryKeys.events(uid) }, patch);
    queryClient.setQueriesData<Event[]>({ queryKey: ["calendarEvents", uid] }, patch);

    for (const e of events) {
      const next = corrections.get(e.id);
      if (next != null) void upsertEvent({ ...e, holdRank: next });
    }
  };

  return { promoteHoldsOnDate, resolveHoldRankConflicts, normalizeAllHoldRanks };
}
