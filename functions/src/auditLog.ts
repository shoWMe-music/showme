import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";

const db = () => admin.firestore();

/**
 * Minimal GDPR-flavored audit log for the freemium growth-loop flows
 * (Flow A collab invites + Flow B performer offers).
 *
 * Why this exists: GDPR requires that we can answer "what data have we
 * processed about person X, when, and why" — especially for cold outreach
 * where the recipient hasn't opted in. Per-record `_lastUpdatedBy`
 * timestamps cover edits but miss creation, acceptance, decline and
 * flagging. This central log captures those state transitions so a future
 * data-subject-access-request can be answered with a single query keyed by
 * the `target.id` (the affected profile / request / code).
 *
 * What we do NOT log here (deliberate scope):
 *   - email opens / reads (would require tracking pixels — privacy-hostile)
 *   - free-form content (subject, body) — the originating doc already has
 *     it, no need to duplicate sensitive payloads
 *   - retention sweeps — added when we have a clear policy. For now the
 *     log grows monotonically; a Cloud Scheduler reaper job is the
 *     intended cleanup path.
 *
 * Reads: admin-only via Firestore rule (see firestore.rules). Writes are
 * all server-only via Admin SDK — there is no client-facing write path.
 */

export type AuditAction =
  | "offer_created"
  | "invite_created"
  | "invite_claimed"
  | "invite_declined"
  | "invite_expired"
  | "flag_raised";

export type AuditTargetKind =
  | "profile"
  | "bookingRequest"
  | "invitationCode"
  | "event";

export interface AuditWriteOpts {
  /** Who took the action. uid is the auth uid; profileId is the acting profile when relevant. */
  actor: { uid: string; profileId?: string | null };
  /** What the action was performed on. */
  target: { kind: AuditTargetKind; id: string };
  action: AuditAction;
  /** Optional pointer back to the originating context (request, code, event). */
  context?: { kind: string; id: string; eventId?: string };
}

/**
 * Best-effort write — never throws. A failed audit log entry should not
 * block the underlying business action. We log to Cloud Logging so the
 * gap is visible in incident review.
 */
export async function writeAudit(opts: AuditWriteOpts): Promise<void> {
  try {
    await db().collection("auditLog").doc().set({
      action: opts.action,
      actorUid: opts.actor.uid,
      actorProfileId: opts.actor.profileId ?? null,
      targetKind: opts.target.kind,
      targetId: opts.target.id,
      contextKind: opts.context?.kind ?? null,
      contextId: opts.context?.id ?? null,
      contextEventId: opts.context?.eventId ?? null,
      at: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    logger.warn("audit write failed", {
      action: opts.action,
      target: opts.target,
      err: String(err),
    });
  }
}
