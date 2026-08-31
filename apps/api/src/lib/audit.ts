import type { Database } from "@showme/db";
import { schema } from "@showme/db";
import type { Capability } from "@showme/shared";
import type { FastifyRequest } from "fastify";

/** A drizzle transaction handle (the arg drizzle passes to `db.transaction`). */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface AuditEntry {
  /**
   * The capability the actor exercised, or `null` for an action that has none.
   * Platform-admin routes are the `null` case by design: authority there is the
   * `users.is_admin` flag and there is NO capability for platform admin
   * (`routes/admin.ts`), so naming one in the trail would record a check that was
   * never made. The column is nullable for exactly this.
   */
  capability: Capability | null;
  action: string; // e.g. "event.update", "deal.create"
  targetKind: string;
  /** The uuid of the target row; omit for a target with no uuid (e.g. a text-id user). */
  targetId?: string;
  eventId?: string;
  before?: unknown;
  after?: unknown;
  /**
   * Whose act this row records. Defaults to the caller, which is right for every
   * row describing something the caller was authorized to do.
   *
   * `"system"` writes NO actor, and exists for a row on a resource the caller has
   * no authority over at all — a rival operator's hold released because the room
   * got taken (`routes/holds.ts`). One physical room on one night is ONE queue, so
   * a confirmation really does end every other pencil on that date; but the actor
   * columns are this table's answer to "who did this", and naming the confirming
   * side there would record that they cancelled somebody else's hold, which is the
   * one thing they may never do. The event happened; nobody did it to them.
   */
  actor?: "caller" | "system";
}

/**
 * Make a value safe for the `changes` jsonb column — money columns are `bigint`,
 * which can't be JSON-serialized, so every bigint is stringified (money.md's
 * string boundary). Routes can pass raw rows to `writeAudit` without pre-serializing.
 */
function jsonSafe(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, inner) => (typeof inner === "bigint" ? inner.toString() : inner)),
  );
}

/**
 * Write the forensic `audit_log` row for a mutation, IN THE SAME TRANSACTION as
 * the change (decisions #2) — an unlogged mutation is impossible by construction.
 * The actor is taken from the request principal, unless the entry says `system`.
 */
export async function writeAudit(
  tx: Transaction,
  request: FastifyRequest,
  entry: AuditEntry,
): Promise<void> {
  if (entry.actor !== "system" && !request.principal) {
    throw new Error("principal missing after authentication");
  }
  const actor = entry.actor === "system" ? null : request.principal;
  await tx.insert(schema.auditLog).values({
    actorUserId: actor?.userId ?? null,
    actingProfileId: actor?.actingProfileId ?? null,
    capability: entry.capability,
    action: entry.action,
    targetKind: entry.targetKind,
    targetId: entry.targetId,
    eventId: entry.eventId,
    changes: { before: jsonSafe(entry.before ?? null), after: jsonSafe(entry.after ?? null) },
    requestId: request.id,
  });
}
