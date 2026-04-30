import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {
  onDocumentWritten,
  onDocumentCreated,
} from "firebase-functions/v2/firestore";

const db = () => admin.firestore();

// ── Helpers ──────────────────────────────────────────────────────────────────

interface NotificationPayload {
  type: string;
  title: string;
  body: string;
  eventId?: string;
  eventName?: string;
  actorName: string;
  actorUid: string;
  link?: string;
  metadata?: Record<string, string>;
}

/**
 * Write a notification doc to every profile that has access to this event,
 * EXCEPT the profile(s) the actor belongs to (don't notify yourself).
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
  const profileIds: string[] = Array.isArray(event.accessProfileIds)
    ? event.accessProfileIds
    : [];

  if (profileIds.length === 0) return;

  // Find which profiles the actor is a member of (to exclude). Skip when we
  // don't know the actor — Firestore .doc("") throws and would crash the
  // entire trigger, blocking notifications for everyone else.
  const actorProfiles = new Set<string>();
  if (actorUid) {
    await Promise.all(
      profileIds.map(async (pid) => {
        const memberSnap = await db()
          .collection("profiles").doc(pid)
          .collection("members").doc(actorUid)
          .get();
        if (memberSnap.exists) actorProfiles.add(pid);
      }),
    );
  }

  // Get actor display name
  let actorName = "Someone";
  try {
    const userRecord = await admin.auth().getUser(actorUid);
    actorName = userRecord.displayName || userRecord.email || "Someone";
  } catch {
    // user not found
  }

  const eventName = (typeof event.name === "string" && event.name) || "";
  const now = new Date().toISOString();

  const batch = db().batch();
  let count = 0;

  const excludeSet = new Set(excludeProfileIds || []);

  for (const pid of profileIds) {
    if (actorProfiles.has(pid)) continue; // don't notify the actor's own profiles
    if (excludeSet.has(pid)) continue; // explicitly excluded

    const ref = db()
      .collection("profiles").doc(pid)
      .collection("notifications").doc();

    batch.set(ref, {
      type: payload.type,
      title: payload.title,
      body: payload.body,
      eventId,
      eventName: payload.eventName || eventName,
      actorName,
      actorUid,
      profileId: pid,
      read: false,
      createdAt: now,
      link: payload.link || `/events/${eventId}`,
      metadata: payload.metadata || {},
    });
    count++;
  }

  if (count > 0) {
    await batch.commit();
    logger.info(`Created ${count} notifications for event ${eventId}`, { type: payload.type });
  }
}

/**
 * Write a notification to a specific profile.
 */
async function notifyProfile(
  profileId: string,
  payload: NotificationPayload,
): Promise<void> {
  await db()
    .collection("profiles").doc(profileId)
    .collection("notifications").doc()
    .set({
      ...payload,
      profileId,
      read: false,
      createdAt: new Date().toISOString(),
      metadata: payload.metadata || {},
    });
}

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
        });

        // Also notify other profiles (not the performer, they already got the invitation)
        await notifyEventProfiles(eventId, actorUid, {
          type: "event_status_changed",
          title: `Event status: ${after.eventStatus}`,
          body: `"${after.name || "Event"}" status changed from ${before.eventStatus} to ${after.eventStatus}`,
          eventName: after.name,
        }, [performerPid]);
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
        metadata: Object.fromEntries(changes.map((f) => [f, String(after[f] ?? "")])),
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

    const eventId = event.params.eventId;
    const actorUid: string = after._lastUpdatedBy || "";

    await notifyEventProfiles(eventId, actorUid, {
      type: "deal_updated",
      title: "Deal updated",
      body: before
        ? `Deal structure has been modified`
        : `Deal structure has been added`,
      link: `/events/${eventId}`,
    });
  },
);

// ── Revenue changes ──────────────────────────────────────────────────────────

export const onRevenueUpdated = onDocumentWritten(
  { document: "events/{eventId}/revenue/main", region: "europe-west1" },
  async (event) => {
    if (!event.data) return;
    const after = event.data.after.data();
    if (!after) return;

    const eventId = event.params.eventId;
    const actorUid: string = after._lastUpdatedBy || "";

    await notifyEventProfiles(eventId, actorUid, {
      type: "revenue_updated",
      title: "Revenue updated",
      body: "Ticket revenue figures have been updated",
      link: `/events/${eventId}`,
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

    const eventId = event.params.eventId;
    const actorUid: string = after._lastUpdatedBy || "";

    if (before?.status !== after.status) {
      await notifyEventProfiles(eventId, actorUid, {
        type: "settlement_status_changed",
        title: `Settlement: ${after.status}`,
        body: `Settlement status changed to "${after.status}"`,
        link: `/events/${eventId}`,
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
      await notifyEventProfiles(eventId, actorUid, {
        type: "settlement_comment_added",
        title: "New settlement comment",
        body: `${by} commented on the settlement`,
        metadata: data.details as Record<string, string> | undefined,
      });
    }

    if (type === "revision_added") {
      await notifyEventProfiles(eventId, actorUid, {
        type: "settlement_revision_added",
        title: "Settlement revision",
        body: `${by} submitted a settlement revision`,
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
        });
        break;
      case "agreement_updated":
        await notifyEventProfiles(eventId, actorUid, {
          type: "agreement_updated",
          title: "Agreement updated",
          body: `${by} updated an agreement for "${eventName}"`,
          eventName,
        });
        break;
      case "crew_updated":
        await notifyEventProfiles(eventId, actorUid, {
          type: "crew_updated",
          title: "Crew updated",
          body: `${by} updated crew for "${eventName}"`,
          eventName,
        });
        break;
      case "schedule_updated":
        await notifyEventProfiles(eventId, actorUid, {
          type: "schedule_updated",
          title: "Schedule updated",
          body: `${by} updated the schedule for "${eventName}"`,
          eventName,
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
      link: `/events/${eventId}`,
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
      let actorName = "Someone";
      try {
        const ownerUid = eventData?.owner_uid || eventData?.hostProfileId || "";
        if (ownerUid) {
          const userRecord = await admin.auth().getUser(ownerUid);
          actorName = userRecord.displayName || userRecord.email || "Someone";
        }
      } catch { /* */ }

      await notifyProfile(profileId, {
        type: "collaborator_invited",
        title: "Collaborator invite",
        body: `${actorName} invited you to collaborate on "${eventName}"`,
        actorName,
        actorUid: eventData?.owner_uid || "",
        eventId,
        eventName,
        link: `/events/${eventId}`,
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

    const profileId = data.profileId as string | undefined;
    if (!profileId) return;

    const artistName = (data.artistName as string) || "An artist";
    const requestDate = (data.preferredDate as string) || "";

    await notifyProfile(profileId, {
      type: "booking_request_received",
      title: "New booking request",
      body: `${artistName} requested a booking${requestDate ? ` for ${requestDate}` : ""}`,
      actorName: artistName,
      actorUid: (data.submittedByUid as string) || "",
      link: "/requests",
    });
  },
);

export const onBookingRequestUpdated = onDocumentWritten(
  { document: "inboundBookingRequests/{requestId}", region: "europe-west1" },
  async (event) => {
    if (!event.data) return;
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (!before || !after) return;

    if (before.status !== after.status && (after.status === "accepted" || after.status === "declined")) {
      // Notify the requesting artist's profile if available
      const artistProfileId = after.artistProfileId as string | undefined;
      if (!artistProfileId) return;

      const venueName = (after.profileName as string) || "The venue";

      await notifyProfile(artistProfileId, {
        type: "booking_request_responded",
        title: `Booking ${after.status}`,
        body: `${venueName} ${after.status} your booking request`,
        actorName: venueName,
        actorUid: (after.respondedByUid as string) || "",
        link: "/requests",
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
          link: `/events/${eventId}?tab=agreement`,
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
        link: `/events/${eventId}`,
      });
    }
  },
);
