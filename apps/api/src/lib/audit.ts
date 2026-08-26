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
 * The actor is taken from the request principal.
 */
export async function writeAudit(
  tx: Transaction,
  request: FastifyRequest,
  entry: AuditEntry,
): Promise<void> {
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");
  await tx.insert(schema.auditLog).values({
    actorUserId: principal.userId,
    actingProfileId: principal.actingProfileId,
    capability: entry.capability,
    action: entry.action,
    targetKind: entry.targetKind,
    targetId: entry.targetId,
    eventId: entry.eventId,
    changes: { before: jsonSafe(entry.before ?? null), after: jsonSafe(entry.after ?? null) },
    requestId: request.id,
  });
}
