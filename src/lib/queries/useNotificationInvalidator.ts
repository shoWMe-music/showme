import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import type { AppNotification, NotificationType } from "@/lib/models";
import { queryKeys } from "./keys";

/**
 * Watches incoming notifications and invalidates the relevant TanStack Query
 * caches so the UI reflects changes made by other users in near-real-time.
 *
 * - Skips notifications triggered by the current user (optimistic updates already applied).
 * - Skips already-read notifications (historical load on mount).
 * - Debounces invalidation: collects unique query keys for 500ms then flushes once.
 */
export function useNotificationInvalidator(notifications: AppNotification[]) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const uid = user?.uid ?? "";

  const processedRef = useRef(new Set<string>());
  const pendingKeys = useRef(new Set<string>());
  const flushTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => clearTimeout(flushTimer.current);
  }, []);

  useEffect(() => {
    if (!uid) return;

    const scheduleInvalidation = (key: readonly unknown[]) => {
      pendingKeys.current.add(JSON.stringify(key));
      clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(() => {
        for (const serialized of pendingKeys.current) {
          queryClient.invalidateQueries({ queryKey: JSON.parse(serialized) });
        }
        pendingKeys.current.clear();
      }, 500);
    };

    for (const notif of notifications) {
      if (processedRef.current.has(notif.id)) continue;
      processedRef.current.add(notif.id);

      // Skip own actions — optimistic updates already handled these
      if (notif.actorUid === uid) continue;

      // Skip already-read notifications (historical load on mount)
      if (notif.read) continue;

      const eventId = notif.eventId;

      switch (notif.type as NotificationType) {
        // ── Events list ──────────────────────────────────────────────
        case "event_created":
        case "event_status_changed":
        case "event_details_updated":
        case "event_archived":
        case "event_unarchived":
        case "event_invitation":
          scheduleInvalidation(queryKeys.events(uid));
          if (eventId) {
            scheduleInvalidation(queryKeys.eventActivity(eventId));
          }
          break;

        // ── Date changes ─────────────────────────────────────────────
        case "date_change_proposed":
        case "date_change_confirmed":
        case "date_change_declined":
          scheduleInvalidation(queryKeys.events(uid));
          if (eventId) {
            scheduleInvalidation(queryKeys.eventEconomics(eventId));
          }
          break;

        // ── Economics (deal / revenue / settlement) ──────────────────
        case "deal_updated":
        case "revenue_updated":
        case "settlement_status_changed":
        case "settlement_revision_added":
          if (eventId) {
            scheduleInvalidation(queryKeys.eventEconomics(eventId));
            scheduleInvalidation(queryKeys.settlementActivity(eventId));
          }
          break;

        case "settlement_comment_added":
          if (eventId) {
            scheduleInvalidation(queryKeys.settlementActivity(eventId));
          }
          break;

        // ── Collaborators ────────────────────────────────────────────
        case "collaborator_invited":
        case "collaborator_joined":
          scheduleInvalidation(queryKeys.events(uid));
          // Per-event collaborator list also needs to refresh so the
          // Collaborators tab status flips from "Invite pending" → "Connected"
          // the moment the recipient accepts and the server trigger fires.
          if (eventId) {
            scheduleInvalidation(queryKeys.eventCollaborators(eventId));
          }
          break;

        // ── Booking requests ─────────────────────────────────────────
        case "booking_request_received":
        case "booking_request_responded":
        case "booking_request_status_changed":
          scheduleInvalidation(queryKeys.bookingRequests());
          break;

        // ── Event sub-data (todos, riders, etc.) ─────────────────────
        // agreement_confirmed lives here too: the confirmations array is
        // stored on event meta and surfaces through useEventEconomics, so the
        // Agreement Confirmation rows flip from "Not yet confirmed" the moment
        // the cache is invalidated.
        case "task_assigned":
        case "rider_updated":
        case "agreement_updated":
        case "agreement_confirmed":
        case "crew_updated":
        case "schedule_updated":
          if (eventId) {
            scheduleInvalidation(queryKeys.eventEconomics(eventId));
            scheduleInvalidation(queryKeys.eventActivity(eventId));
          }
          break;

        // ── Messages: already real-time via onSnapshot, no-op ────────
        case "message_sent":
          break;

        // ── Profile invite — refresh the pending-invites banner under
        //    Settings → Profile Access so a fresh invite appears live.
        case "profile_invite":
          scheduleInvalidation(["pendingProfileInvites"]);
          break;

        // ── Profile member joined — refresh the members list on the
        //    Profile Access tab. Prefix-only invalidation matches every
        //    queryKeys.profileMembers(profileId) entry.
        case "profile_member_joined":
          scheduleInvalidation(["profileMembers"]);
          break;

        // ── Profile member removed — refresh the members list and (for
        //    the removed user) the events query and profiles list since
        //    their access just changed.
        case "profile_member_removed":
          scheduleInvalidation(["profileMembers"]);
          scheduleInvalidation(queryKeys.events(uid));
          scheduleInvalidation(queryKeys.profiles(uid));
          break;

        // ── Profile invite declined — refresh the pending invites list
        //    on the recipient side and the profile members/invites view
        //    on the sender side.
        case "profile_invite_declined":
          scheduleInvalidation(["pendingProfileInvites"]);
          scheduleInvalidation(["profileMembers"]);
          break;

        // ── Profile role changed — refresh members list (so the affected
        //    user's role badge updates) and the user's profiles list (the
        //    role is part of the profile membership shape).
        case "profile_member_role_changed":
          scheduleInvalidation(["profileMembers"]);
          scheduleInvalidation(queryKeys.profiles(uid));
          break;
      }
    }

    // Prune processed set to avoid unbounded growth
    if (processedRef.current.size > 200) {
      const currentIds = new Set(notifications.map((n) => n.id));
      for (const id of processedRef.current) {
        if (!currentIds.has(id)) processedRef.current.delete(id);
      }
    }
  }, [notifications, uid, queryClient]);
}
