import { schema } from "@showme/db";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { conflict } from "../errors";
import type { Transaction } from "./audit";

/** A transfer the engine says should exist, in the event's base currency. */
export interface DesiredTransfer {
  fromParticipant: string;
  toParticipant: string;
  amount: bigint;
  currency: string;
  /** Set → a private agent↔performer commission transfer (decisions #14). */
  representationId?: string | null;
}

/**
 * States that mean a human recorded something about real money. Rewriting one of
 * these is a lost update, not a recompute (decisions #8).
 */
const RECORDED_STATES: ReadonlySet<string> = new Set(["paid", "handled"]);

type TransferRow = typeof schema.settlementTransfers.$inferSelect;

/** Identity of a transfer: the pair it moves money between, within its scope. */
function transferKey(transfer: {
  fromParticipant: string;
  toParticipant: string;
  representationId?: string | null;
}): string {
  return `${transfer.representationId ?? ""}:${transfer.fromParticipant}:${transfer.toParticipant}`;
}

/**
 * Bring one scope of an event's stored transfers in line with a freshly computed
 * set WITHOUT destroying recorded payment state (audit A-08).
 *
 * Recompute used to `DELETE` every transfer for the event and re-`INSERT` the new
 * ones. On identical inputs that silently reverted a transfer somebody had marked
 * `paid` back to `owed` at version 1 — exactly the lost update decisions.md #8
 * says the optimistic lock exists to prevent ("a stale write is rejected… never a
 * silent overwrite"). It also churned the transfer ids that audit rows and clients
 * hold.
 *
 * So a transfer is matched by WHO it moves money between, and:
 *   - unchanged amount        → left completely alone (state, version and id survive)
 *   - changed, still `owed`   → amount updated, version bumped
 *   - changed, already `paid`/`handled` → **409**, never rewritten underneath the
 *     person who recorded the payment. The way out is explicit: put the transfer
 *     back to `owed` (a recorded, audited act) and recompute.
 *   - no longer computed, `owed`         → deleted
 *   - no longer computed, `paid`/`handled` → **409**, same reason.
 *
 * `scope` partitions the event's transfers into the ordinary ones (`event`) and
 * the private agent↔performer commissions (`representation`, decisions #14), which
 * are derived by a different producer and must not delete each other's rows.
 */
export async function reconcileTransfers(
  tx: Transaction,
  eventId: string,
  desired: DesiredTransfer[],
  scope: "event" | "representation",
): Promise<void> {
  const existing = await tx
    .select()
    .from(schema.settlementTransfers)
    .where(
      and(
        eq(schema.settlementTransfers.eventId, eventId),
        scope === "event"
          ? isNull(schema.settlementTransfers.representationId)
          : isNotNull(schema.settlementTransfers.representationId),
      ),
    );

  const unmatched = new Map<string, TransferRow>(existing.map((row) => [transferKey(row), row]));

  for (const want of desired) {
    const key = transferKey(want);
    const row = unmatched.get(key);
    if (!row) {
      await tx.insert(schema.settlementTransfers).values({
        eventId,
        fromParticipant: want.fromParticipant,
        toParticipant: want.toParticipant,
        amount: want.amount,
        currency: want.currency,
        representationId: want.representationId ?? null,
      });
      continue;
    }
    unmatched.delete(key);

    const unchanged =
      row.amount === want.amount && (row.currency ?? want.currency) === want.currency;
    if (unchanged) continue;
    if (RECORDED_STATES.has(row.state)) {
      throw conflict(
        `Transfer ${row.id} is already marked ${row.state}; recomputing would rewrite ${row.amount} to ${want.amount}. Set it back to "owed" first if the figures really changed.`,
      );
    }
    await tx
      .update(schema.settlementTransfers)
      .set({ amount: want.amount, currency: want.currency, version: row.version + 1 })
      .where(eq(schema.settlementTransfers.id, row.id));
  }

  for (const row of unmatched.values()) {
    if (RECORDED_STATES.has(row.state)) {
      throw conflict(
        `Transfer ${row.id} is already marked ${row.state}; recomputing would delete it. Set it back to "owed" first if the figures really changed.`,
      );
    }
    await tx.delete(schema.settlementTransfers).where(eq(schema.settlementTransfers.id, row.id));
  }
}
