import { schema } from "@showme/db";
import type { FastifyRequest } from "fastify";
import type { Transaction } from "./audit";

export interface ActivityEntry {
  eventId?: string;
  type: string; // e.g. "deal.created", "participant.added", "event.published"
  /** What the row is ABOUT — the feed is visible iff the viewer can view this target. */
  targetKind: string; // "event" | "deal" | "settlement" | "schedule" | …
  targetId: string;
  summary?: Record<string, unknown>;
}

/**
 * Write the curated, USER-FACING activity feed row (decisions #2/#3). Distinct from
 * `audit_log` (forensic): the same mutation may write both. A row's visibility is
 * NOT stored — it's `target_kind` + `target_id`, resolved against the viewer's
 * access when the feed is read (see `routes/activity.ts`).
 */
export async function writeActivity(
  tx: Transaction,
  request: FastifyRequest,
  entry: ActivityEntry,
): Promise<void> {
  const principal = request.principal;
  await tx.insert(schema.activityLog).values({
    eventId: entry.eventId,
    type: entry.type,
    actorUserId: principal?.userId,
    actorProfileId: principal?.actingProfileId,
    actorDisplay: request.firebaseUser?.name,
    targetKind: entry.targetKind,
    targetId: entry.targetId,
    summary: entry.summary ?? null,
  });
}
