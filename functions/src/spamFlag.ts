import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { SPAM_FLAG_SUSPEND_THRESHOLD } from "./plans";
import { writeAudit } from "./auditLog";

const db = () => admin.firestore();

// Distinct-venue spam flags are aged out after this many days when we
// recompute the count.
const SPAM_FLAG_AGE_DAYS = 90;

interface FlagSenderAsSpamData {
  /** The performer profile being flagged (sender of the collab invite). */
  performerProfileId: string;
  /** Identifier of the originating invite or offer — for the audit trail. */
  context: {
    kind: "venue_handoff" | "performer_offer";
    /** invitationCode for venue_handoff, requestId for performer_offer. */
    id: string;
    /** Event the flag relates to, when applicable. */
    eventId?: string;
  };
  /** Profile id the caller is reporting from (their venue profile). */
  reporterProfileId: string;
}

interface FlagSenderAsSpamResult {
  ok: true;
  distinctFlagsLast90d: number;
  suspended: boolean;
}

/**
 * Venue-side action that flags a collaborate invite / cold offer as spam.
 *
 * Spec: 3 distinct venues flagging the same performer within a rolling 90
 * days triggers automatic admin review AND temporary suspension of
 * performer-initiated collaborate invites (offer flow stays open).
 *
 * Idempotent per reporter: if the same venue flags twice, the second call
 * is a no-op for the counter. This is what makes "distinct venues" the
 * actual measure.
 */
export const flagSenderAsSpam = onCall<
  FlagSenderAsSpamData,
  Promise<FlagSenderAsSpamResult>
>(
  { region: "europe-west1" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in to flag.");

    const data = request.data ?? ({} as FlagSenderAsSpamData);
    const performerProfileId = (data.performerProfileId ?? "").trim();
    const reporterProfileId = (data.reporterProfileId ?? "").trim();
    if (!performerProfileId || !reporterProfileId) {
      throw new HttpsError(
        "invalid-argument",
        "performerProfileId and reporterProfileId are required.",
      );
    }
    if (performerProfileId === reporterProfileId) {
      throw new HttpsError(
        "invalid-argument",
        "Cannot flag your own profile.",
      );
    }
    const ctx = data.context ?? null;
    if (!ctx || (ctx.kind !== "venue_handoff" && ctx.kind !== "performer_offer")) {
      throw new HttpsError("invalid-argument", "context.kind is required.");
    }
    if (!ctx.id) {
      throw new HttpsError("invalid-argument", "context.id is required.");
    }

    // Verify the caller is an owner/admin of reporterProfileId — otherwise
    // anyone could pretend to be a venue and flag arbitrary performers.
    const reporterSnap = await db().collection("profiles").doc(reporterProfileId).get();
    if (!reporterSnap.exists) {
      throw new HttpsError("not-found", "Reporting profile not found.");
    }
    const reporter = reporterSnap.data() ?? {};
    const isOwner = reporter.owner_uid === uid;
    if (!isOwner) {
      const memberSnap = await db()
        .collection("profiles")
        .doc(reporterProfileId)
        .collection("members")
        .doc(uid)
        .get();
      const role = String(memberSnap.exists ? memberSnap.data()?.role : "");
      if (!(role === "owner" || role === "admin")) {
        throw new HttpsError(
          "permission-denied",
          "Only owners and admins of the reporting profile can flag spam.",
        );
      }
    }

    // Idempotent write keyed by reporter — re-flagging is a no-op for the
    // counter. Store under the performer's flags subcollection so the
    // suspension check can range-scan by recency.
    const flagId = `${ctx.kind}:${reporterProfileId}`;
    const flagRef = db()
      .collection("profiles")
      .doc(performerProfileId)
      .collection("spamFlags")
      .doc(flagId);
    const existingFlag = await flagRef.get();
    if (!existingFlag.exists) {
      await flagRef.set({
        kind: ctx.kind,
        contextId: ctx.id,
        eventId: ctx.eventId ?? null,
        reporterProfileId,
        reporterUid: uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    // Recount distinct flags in the rolling window. We re-read every time
    // — cheap (single subcollection scan) and avoids drift.
    const cutoffMs = Date.now() - SPAM_FLAG_AGE_DAYS * 24 * 60 * 60 * 1000;
    const allFlags = await db()
      .collection("profiles")
      .doc(performerProfileId)
      .collection("spamFlags")
      .get();
    const distinctReporters = new Set<string>();
    for (const d of allFlags.docs) {
      const f = d.data() ?? {};
      const created = (f.createdAt as FirebaseFirestore.Timestamp | undefined)?.toMillis();
      if (created && created < cutoffMs) continue;
      const reporter = typeof f.reporterProfileId === "string" ? f.reporterProfileId : "";
      if (reporter) distinctReporters.add(reporter);
    }
    const distinctFlagsLast90d = distinctReporters.size;
    const shouldSuspend = distinctFlagsLast90d >= SPAM_FLAG_SUSPEND_THRESHOLD;

    // Sync the counter + suspension on the plan doc. Treat plan absence as
    // OK — the count still gets written when the plan is later created.
    await db().collection("plans").doc(performerProfileId).set(
      {
        spamFlagsLast90d: distinctFlagsLast90d,
        collabInviteSuspended: shouldSuspend,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    // Notify the sender (best-effort fan-out to their profile members).
    try {
      await notifyPerformerOfFlag(performerProfileId, reporter.name as string, ctx);
    } catch (err) {
      logger.warn("flag sender notify failed", { performerProfileId, err: String(err) });
    }

    if (shouldSuspend && !existingFlag.exists) {
      // Only write the admin alert on the transition (new flag pushed us
      // over the threshold), not on every flag thereafter.
      try {
        await writeAdminAlert(performerProfileId, distinctFlagsLast90d);
      } catch (err) {
        logger.warn("admin alert write failed", { err: String(err) });
      }
    }

    // GDPR audit trail — only logged on first-flag-per-reporter so the
    // counter and the log stay in sync. A repeat flag from the same venue
    // is a UI-level no-op and shouldn't pollute the audit history.
    if (!existingFlag.exists) {
      await writeAudit({
        actor: { uid, profileId: reporterProfileId },
        target: { kind: "profile", id: performerProfileId },
        action: "flag_raised",
        context: {
          kind: ctx.kind,
          id: ctx.id,
          ...(ctx.eventId ? { eventId: ctx.eventId } : {}),
        },
      });
    }

    return {
      ok: true,
      distinctFlagsLast90d,
      suspended: shouldSuspend,
    };
  },
);

async function notifyPerformerOfFlag(
  performerProfileId: string,
  reporterName: string,
  ctx: FlagSenderAsSpamData["context"],
): Promise<void> {
  const members = await db()
    .collection("profiles")
    .doc(performerProfileId)
    .collection("members")
    .get();
  const safeReporter = reporterName || "A venue";
  const writes: Array<Promise<unknown>> = [];
  for (const m of members.docs) {
    const data = m.data() ?? {};
    const uid = typeof data.user_uid === "string" ? data.user_uid : m.id;
    if (!uid) continue;
    writes.push(
      db().collection("users").doc(uid).collection("notifications").doc().set({
        type: "venue_handoff_cancelled",
        title: "Your invite was flagged",
        body: `${safeReporter} flagged a ${ctx.kind === "venue_handoff" ? "collaborate invite" : "performer offer"} from your profile as spam (no prior relationship). Repeated flags suspend the collaborate-invite flow.`,
        actorName: safeReporter,
        actorUid: "",
        read: false,
        createdAt: new Date().toISOString(),
        link: ctx.eventId ? `/events/${ctx.eventId}` : "/sent-requests",
        metadata: { contextKind: ctx.kind, contextId: ctx.id },
      }),
    );
  }
  await Promise.all(writes);
}

async function writeAdminAlert(performerProfileId: string, count: number): Promise<void> {
  // Top-level collection keyed by performerProfileId so admin tooling can
  // surface "performers needing review" with a single query. Idempotent
  // overwrites — repeating the alert doesn't fan out duplicate emails (we
  // don't email yet).
  await db().collection("adminAlerts").doc(`spam:${performerProfileId}`).set({
    kind: "spam_threshold_crossed",
    performerProfileId,
    flagCount: count,
    suspended: true,
    createdAt: FieldValue.serverTimestamp(),
    resolved: false,
  });
}
