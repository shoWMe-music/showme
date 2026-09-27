import type { Database } from "@showme/db";
import { schema } from "@showme/db";
import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { conflict, forbidden } from "../errors";
import type { Transaction } from "./audit";

/**
 * DELETING AN EVENT — the one irreversible act in the product, and the rule that
 * makes it safe to offer.
 *
 * The product owner asked for it beside the archive: *"Users should be able to
 * move events into archive and then delete them from there if they wish."* The
 * archive half was already built; a delete route existed too, and that was the
 * problem rather than the answer. `DELETE /events/:id` was a bare hard delete
 * behind `event.delete` plus an optimistic lock, and it had two independent
 * defects:
 *
 *  1. **It destroyed other people's records.** Archiving is written on
 *     `event_participants.archived_at`, so it is one profile's filing — a venue
 *     putting a show away leaves the performer's copy alone. Deleting has no such
 *     seam: there is ONE `events` row, and twenty-three tables cascade off it. A
 *     venue pressing delete would take the performer's record of a night they
 *     played and were paid for, and there is no undo and no notification.
 *  2. **It did not work.** `budget_lines.collected_by` references
 *     `event_participants` with `NO ACTION`, and the cascade from `events` reaches
 *     `event_participants` before it reaches `budget_lines`, so deleting any event
 *     that had ever been budgeted raised
 *     `violates foreign key constraint "budget_lines_collected_by_event_participants_id_fk"`
 *     — a 500 whose body is `{"error":{"code":"internal"}}`. Measured, not
 *     inferred: a plain `DELETE FROM events` on an event with one revenue line
 *     naming its host fails exactly this way.
 *
 * ## What is deletable
 *
 * **THE LINE IS MONEY, NOT STATUS** (decisions #25.3). Every clause below is one
 * way the show could be somebody else's record, and each is checked separately so
 * the refusal can say which — but they do not all carry the same weight, and the
 * split is whether money exists:
 *
 *  - **You must be acting for the profile OPERATING the show** (`events.host_profile_id`).
 *    A co-promoter holds `operator_full` and therefore `event.delete`, but the
 *    show is not theirs to end. `story.md`: "operator" is a per-event role and the
 *    residual belongs to whoever bears *this* event's risk. **Absolute.**
 *  - **Nobody else may be on the bill** — *unless the show is cancelled.* With
 *    another party's participant row present there is normally no delete that is
 *    not also a delete of their copy. A cancellation is the announcement that
 *    answers that: #25.3 — *"the other-party and confirmed-agreement clauses give
 *    way here: cancelling is the notification."*
 *  - **No agreement may be confirmed or signed** — *unless the show is cancelled.*
 *    `confirmed` is every signatory's signature recorded against frozen terms
 *    (decisions #21), and a document is not thrown away while the night it
 *    documents is still supposed to happen. Once the night is called off, what
 *    the parties signed was an agreement to do something nobody is doing.
 *  - **No settlement may exist**, finalized or not. `assertNotFinalized` protects
 *    a finalized settlement because its figures are locked; this applies the same
 *    standard one step earlier, because a computed settlement is what the parties
 *    have been reading, and its `settlement_snapshots` / `budget_snapshots` are
 *    the planned-versus-actual record decisions #16.8 exists to preserve.
 *    **Absolute — no cancellation reaches back through money that moved.**
 *  - **No invoice may have been raised.** A money-out document (decisions #5).
 *    **Absolute**, for the same reason.
 *  - **It must already be cancelled, or archived** — by the host profile, whose
 *    act this is. Either way the irreversible step is never the first one:
 *    Ran's ladder is cancel-then-delete, and filing away is reversible from the
 *    toast that announces it. A cancel does NOT imply an archive and an archive
 *    does not imply a cancel; they mean different things, and either one is a
 *    deliberate first rung.
 *
 * The order is deliberate, and it is the order of the LIST ABOVE only in spirit:
 * the ABSOLUTE clauses are checked first — a settlement, then an invoice — then the
 * two a cancellation can satisfy, then the procedural one. So nobody is ever told
 * "cancel it first" about a show they will never be allowed to delete. Getting that
 * backwards is not a cosmetic bug: the advice a refusal gives is acted on, and
 * cancelling broadcasts to every party and cannot be withdrawn (QA4-1).
 *
 * What this costs, said plainly: a cancelled show with a performer on it and a
 * signed agreement CAN now be destroyed by its operator, and the performer's copy
 * goes with it. That is the call #25.3 makes, and the notification on the way out
 * (`routes/events-list.ts`) is the reason it is defensible — the performer is told
 * the show was cancelled when it is cancelled, and told it was deleted when it is
 * deleted. Money is the one thing no notice can make up for, which is why the
 * settlement and invoice clauses do not move.
 *
 * ## Hard, not soft
 *
 * Hard. **The archive already IS the soft delete** — reader-scoped, reversible,
 * with its own list filter — and a second, invisible "deleted" state would be one
 * more thing every query has to remember to exclude, for a row nothing could ever
 * reach again. And the guards above are what make the hard delete safe: by the
 * time one runs, every row that cascades belongs to the caller's own profile.
 */

/** One `event_participants` row's worth of "somebody else is on this". */
interface OtherParty {
  participantId: string;
  name: string | null;
}

export async function assertEventIsDeletable(
  database: Database,
  request: FastifyRequest,
  event: { id: string; hostProfileId: string; title: string; status: string },
): Promise<void> {
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");

  /**
   * The show is called off — so the two clauses that protect other people's copy
   * of a night that is still supposed to happen no longer have a night to protect
   * (decisions #25.3). The money clauses below are unaffected by it.
   */
  const cancelled = event.status === "cancelled";

  // 1. The profile operating the show, and no other.
  if (principal.actingProfileId !== event.hostProfileId) {
    throw forbidden(
      "Only the profile operating this show can delete it. Switch to it (X-Profile-Id) — or, if the show is not yours, archive it instead: that hides it from your own lists and touches nobody else's.",
    );
  }

  /*
   * THE ABSOLUTE CLAUSES RUN FIRST, and that ordering is a fix rather than a taste
   * (QA sweep run 4, QA4-1).
   *
   * They used to run fourth and fifth, behind the two clauses a cancellation can
   * satisfy — so on a show carrying money AND another party, the FIRST refusal was
   * the conditional one, and since #25.3 that refusal ends with "if the show is off,
   * CANCEL it: a cancelled show can then be deleted". The sweep followed that advice
   * on a concluded, settled, invoiced night: the show was cancelled, the performer
   * who had played it in May and been paid got a bell saying it was off, and the
   * delete was refused anyway by the settlement. The advice cost a broadcast that
   * cannot be taken back and bought nothing.
   *
   * The docstring above already stated the rule — "nobody is ever told 'cancel it
   * first' about a show they will never be allowed to delete" — and the code simply
   * did not match it. Money first; only then the clauses that have a way out.
   */
  // 2. A settlement, finalized or not. ABSOLUTE — a cancellation does not reach
  //    back through money that has been computed and read (decisions #25.3).
  const settlements = await database
    .select({ id: schema.settlements.id })
    .from(schema.settlements)
    .where(eq(schema.settlements.eventId, event.id));
  if (settlements.length > 0) {
    throw conflict(
      `"${event.title}" has a settlement on it, which is the financial record of the night — its figures, its snapshots and its planned-versus-actual. That cannot be thrown away. Leave the show archived.`,
    );
  }

  // 3. An invoice. Absolute, for the same reason.
  const invoices = await database
    .select({ id: schema.invoices.id })
    .from(schema.invoices)
    .where(eq(schema.invoices.eventId, event.id));
  if (invoices.length > 0) {
    throw conflict(
      `"${event.title}" has ${invoices.length === 1 ? "an invoice" : "invoices"} raised against it. An invoice is a money-out document and outlives the show. Leave it archived.`,
    );
  }

  // 4. Anybody else on the bill. Named, because the way out is to take each of
  //    them off it, which is a decision about a person rather than a row count —
  //    or, since #25.3, to cancel the show, which tells them instead of hiding it.
  const others: OtherParty[] = cancelled
    ? []
    : await database
        .select({ participantId: schema.eventParticipants.id, name: schema.profiles.name })
        .from(schema.eventParticipants)
        .leftJoin(schema.profiles, eq(schema.profiles.id, schema.eventParticipants.profileId))
        .where(
          and(
            eq(schema.eventParticipants.eventId, event.id),
            ne(schema.eventParticipants.profileId, event.hostProfileId),
          ),
        );
  if (others.length > 0) {
    const named = others.map((party) => party.name ?? party.participantId).join(", ");
    throw conflict(
      `"${event.title}" has ${others.length} other ${
        others.length === 1 ? "party" : "parties"
      } on it (${named}). Deleting the show would destroy their record of it too, and there is no per-party delete — archiving is the per-party act, and it hides only your own copy. If the show is off, CANCEL it: that tells them why, and a cancelled show can then be deleted. Otherwise take them off the bill first (DELETE /events/${event.id}/participants/:pid), or leave it archived.`,
    );
  }

  // 5. A signed agreement. Same reading of "signed" as the settlement gate
  //    (decisions #21): `confirmed` is every signature being in.
  const signed = cancelled
    ? []
    : await database
        .select({ id: schema.deals.id, name: schema.deals.name })
        .from(schema.deals)
        .where(
          and(
            eq(schema.deals.eventId, event.id),
            inArray(schema.deals.agreementStatus, ["confirmed", "signed"]),
          ),
        );
  if (signed.length > 0) {
    const named = signed.map((deal) => `"${deal.name}"`).join(", ");
    throw conflict(
      `${named} ${signed.length === 1 ? "is" : "are"} a signed agreement on "${event.title}", and a signed agreement is a record of what the parties agreed. Cancel the show if it is no longer happening — then it can be deleted. Otherwise leave it archived.`,
    );
  }

  // 6. Cancelled or archived first — a reversible, VISIBLE step before the
  //    irreversible one. A cancelled show has already satisfied it: that is the
  //    first rung of Ran's ladder, and unlike an archive it told everybody.
  if (cancelled) return;

  const [participant] = await database
    .select({ archivedAt: schema.eventParticipants.archivedAt })
    .from(schema.eventParticipants)
    .where(
      and(
        eq(schema.eventParticipants.eventId, event.id),
        eq(schema.eventParticipants.profileId, event.hostProfileId),
        isNotNull(schema.eventParticipants.archivedAt),
      ),
    );
  if (!participant) {
    throw conflict(
      `Cancel or archive "${event.title}" before deleting it. Deleting cannot be undone, so it is never the first step: cancelling tells everybody on the bill why the night is off, and filing it away is reversible from the toast that announces it.`,
    );
  }
}

/**
 * Tear the event's tree down IN ORDER, and report what went.
 *
 * The order is not decoration: it is the whole reason this exists rather than a
 * single `DELETE FROM events`. Twenty-one foreign keys point at
 * `event_participants` with `NO ACTION` (`budget_lines.collected_by`,
 * `event_messages.sender_participant_id`, `riders.owner_participant_id`,
 * `tasks.assignee_participant_id`, …), and the cascade from `events` does not
 * promise to reach those tables before it reaches the participants they name.
 * Measured: it does not — a plain cascade raises a foreign-key violation on any
 * event that has ever been budgeted. So everything that names a participant is
 * removed first, then the participants, and only then the event, whose remaining
 * children (notifications, activity, invitations, RSVPs, calendar mirrors,
 * shares) cascade cleanly because none of them name a participant.
 *
 * The counts are the audit's answer to *what was destroyed*. A trail that records
 * only "the event went" describes the one row somebody could already see was
 * missing, and says nothing about the eight tables that went with it.
 */
export async function deleteEventTree(
  tx: Transaction,
  eventId: string,
): Promise<Record<string, number>> {
  const destroyed: Record<string, number> = {};
  const record = async (name: string, run: () => Promise<{ length: number }>) => {
    const rows = await run();
    if (rows.length > 0) destroyed[name] = rows.length;
  };

  const budgetIds = (
    await tx
      .select({ id: schema.budgets.id })
      .from(schema.budgets)
      .where(eq(schema.budgets.eventId, eventId))
  ).map((budget) => budget.id);
  const dealIds = (
    await tx
      .select({ id: schema.deals.id })
      .from(schema.deals)
      .where(eq(schema.deals.eventId, eventId))
  ).map((deal) => deal.id);
  const shareIds = (
    await tx
      .select({ id: schema.shares.id })
      .from(schema.shares)
      .where(eq(schema.shares.eventId, eventId))
  ).map((share) => share.id);

  // The money, innermost first. All of these are proven empty by
  // `assertEventIsDeletable` for a settlement; the sweep is written to be correct
  // without depending on that, because a guard and a teardown that disagree is how
  // the 500 above came to exist in the first place.
  await record("settlementTransfers", () =>
    tx
      .delete(schema.settlementTransfers)
      .where(eq(schema.settlementTransfers.eventId, eventId))
      .returning(),
  );
  await record("settlementLines", () =>
    tx
      .delete(schema.settlementLines)
      .where(eq(schema.settlementLines.eventId, eventId))
      .returning(),
  );
  await record("settlementComments", () =>
    tx
      .delete(schema.settlementComments)
      .where(eq(schema.settlementComments.eventId, eventId))
      .returning(),
  );
  await record("settlementApprovals", () =>
    tx
      .delete(schema.settlementApprovals)
      .where(eq(schema.settlementApprovals.eventId, eventId))
      .returning(),
  );
  await record("settlementSnapshots", () =>
    tx
      .delete(schema.settlementSnapshots)
      .where(eq(schema.settlementSnapshots.eventId, eventId))
      .returning(),
  );
  await record("budgetSnapshots", () =>
    tx
      .delete(schema.budgetSnapshots)
      .where(eq(schema.budgetSnapshots.eventId, eventId))
      .returning(),
  );
  await record("settlements", () =>
    tx.delete(schema.settlements).where(eq(schema.settlements.eventId, eventId)).returning(),
  );

  if (budgetIds.length > 0) {
    await record("budgetLines", () =>
      tx
        .delete(schema.budgetLines)
        .where(inArray(schema.budgetLines.budgetId, budgetIds))
        .returning(),
    );
  }
  await record("budgets", () =>
    tx.delete(schema.budgets).where(eq(schema.budgets.eventId, eventId)).returning(),
  );

  if (dealIds.length > 0) {
    await record("dealParties", () =>
      tx.delete(schema.dealParties).where(inArray(schema.dealParties.dealId, dealIds)).returning(),
    );
  }
  await record("deals", () =>
    tx.delete(schema.deals).where(eq(schema.deals.eventId, eventId)).returning(),
  );

  // The content, all of which can name a participant.
  await record("eventMessages", () =>
    tx.delete(schema.eventMessages).where(eq(schema.eventMessages.eventId, eventId)).returning(),
  );
  await record("riders", () =>
    tx.delete(schema.riders).where(eq(schema.riders.eventId, eventId)).returning(),
  );
  await record("scheduleItems", () =>
    tx.delete(schema.scheduleItems).where(eq(schema.scheduleItems.eventId, eventId)).returning(),
  );
  await record("tasks", () =>
    tx.delete(schema.tasks).where(eq(schema.tasks.eventId, eventId)).returning(),
  );
  await record("setlists", () =>
    tx.delete(schema.setlists).where(eq(schema.setlists.eventId, eventId)).returning(),
  );
  await record("performanceReports", () =>
    tx
      .delete(schema.performanceReports)
      .where(eq(schema.performanceReports.eventId, eventId))
      .returning(),
  );
  if (shareIds.length > 0) {
    await record("shareRecipients", () =>
      tx
        .delete(schema.shareRecipients)
        .where(inArray(schema.shareRecipients.shareId, shareIds))
        .returning(),
    );
  }
  await record("shares", () =>
    tx.delete(schema.shares).where(eq(schema.shares.eventId, eventId)).returning(),
  );

  await record("eventParticipants", () =>
    tx
      .delete(schema.eventParticipants)
      .where(eq(schema.eventParticipants.eventId, eventId))
      .returning(),
  );

  return destroyed;
}
