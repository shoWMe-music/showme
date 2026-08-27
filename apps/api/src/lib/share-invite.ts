import { randomBytes } from "node:crypto";
import { schema } from "@showme/db";
import type { FastifyRequest } from "fastify";
import { writeActivity } from "./activity";
import { writeAudit } from "./audit";
import { renderSettlementReviewEmail } from "./email-templates";
import { loadEventSummary } from "./event-summary";
import { normalizeEmail } from "./share-crypto";
import { findRecipientParty } from "./share-scope";

/**
 * ISSUING A SHARE AND PUTTING IT IN SOMEBODY'S INBOX — one path, two callers.
 *
 * `POST /events/:id/shares` (the Share & Export dialog) and the settlement's own
 * "send this to somebody who is not on shoWMe" both need exactly this: mint a
 * protected token, record who it is addressed to, link each address to the party
 * it already belongs to, and mail the link out. Written twice they would drift on
 * the detail that matters most — which capabilities travel, and whether the
 * recipient is bound to a participant — so it is written once here and the routes
 * choose only the scope.
 *
 * **The link is now actually sent.** Creating a share used to return a token and
 * stop, leaving the operator to copy it into their own mail client, while the
 * dialog told them "every link is addressed to an email and opened with a
 * one-time code". Addressed to, and never sent to. The one email the system did
 * send was the verification code — which only helps somebody who already has the
 * link they are verifying against.
 *
 * Sending is BEST EFFORT and post-commit, the same contract every other
 * notification in this codebase follows: a mail failure must never roll back the
 * share, because the token is still valid and the operator can copy it. The
 * caller decides what to tell the user by reading `delivered`.
 */

export interface ShareRecipientInput {
  email: string;
  name?: string;
  /**
   * Bind this address to a KNOWN participant, skipping the email→party lookup.
   *
   * The settlement's invitation uses it: the operator has picked a party off the
   * roster and typed an address for them, so the party is chosen by the person
   * who knows, not inferred from a mailbox they may never have used here. Left
   * unset (the Share & Export dialog), the address is matched against the event's
   * participants exactly as before.
   */
  participantId?: string;
}

export interface CreatedShare {
  id: string;
  token: string;
  recipients: { email: string; name: string | null; participantId: string | null }[];
}

/**
 * Mint the share and its recipient rows, inside the caller's transaction.
 *
 * The party link is resolved BEFORE the insert so it is part of the record from
 * the start — a recipient row that learns who it belongs to later is a row that
 * spent time being unable to answer the only question asked of it.
 */
export async function createShareWithRecipients(
  request: FastifyRequest,
  input: {
    eventId: string;
    capabilities: string[];
    access: "public" | "protected";
    targetKind?: string;
    targetId?: string;
    expiresAt?: Date;
    recipients: readonly ShareRecipientInput[];
    ownerUserId: string;
    ownerProfileId: string;
    /** The capability the caller was authorized on, for the audit row. */
    capability: "event.edit" | "settlement.edit";
  },
): Promise<CreatedShare> {
  const { database } = request.server;

  const linked = new Map<string, string | null>();
  for (const recipient of input.recipients) {
    const email = normalizeEmail(recipient.email);
    if (linked.has(email)) continue;
    if (recipient.participantId) {
      linked.set(email, recipient.participantId);
      continue;
    }
    const party = await findRecipientParty(database, input.eventId, email);
    linked.set(email, party?.participantId ?? null);
  }

  const token = randomBytes(24).toString("hex");
  return database.transaction(async (tx) => {
    const [share] = await tx
      .insert(schema.shares)
      .values({
        token,
        eventId: input.eventId,
        targetKind: input.targetKind,
        targetId: input.targetId,
        capabilities: input.capabilities,
        access: input.access,
        ownerUserId: input.ownerUserId,
        ownerProfileId: input.ownerProfileId,
        expiresAt: input.expiresAt,
      })
      .returning();
    if (!share) throw new Error("share create failed");

    const seen = new Set<string>();
    const rows: CreatedShare["recipients"] = [];
    for (const recipient of input.recipients) {
      const email = normalizeEmail(recipient.email);
      if (seen.has(email)) continue;
      seen.add(email);
      rows.push({
        email,
        name: recipient.name ?? null,
        participantId: linked.get(email) ?? null,
      });
    }
    if (rows.length > 0) {
      await tx.insert(schema.shareRecipients).values(
        rows.map((row) => ({
          shareId: share.id,
          email: row.email,
          name: row.name ?? undefined,
          linkedParticipantId: row.participantId,
        })),
      );
    }

    await writeAudit(tx, request, {
      capability: input.capability,
      action: "share.create",
      targetKind: "share",
      targetId: share.id,
      eventId: input.eventId,
      after: {
        access: share.access,
        targetKind: share.targetKind,
        capabilities: input.capabilities,
      },
    });
    // Handing event data to someone OUTSIDE the platform is the operator's
    // decision and the operator's record. The token is never summarised: a feed
    // row is not a way to hand the link to a participant who was not given it.
    await writeActivity(tx, request, {
      eventId: input.eventId,
      type: "share.created",
      targetKind: "share",
      targetId: share.id,
      summary: {
        access: share.access,
        sharedKind: share.targetKind,
        recipientCount: rows.length,
      },
    });

    return { id: share.id, token: share.token, recipients: rows };
  });
}

/**
 * Mail the share link to everyone it was addressed to.
 *
 * Returns the addresses that were actually handed to the mail sink, so the route
 * can report "sent to two of three" rather than claiming delivery it did not get.
 * A per-recipient failure is logged and skipped: one bad address must not stop
 * the other invitations, and the share itself is already committed either way.
 */
export async function sendShareInvitations(
  request: FastifyRequest,
  input: {
    eventId: string;
    token: string;
    recipients: readonly { email: string; name: string | null }[];
    senderName?: string | null;
  },
): Promise<string[]> {
  if (input.recipients.length === 0) return [];
  const event = await loadEventSummary(request.server.database, input.eventId);
  if (!event) return [];

  const delivered: string[] = [];
  for (const recipient of input.recipients) {
    try {
      await request.server.emailSink.sendEmail({
        to: recipient.email,
        ...renderSettlementReviewEmail({
          recipientName: recipient.name,
          event,
          senderName: input.senderName,
          shareToken: input.token,
        }),
      });
      delivered.push(recipient.email);
    } catch (error) {
      request.log.error(
        { error, eventId: input.eventId },
        "share invitation email failed for one recipient",
      );
    }
  }
  return delivered;
}
