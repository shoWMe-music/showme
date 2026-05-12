import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import {
  onDocumentWritten,
  onDocumentCreated,
} from "firebase-functions/v2/firestore";
import { sendMail, BREVO_API_KEY } from "./mail";
import { bookingRequestStatusEmail } from "./emailTemplates";
import { APP_BASE_URL } from "./appBaseUrl";

const db = () => admin.firestore();

// ── Helpers ──────────────────────────────────────────────────────────────────

interface NotificationPayload {
  type: string;
  title: string;
  body: string;
  eventId?: string;
  eventName?: string;
  actorName?: string;
  actorUid?: string;
  link?: string;
  metadata?: Record<string, string>;
}

/** Collect every uid that is a member of any of the given profiles. */
async function collectMemberUids(profileIds: string[]): Promise<Set<string>> {
  const uids = new Set<string>();
  await Promise.all(
    profileIds.map(async (pid) => {
      try {
        const members = await db()
          .collection("profiles").doc(pid)
          .collection("members").get();
        for (const m of members.docs) {
          // member doc id == uid
          if (m.id) uids.add(m.id);
        }
      } catch (err) {
        logger.warn(`Failed to read members for profile ${pid}`, { err });
      }
    }),
  );
  return uids;
}

async function resolveActorName(actorUid: string): Promise<string> {
  if (!actorUid) return "Someone";
  try {
    const userRecord = await admin.auth().getUser(actorUid);
    return userRecord.displayName || userRecord.email || "Someone";
  } catch {
    return "Someone";
  }
}

/**
 * Write one notification per user who is a member of any profile tied to the
 * event (via accessProfileIds), excluding the actor themselves. Notifications
 * land in users/{uid}/notifications/{auto} so each user gets their own copy.
 */
async function notifyEventProfiles(
  eventId: string,
  actorUid: string,
  payload: Omit<NotificationPayload, "actorName" | "actorUid">,
  excludeProfileIds?: string[],
): Promise<void> {
  const eventSnap = await db().collection("events").doc(eventId).get();
  if (!eventSnap.exists) return;

  const event = eventSnap.data()!;
  const allProfileIds: string[] = Array.isArray(event.accessProfileIds)
    ? event.accessProfileIds
    : [];

  if (allProfileIds.length === 0) return;

  const excludeSet = new Set(excludeProfileIds || []);
  const profileIds = allProfileIds.filter((pid) => !excludeSet.has(pid));
  if (profileIds.length === 0) return;

  const recipientUids = await collectMemberUids(profileIds);
  if (actorUid) recipientUids.delete(actorUid);
  if (recipientUids.size === 0) return;

  const actorName = await resolveActorName(actorUid);
  const eventName = (typeof event.name === "string" && event.name) || "";
  const now = new Date().toISOString();

  const batch = db().batch();
  for (const uid of recipientUids) {
    const ref = db().collection("users").doc(uid).collection("notifications").doc();
    batch.set(ref, {
      type: payload.type,
      title: payload.title,
      body: payload.body,
      eventId,
      eventName: payload.eventName || eventName,
      actorName,
      actorUid,
      read: false,
      createdAt: now,
      link: payload.link || `/events/${eventId}`,
      metadata: payload.metadata || {},
    });
  }
  await batch.commit();
  logger.info(`Created ${recipientUids.size} notifications for event ${eventId}`, { type: payload.type });
}

/**
 * Write one notification per member of `profileId`, excluding the actor and
 * (optionally) anyone who is a member of `excludeProfileIds`. Each notification
 * lands at users/{uid}/notifications/{auto}.
 *
 * The `excludeProfileIds` escape hatch is for cases where the targeted profile
 * shares members with another profile already involved in the event — e.g.
 * sending an `event_invitation` to the performer should not reach a venue
 * teammate who happens to also be on the performer's team, since "the venue
 * has suggested you" doesn't apply to someone on the venue's side.
 */
async function notifyProfile(
  profileId: string,
  payload: NotificationPayload,
  excludeProfileIds?: string[],
): Promise<void> {
  const recipientUids = await collectMemberUids([profileId]);
  if (payload.actorUid) recipientUids.delete(payload.actorUid);
  if (excludeProfileIds && excludeProfileIds.length > 0) {
    const excludedUids = await collectMemberUids(excludeProfileIds);
    for (const uid of excludedUids) recipientUids.delete(uid);
  }
  if (recipientUids.size === 0) return;

  const now = new Date().toISOString();
  const batch = db().batch();
  for (const uid of recipientUids) {
    const ref = db().collection("users").doc(uid).collection("notifications").doc();
    // Firestore rejects undefined; drop missing optional fields rather than
    // sending them. Some notification sources (booking requests, profile
    // invites) have no event context.
    const docData: Record<string, unknown> = {
      type: payload.type,
      title: payload.title,
      body: payload.body,
      read: false,
      createdAt: now,
      metadata: payload.metadata || {},
    };
    if (payload.eventId) docData.eventId = payload.eventId;
    if (payload.eventName) docData.eventName = payload.eventName;
    if (payload.actorName) docData.actorName = payload.actorName;
    if (payload.actorUid) docData.actorUid = payload.actorUid;
    if (payload.link) docData.link = payload.link;
    batch.set(ref, docData);
  }
  await batch.commit();
}

// ── Event creation ───────────────────────────────────────────────────────────

/**
 * Fans an "event_created" notification out to every member of every profile
 * tied to a freshly-created event (host + performer + collaborators), minus
 * the actor. Profile owners receive this via the same members-subcollection
 * fanout as everyone else — owners have a `members/{ownerUid}` doc with
 * role=owner, so `collectMemberUids` picks them up.
 *
 * `onEventUpdated` early-returns when `before` is missing, so without this
 * trigger nobody is notified about a new event until something changes on it.
 */
export const onEventCreated = onDocumentCreated(
  { document: "events/{eventId}", region: "europe-west1" },
  async (event) => {
    const after = event.data?.data();
    if (!after) return;

    const eventId = event.params.eventId;
    const actorUid: string =
      (typeof after._lastUpdatedBy === "string" && after._lastUpdatedBy) ||
      (typeof after.owner_uid === "string" && after.owner_uid) ||
      "";
    if (!actorUid) return;

    const eventName = (typeof after.name === "string" && after.name) || "Event";
    const dateLabel = (typeof after.date === "string" && after.date) || "TBD";
    const venueLabel = (typeof after.venue === "string" && after.venue) || "";

    await notifyEventProfiles(eventId, actorUid, {
      type: "event_created",
      title: "New event created",
      body: venueLabel
        ? `"${eventName}" on ${dateLabel} at ${venueLabel}`
        : `"${eventName}" on ${dateLabel}`,
      eventName,
    });
  },
);

// ── Event status & details ───────────────────────────────────────────────────

export const onEventUpdated = onDocumentWritten(
  { document: "events/{eventId}", region: "europe-west1" },
  async (event) => {
    if (!event.data) return;
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (!before || !after) return;

    const eventId = event.params.eventId;
    const actorUid: string = after._lastUpdatedBy || after.owner_uid || "";
    if (!actorUid) return;

    // Status change
    if (before.eventStatus !== after.eventStatus) {
      // Special case: draft/other → suggested with a performer = invitation
      if (after.eventStatus === "suggested" && after.performerProfileId) {
        const performerPid = after.performerProfileId as string;

        // Resolve host profile name (e.g. the venue or promoter name)
        let hostName = "";
        if (after.hostProfileId) {
          try {
            const hostSnap = await db().collection("profiles").doc(after.hostProfileId as string).get();
            if (hostSnap.exists) hostName = (hostSnap.data()?.name as string) || "";
          } catch { /* ignore */ }
        }
        // Fall back to actor's user name
        if (!hostName) {
          try {
            const userRecord = await admin.auth().getUser(actorUid);
            hostName = userRecord.displayName || userRecord.email || "Someone";
          } catch { hostName = "Someone"; }
        }

        const eventLabel = after.name || "an event";
        const dateLabel = after.date || "TBD";
        const venueLabel = after.venue || "";

        // Exclude the host's team — if a venue teammate happens to also be on
        // the performer's roster, "the venue has suggested you" makes no sense
        // for them. They still receive the host-side `event_status_changed`
        // notification below.
        const hostExclusion = after.hostProfileId ? [after.hostProfileId as string] : [];
        await notifyProfile(performerPid, {
          type: "event_invitation",
          title: "New event suggestion",
          body: venueLabel
            ? `${hostName} has suggested you for "${eventLabel}" on ${dateLabel} at ${venueLabel}`
            : `${hostName} has suggested you for "${eventLabel}" on ${dateLabel}`,
          eventId,
          eventName: after.name,
          actorName: hostName,
          actorUid,
          link: "/requests",
        }, hostExclusion);

        // Also notify other profiles (not the performer, they already got the invitation)
        await notifyEventProfiles(eventId, actorUid, {
          type: "event_status_changed",
          title: `Event status: ${after.eventStatus}`,
          body: `"${after.name || "Event"}" status changed from ${before.eventStatus} to ${after.eventStatus}`,
          eventName: after.name,
        }, [performerPid]);
      } else if (
        after.eventStatus === "cancelled" &&
        after.autoCancelledReason === "expired_unconfirmed"
      ) {
        await notifyEventProfiles(eventId, actorUid, {
          type: "event_status_changed",
          title: "Event auto-cancelled",
          body: `Date passed without confirmation — "${after.name || "Event"}" was moved to Cancelled.`,
          eventName: after.name,
          eventId,
        });
      } else {
        await notifyEventProfiles(eventId, actorUid, {
          type: "event_status_changed",
          title: `Event status: ${after.eventStatus}`,
          body: `"${after.name || "Event"}" status changed from ${before.eventStatus} to ${after.eventStatus}`,
          eventName: after.name,
        });
      }
    }

    // Performer declined invitation → notify the host
    if (!before.performerResponse && after.performerResponse === "declined" && after.hostProfileId) {
      const hostPid = after.hostProfileId as string;
      let performerName = after.artist || "The performer";
      await notifyProfile(hostPid, {
        type: "event_status_changed",
        title: "Invitation declined",
        body: `${performerName} has declined the invitation for "${after.name || "event"}"`,
        eventId,
        eventName: after.name,
        actorName: performerName,
        actorUid,
        link: `/events/${eventId}`,
      });
    }

    // Performer accepted invitation → notify the host
    if (!before.performerResponse && after.performerResponse === "accepted" && after.hostProfileId) {
      const hostPid = after.hostProfileId as string;
      let performerName = after.artist || "The performer";
      await notifyProfile(hostPid, {
        type: "event_status_changed",
        title: "Invitation accepted",
        body: `${performerName} has accepted the invitation for "${after.name || "event"}"`,
        eventId,
        eventName: after.name,
        actorName: performerName,
        actorUid,
        link: `/events/${eventId}`,
      });
    }

    // Archive / unarchive
    if (!before.isArchived && after.isArchived) {
      await notifyEventProfiles(eventId, actorUid, {
        type: "event_archived",
        title: "Event archived",
        body: `"${after.name || "Event"}" has been archived`,
        eventName: after.name,
      });
    }
    if (before.isArchived && !after.isArchived) {
      await notifyEventProfiles(eventId, actorUid, {
        type: "event_unarchived",
        title: "Event unarchived",
        body: `"${after.name || "Event"}" has been unarchived`,
        eventName: after.name,
      });
    }

    // Key detail changes
    const fields = ["name", "date", "venue", "artist", "city"];
    const changes = fields.filter((f) => before[f] !== after[f]);
    if (changes.length > 0 && before.eventStatus === after.eventStatus) {
      await notifyEventProfiles(eventId, actorUid, {
        type: "event_details_updated",
        title: "Event details updated",
        body: `"${after.name || "Event"}" — updated: ${changes.join(", ")}`,
        eventName: after.name,
        link: `/events/${eventId}?tab=details`,
        metadata: {
          ...Object.fromEntries(changes.map((f) => [f, String(after[f] ?? "")])),
          tab: "details",
        },
      });
    }
  },
);

// ── Deal changes ─────────────────────────────────────────────────────────────

export const onDealUpdated = onDocumentWritten(
  { document: "events/{eventId}/deal/main", region: "europe-west1" },
  async (event) => {
    if (!event.data) return;
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (!after) return;
    // Suppress notification on initial creation — the deal doc gets seeded
    // alongside the event itself and the "New event" notification already
    // covers it. Only notify on real subsequent updates.
    if (!before) return;

    const eventId = event.params.eventId;
    const actorUid: string = after._lastUpdatedBy || "";

    await notifyEventProfiles(eventId, actorUid, {
      type: "deal_updated",
      title: "Deal updated",
      body: "Deal structure has been modified",
      link: `/events/${eventId}?tab=budget#deal`,
      metadata: { tab: "budget", section: "deal" },
    });
  },
);

// ── Revenue changes ──────────────────────────────────────────────────────────

export const onRevenueUpdated = onDocumentWritten(
  { document: "events/{eventId}/revenue/main", region: "europe-west1" },
  async (event) => {
    if (!event.data) return;
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (!after) return;
    // Suppress notification on initial creation — the revenue doc is seeded
    // with the event and conveys no real activity yet.
    if (!before) return;

    const eventId = event.params.eventId;
    const actorUid: string = after._lastUpdatedBy || "";

    await notifyEventProfiles(eventId, actorUid, {
      type: "revenue_updated",
      title: "Revenue updated",
      body: "Ticket revenue figures have been updated",
      link: `/events/${eventId}?tab=budget#revenue`,
      metadata: { tab: "budget", section: "revenue" },
    });
  },
);

// ── Settlement changes ───────────────────────────────────────────────────────

export const onSettlementUpdated = onDocumentWritten(
  { document: "events/{eventId}/settlement/main", region: "europe-west1" },
  async (event) => {
    if (!event.data) return;
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (!after) return;
    // Suppress on initial creation — the settlement doc seeds with status
    // "open" alongside the event; that is not a meaningful status change.
    if (!before) return;

    const eventId = event.params.eventId;
    const actorUid: string = after._lastUpdatedBy || "";

    if (before.status !== after.status) {
      await notifyEventProfiles(eventId, actorUid, {
        type: "settlement_status_changed",
        title: `Settlement: ${after.status}`,
        body: `Settlement status changed to "${after.status}"`,
        // Settlement notifications resolve to /settlements/$id via the
        // notification-type branch in resolveNotificationTarget.
        link: `/settlements/${eventId}`,
      });
    }
  },
);

// ── Settlement activity (comments, revisions) ────────────────────────────────

export const onSettlementActivity = onDocumentCreated(
  { document: "events/{eventId}/activity/{activityId}", region: "europe-west1" },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const eventId = event.params.eventId;
    const type: string = data.type || "";
    const by: string = data.by || "";

    // We need the actor UID — try to find from event participants
    const eventSnap = await db().collection("events").doc(eventId).get();
    const eventData = eventSnap.data();
    const actorUid: string = data.actorUid || eventData?._lastUpdatedBy || "";

    if (type === "comment_added") {
      const details = (data.details as Record<string, string> | undefined) ?? {};
      await notifyEventProfiles(eventId, actorUid, {
        type: "settlement_comment_added",
        title: "New settlement comment",
        body: `${by} commented on the settlement`,
        // SettlementWorkspace has an existing #comments scroll handler that
        // activates inside the settlement tab — match its expectations.
        link: `/settlements/${eventId}?tab=settlement#comments`,
        metadata: { ...details, tab: "settlement", section: "comments" },
      });
    }

    if (type === "revision_added") {
      await notifyEventProfiles(eventId, actorUid, {
        type: "settlement_revision_added",
        title: "Settlement revision",
        body: `${by} submitted a settlement revision`,
        link: `/settlements/${eventId}?tab=changelog`,
        metadata: { tab: "changelog" },
      });
    }
  },
);

// ── Event activity (date changes, etc.) ──────────────────────────────────────

export const onEventActivity = onDocumentCreated(
  { document: "events/{eventId}/event_activity/{activityId}", region: "europe-west1" },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const eventId = event.params.eventId;
    const type: string = data.type || "";
    const by: string = data.by || "";
    const eventSnap = await db().collection("events").doc(eventId).get();
    if (!eventSnap.exists) return;
    const eventData = eventSnap.data();
    const actorUid: string = data.actorUid || eventData?._lastUpdatedBy || "";
    const eventName = eventData?.name || "Event";

    switch (type) {
      case "date_change_proposed":
        await notifyEventProfiles(eventId, actorUid, {
          type: "date_change_proposed",
          title: "Date change proposed",
          body: `${by} proposed a date change for "${eventName}"`,
          eventName,
        });
        break;
      case "date_change_confirmed":
        await notifyEventProfiles(eventId, actorUid, {
          type: "date_change_confirmed",
          title: "Date change confirmed",
          body: `${by} confirmed the date change for "${eventName}"`,
          eventName,
        });
        break;
      case "date_change_declined":
        await notifyEventProfiles(eventId, actorUid, {
          type: "date_change_declined",
          title: "Date change declined",
          body: `${by} declined the date change for "${eventName}"`,
          eventName,
        });
        break;
      case "rider_updated":
        await notifyEventProfiles(eventId, actorUid, {
          type: "rider_updated",
          title: "Rider updated",
          body: `${by} updated a rider for "${eventName}"`,
          eventName,
          link: `/events/${eventId}?tab=details#riders`,
          metadata: { tab: "details", section: "riders" },
        });
        break;
      case "agreement_updated":
        await notifyEventProfiles(eventId, actorUid, {
          type: "agreement_updated",
          title: "Agreement updated",
          body: `${by} updated an agreement for "${eventName}"`,
          eventName,
          link: `/events/${eventId}?tab=agreement`,
          metadata: { tab: "agreement" },
        });
        break;
      case "crew_updated":
        await notifyEventProfiles(eventId, actorUid, {
          type: "crew_updated",
          title: "Crew updated",
          body: `${by} updated crew for "${eventName}"`,
          eventName,
          link: `/events/${eventId}?tab=crew`,
          metadata: { tab: "crew" },
        });
        break;
      case "schedule_updated":
        await notifyEventProfiles(eventId, actorUid, {
          type: "schedule_updated",
          title: "Schedule updated",
          body: `${by} updated the schedule for "${eventName}"`,
          eventName,
          link: `/events/${eventId}?tab=details#schedule`,
          metadata: { tab: "details", section: "schedule" },
        });
        break;
    }
  },
);

// ── Messages ─────────────────────────────────────────────────────────────────

export const onMessageSent = onDocumentCreated(
  { document: "events/{eventId}/messages/{messageId}", region: "europe-west1" },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const eventId = event.params.eventId;
    const senderUid: string = data.sender_uid || "";
    const senderName: string = data.sender_name || data.name || "Someone";
    const messageText: string = data.text || data.message || "";
    const preview = messageText.length > 80
      ? messageText.slice(0, 80) + "…"
      : messageText;

    const eventSnap = await db().collection("events").doc(eventId).get();
    if (!eventSnap.exists) return;
    const eventName = eventSnap.data()?.name || "Event";

    await notifyEventProfiles(eventId, senderUid, {
      type: "message_sent",
      title: `New message on "${eventName}"`,
      body: `${senderName}: ${preview || "sent a message"}`,
      eventName,
      link: `/events/${eventId}?tab=messages`,
      metadata: { tab: "messages" },
    });
  },
);

// ── Collaborator invites ─────────────────────────────────────────────────────

export const onCollaboratorAdded = onDocumentCreated(
  { document: "events/{eventId}/collaborators/{collabId}", region: "europe-west1" },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const eventId = event.params.eventId;
    const eventSnap = await db().collection("events").doc(eventId).get();
    if (!eventSnap.exists) return;
    const eventData = eventSnap.data();
    const eventName = eventData?.name || "Event";

    // If the collaborator has a profileId, notify that profile
    const profileId = data.profileId as string | undefined;
    if (profileId) {
      const inviterUid = (data.invitedByUid as string) || (eventData?._lastUpdatedBy as string) || (eventData?.owner_uid as string) || "";
      const actorName = await resolveActorName(inviterUid);

      await notifyProfile(profileId, {
        type: "collaborator_invited",
        title: "Collaborator invite",
        body: `${actorName} invited you to collaborate on "${eventName}"`,
        actorName,
        actorUid: inviterUid,
        eventId,
        eventName,
        link: `/events/${eventId}?tab=collaborators#collaborators`,
        metadata: { tab: "collaborators", section: "collaborators" },
      });
    }
  },
);

// ── Collaborator joined (status changed to active) ──────────────────────────

export const onCollaboratorUpdated = onDocumentWritten(
  { document: "events/{eventId}/collaborators/{collabId}", region: "europe-west1" },
  async (event) => {
    if (!event.data) return;
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (!before || !after) return;

    const beforeStatus = before.status as string;
    const afterStatus = after.status as string;

    if (beforeStatus !== "active" && afterStatus === "active") {
      const eventId = event.params.eventId;
      const collabName = (after.name as string) || "A collaborator";
      const collabUid = (after.userUid as string) || "";

      await notifyEventProfiles(eventId, collabUid, {
        type: "collaborator_joined",
        title: "Collaborator joined",
        body: `${collabName} has joined the event`,
        link: `/events/${eventId}?tab=collaborators#collaborators`,
        metadata: { tab: "collaborators", section: "collaborators" },
      });
    }
  },
);

// ── Booking requests ─────────────────────────────────────────────────────────

export const onBookingRequestCreated = onDocumentCreated(
  { document: "inboundBookingRequests/{requestId}", region: "europe-west1" },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;
    const ref = event.data?.ref;
    if (!ref) return;

    // The public request form stores snake_case fields (see RequestDateForm /
    // insertPublicBookingRequest). Fall back to the legacy camelCase keys for
    // any pre-migration docs that might still land here.
    const profileId =
      (data.target_profile_id as string | undefined) ||
      (data.profileId as string | undefined);
    if (!profileId) return;

    const ownerUid = String(data.owner_uid ?? "").trim();
    const requesterEmail = String(data.email ?? "").trim().toLowerCase();

    // Sticky block: if this owner has previously blocked this requester's
    // email, silently re-classify the new doc as blocked so it doesn't reach
    // the team's pending queue or fire notifications.
    if (ownerUid && requesterEmail) {
      try {
        const priorBlock = await db()
          .collection("inboundBookingRequests")
          .where("owner_uid", "==", ownerUid)
          .where("email", "==", String(data.email ?? "").trim())
          .where("status", "==", "blocked")
          .limit(1)
          .get();
        if (!priorBlock.empty) {
          // Omit _lastUpdatedBy so onBookingRequestUpdated treats this as a
          // system-driven transition and skips its own fan-out.
          await ref.update({ status: "blocked" });
          logger.info("onBookingRequestCreated: auto-blocked from sticky block list", {
            email: requesterEmail,
            ownerUid,
            requestId: ref.id,
          });
          return;
        }
      } catch (err) {
        logger.warn("onBookingRequestCreated: sticky-block check failed", {
          err: String(err),
        });
      }
    }

    const artistName =
      (data.artist_name as string | undefined) ||
      (data.artistName as string | undefined) ||
      "An artist";
    const requestDate =
      (data.wanted_date as string | undefined) ||
      (data.preferredDate as string | undefined) ||
      "";

    await notifyProfile(profileId, {
      type: "booking_request_received",
      title: "New booking request",
      body: `${artistName} requested a booking${requestDate ? ` for ${requestDate}` : ""}`,
      actorName: artistName,
      actorUid: "",
      link: "/requests",
    });
  },
);

/**
 * Booking request status changed by a team member. Two side effects:
 *
 *   1. In-app: notify every other admin/member of the target profile so the
 *      team doesn't act on a stale view. Excludes the actor via _lastUpdatedBy.
 *      Fires for accepted | declined | archived | blocked | draft_created.
 *
 *   2. Email: notify the original requester (anonymous, identified only by the
 *      email they supplied on submission). Fires only for accepted | declined
 *      — internal status changes (archived/blocked/draft_created) are noise
 *      from the requester's point of view.
 *
 * Both side effects are best-effort: an email failure doesn't block the in-app
 * fan-out and vice versa.
 */
export const onBookingRequestUpdated = onDocumentWritten(
  {
    document: "inboundBookingRequests/{requestId}",
    region: "europe-west1",
    secrets: [BREVO_API_KEY],
  },
  async (event) => {
    if (!event.data) return;
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (!before || !after) return;

    if (before.status === after.status) return;
    // System-driven transitions (e.g. sticky-block auto-classification in
    // onBookingRequestCreated) omit `_lastUpdatedBy`. Skip team/email fan-out
    // so the user never sees "A teammate blocked..." for an automatic
    // classification, and the requester doesn't get an unexpected email.
    if (!after._lastUpdatedBy) return;
    const newStatus = String(after.status ?? "");
    const NOTIFIABLE = new Set([
      "accepted",
      "declined",
      "archived",
      "blocked",
      "draft_created",
    ]);
    if (!NOTIFIABLE.has(newStatus)) return;

    const profileId =
      (after.target_profile_id as string | undefined) ||
      (after.artistProfileId as string | undefined);
    if (!profileId) return;

    const actorUid = (after._lastUpdatedBy as string | undefined) || "";
    const artistName =
      (after.artist_name as string | undefined) ||
      (after.artistName as string | undefined) ||
      "a booking request";
    const verb =
      newStatus === "draft_created" ? "drafted an event from" : newStatus;

    // 1. In-app notification to the team.
    try {
      await notifyProfile(profileId, {
        type: "booking_request_status_changed",
        title: `Booking ${newStatus.replace("_", " ")}`,
        body: `A teammate ${verb} ${artistName}`,
        actorUid,
        link: "/requests",
      });
    } catch (err) {
      logger.error("onBookingRequestUpdated: in-app notify failed", {
        profileId,
        err: String(err),
      });
    }

    // 2. Email to the anonymous requester — only on accepted/declined.
    if (newStatus !== "accepted" && newStatus !== "declined") return;
    const requesterEmail = String(after.email ?? "").trim();
    if (!requesterEmail) return;
    const requesterName = String(after.name ?? "").trim() || undefined;

    let venueName = "the venue";
    try {
      const profileSnap = await db().collection("profiles").doc(profileId).get();
      const profileData = profileSnap.data() as Record<string, unknown> | undefined;
      if (profileData?.name && typeof profileData.name === "string") {
        venueName = profileData.name;
      }
    } catch (err) {
      logger.warn("onBookingRequestUpdated: profile lookup for email failed", {
        profileId,
        err: String(err),
      });
    }

    const wantedDate = String(after.wanted_date ?? "").trim() || undefined;
    const tpl = bookingRequestStatusEmail({
      requesterName,
      targetName: venueName,
      artistName: typeof artistName === "string" && artistName !== "a booking request" ? artistName : undefined,
      wantedDate,
      status: newStatus,
      appBaseUrl: APP_BASE_URL,
    });

    try {
      await sendMail({
        to: requesterEmail,
        toName: requesterName,
        subject: tpl.subject,
        html: tpl.html,
      });
    } catch (err) {
      logger.error("onBookingRequestUpdated: requester email failed", {
        to: requesterEmail,
        status: newStatus,
        err: String(err),
      });
    }
  },
);

// ── Event meta changes (task assignment) ─────────────────────────────────────

export const onEventMetaUpdated = onDocumentWritten(
  { document: "events/{eventId}/meta/main", region: "europe-west1" },
  async (event) => {
    if (!event.data) return;
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (!after) return;

    const eventId = event.params.eventId;
    const actorUid: string = after._lastUpdatedBy || "";

    // ── Date-change relay (child → parent) ─────────────────────────────────────
    // When a performer responds on a child event, they can only write to that
    // child's meta. Mirror the response up to the parent (and across siblings)
    // here, since the parent owns the source-of-truth pendingDateChange.
    await relayChildDateChangeResponse(eventId, before, after);

    // Check for new todo assignments
    const beforeTodos: Array<Record<string, unknown>> = (before?.todos as Array<Record<string, unknown>>) || [];
    const afterTodos: Array<Record<string, unknown>> = (after.todos as Array<Record<string, unknown>>) || [];

    // ── Agreement confirmations ────────────────────────────────────────────────
    const beforeConfirmations: Array<Record<string, unknown>> =
      (before?.agreementConfirmations as Array<Record<string, unknown>>) || [];
    const afterConfirmations: Array<Record<string, unknown>> =
      (after.agreementConfirmations as Array<Record<string, unknown>>) || [];

    const beforeParties = new Set(beforeConfirmations.map((c) => c.party as string));
    const newConfirmations = afterConfirmations.filter(
      (c) => !beforeParties.has(c.party as string),
    );

    if (newConfirmations.length > 0) {
      const eventSnap = await db().collection("events").doc(eventId).get();
      if (!eventSnap.exists) return;
      const eventData = eventSnap.data();
      const eventName = (eventData?.name as string) || "Event";

      for (const conf of newConfirmations) {
        const party = conf.party as string;
        const profileName = conf.confirmedBy as string || party;

        await notifyEventProfiles(eventId, actorUid, {
          type: "agreement_confirmed",
          title: "Agreement confirmed",
          body: `${profileName} confirmed the agreement for "${eventName}" as ${party}`,
          eventName,
          link: `/events/${eventId}?tab=agreement#confirmations`,
          metadata: { tab: "agreement", section: "confirmations" },
        });
      }
    }

    // ── Todo assignments ────────────────────────────────────────────────────────

    // Find newly added todos that have an assignee
    const beforeIds = new Set(beforeTodos.map((t) => t.id as string));
    const newTodos = afterTodos.filter(
      (t) => !beforeIds.has(t.id as string) && t.assignee,
    );

    if (newTodos.length === 0) return;

    const todoEventSnap = await db().collection("events").doc(eventId).get();
    const todoEventData = todoEventSnap.data();
    const todoEventName = (todoEventData?.name as string) || "Event";

    for (const todo of newTodos) {
      const assigneeProfileId = todo.assigneeProfileId as string | undefined;
      if (!assigneeProfileId) continue;

      let actorName = "Someone";
      try {
        if (actorUid) {
          const userRecord = await admin.auth().getUser(actorUid);
          actorName = userRecord.displayName || userRecord.email || "Someone";
        }
      } catch { /* */ }

      await notifyProfile(assigneeProfileId, {
        type: "task_assigned",
        title: "Task assigned",
        body: `${actorName} assigned you a task on "${todoEventName}": ${todo.text || "New task"}`,
        actorName,
        actorUid,
        eventId,
        eventName: todoEventName,
        link: `/events/${eventId}?tab=todo`,
        metadata: { tab: "todo" },
      });
    }
  },
);

// ── Date-change relay helper ──────────────────────────────────────────────────
//
// The host writes pendingDateChange to the parent's meta + each active child's
// meta (mirrored). Performers who only have access to their child event respond
// by writing to the child's meta. This helper detects such a response and
// relays it back to the parent's pendingDateChange — the source of truth.
// When all parties have confirmed, dates are applied to parent + children and
// pendingDateChange is cleared everywhere.

interface DateChangeConfirmation {
  status: "pending" | "confirmed" | "declined";
  respondedAt?: string;
  respondedBy?: string;
  respondedByName?: string;
  role: "performer" | "venue";
  profileName: string;
  onPlatform: boolean;
}

interface PendingDateChange {
  id: string;
  proposedBy: string;
  proposedByProfile?: string;
  proposedAt: string;
  previousValues: { date?: string; startTime?: string; endTime?: string };
  proposedValues: { date?: string; startTime?: string; endTime?: string };
  confirmations: Record<string, DateChangeConfirmation>;
}

async function relayChildDateChangeResponse(
  eventId: string,
  before: FirebaseFirestore.DocumentData | undefined,
  after: FirebaseFirestore.DocumentData,
): Promise<void> {
  const beforePending = before?.pendingDateChange as PendingDateChange | undefined;
  const afterPending = after.pendingDateChange as PendingDateChange | undefined;
  if (!afterPending || !afterPending.confirmations) return;

  // Detect confirmations whose respondedAt advanced (i.e., a real response)
  const changed: string[] = [];
  for (const [pid, conf] of Object.entries(afterPending.confirmations)) {
    if (!conf?.respondedAt) continue;
    const beforeConf = beforePending?.confirmations?.[pid];
    if (conf.respondedAt !== beforeConf?.respondedAt) {
      changed.push(pid);
    }
  }
  if (changed.length === 0) return;

  // Only relay if this event is a child — the parent's own writes are
  // already authoritative (and the host's client has mirrored to children).
  const eventSnap = await db().collection("events").doc(eventId).get();
  if (!eventSnap.exists) return;
  const eventData = eventSnap.data() || {};
  const parentEventId = (eventData.parentEventId as string | undefined) || "";
  if (!parentEventId) return;

  const parentMetaRef = db().doc(`events/${parentEventId}/meta/main`);
  const parentMetaSnap = await parentMetaRef.get();
  const parentMeta = parentMetaSnap.data() || {};
  const parentPending = parentMeta.pendingDateChange as PendingDateChange | undefined;
  if (!parentPending || !parentPending.confirmations) {
    logger.info("Parent has no pending date change; skipping relay", { eventId, parentEventId });
    return;
  }

  // Skip if parent already reflects the child's state (loop prevention: we
  // just got a mirror-down from parent, no upstream change to propagate).
  let needsRelay = false;
  for (const pid of changed) {
    const childConf = afterPending.confirmations[pid];
    const parentConf = parentPending.confirmations[pid];
    if (!parentConf) continue;
    if (childConf.respondedAt !== parentConf.respondedAt) {
      parentPending.confirmations[pid] = childConf;
      needsRelay = true;
    }
  }
  if (!needsRelay) return;

  const allConfirmed = Object.values(parentPending.confirmations).every(
    (c) => c.status === "confirmed",
  );

  const parentEventSnap = await db().collection("events").doc(parentEventId).get();
  if (!parentEventSnap.exists) return;
  const parentEvent = parentEventSnap.data() || {};
  const childIds: string[] = Array.isArray(parentEvent.childEventIds)
    ? (parentEvent.childEventIds as string[])
    : [];

  // Resolve actor name for activity log
  const responder = changed
    .map((pid) => parentPending.confirmations[pid])
    .find((c) => c?.respondedByName);
  const responderName = responder?.respondedByName || "Someone";

  if (allConfirmed) {
    // Apply dates to parent + active children, clear pendingDateChange across all
    const dateUpdates: Record<string, string> = {};
    if (parentPending.proposedValues.date) dateUpdates.date = parentPending.proposedValues.date;
    if (parentPending.proposedValues.startTime) dateUpdates.startTime = parentPending.proposedValues.startTime;
    if (parentPending.proposedValues.endTime) dateUpdates.endTime = parentPending.proposedValues.endTime;

    const batch = db().batch();
    batch.set(
      db().collection("events").doc(parentEventId),
      { ...dateUpdates, _lastUpdatedBy: actorUidFromConfirmation(responder) },
      { merge: true },
    );
    batch.set(
      parentMetaRef,
      {
        pendingDateChange: FieldValue.delete(),
        _lastUpdatedBy: actorUidFromConfirmation(responder),
      },
      { merge: true },
    );

    for (const cid of childIds) {
      const cs = await db().collection("events").doc(cid).get();
      if (!cs.exists) continue;
      const cd = cs.data() || {};
      if (cd.archived || cd.eventStatus === "cancelled") continue;
      batch.set(
        cs.ref,
        { ...dateUpdates, _lastUpdatedBy: actorUidFromConfirmation(responder) },
        { merge: true },
      );
      batch.set(
        db().doc(`events/${cid}/meta/main`),
        {
          pendingDateChange: FieldValue.delete(),
          _lastUpdatedBy: actorUidFromConfirmation(responder),
        },
        { merge: true },
      );
    }

    // Activity log on parent
    const details: Record<string, string> = {};
    if (parentPending.proposedValues.date) details.date = `${parentPending.previousValues.date || ""} → ${parentPending.proposedValues.date}`;
    if (parentPending.proposedValues.startTime) details.startTime = `${parentPending.previousValues.startTime || ""} → ${parentPending.proposedValues.startTime}`;
    if (parentPending.proposedValues.endTime) details.endTime = `${parentPending.previousValues.endTime || ""} → ${parentPending.proposedValues.endTime}`;

    const activityRef = db()
      .collection("events").doc(parentEventId)
      .collection("event_activity").doc();
    batch.set(activityRef, {
      type: "date_change_confirmed",
      by: responderName,
      details,
      ...(actorUidFromConfirmation(responder) ? { actorUid: actorUidFromConfirmation(responder) } : {}),
      timestamp: new Date().toISOString(),
      createdAt: FieldValue.serverTimestamp(),
    });

    await batch.commit();
    logger.info("Date change applied via relay", { parentEventId, eventId });
    return;
  }

  // Partial — write the updated parentPending to parent + sibling children
  const batch = db().batch();
  batch.set(
    parentMetaRef,
    { pendingDateChange: parentPending, _lastUpdatedBy: actorUidFromConfirmation(responder) },
    { merge: true },
  );
  for (const cid of childIds) {
    if (cid === eventId) continue; // skip originating child
    const cs = await db().collection("events").doc(cid).get();
    if (!cs.exists) continue;
    const cd = cs.data() || {};
    if (cd.archived || cd.eventStatus === "cancelled") continue;
    batch.set(
      db().doc(`events/${cid}/meta/main`),
      { pendingDateChange: parentPending, _lastUpdatedBy: actorUidFromConfirmation(responder) },
      { merge: true },
    );
  }

  // Activity log on parent
  const isDecline = changed.some(
    (pid) => parentPending.confirmations[pid]?.status === "declined",
  );
  const profileName = changed
    .map((pid) => parentPending.confirmations[pid]?.profileName)
    .filter(Boolean)
    .join(", ") || "Someone";
  const activityRef = db()
    .collection("events").doc(parentEventId)
    .collection("event_activity").doc();
  batch.set(activityRef, {
    type: isDecline ? "date_change_declined" : "date_change_confirmed",
    by: responderName,
    details: isDecline ? { declinedBy: profileName } : { confirmedBy: profileName },
    ...(actorUidFromConfirmation(responder) ? { actorUid: actorUidFromConfirmation(responder) } : {}),
    timestamp: new Date().toISOString(),
    createdAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();
  logger.info("Date change response relayed", { parentEventId, eventId, changed });
}

function actorUidFromConfirmation(c: DateChangeConfirmation | undefined): string {
  return c?.respondedBy || "";
}
