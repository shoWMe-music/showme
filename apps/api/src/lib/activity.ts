import { schema } from "@showme/db";
import type { Capability } from "@showme/shared";
import type { FastifyRequest } from "fastify";
import type { Transaction } from "./audit";

/**
 * What an activity row is ABOUT — and therefore who may read it.
 *
 * Visibility is NOT stored on the row. It is derived from this kind plus, for the
 * party-scoped kinds, the target's own id, and resolved against the viewer at read
 * time (`routes/activity.ts`). Adding a kind here without adding it to the read
 * side's `KIND_CAPABILITY` map makes the row invisible to everyone but nobody's
 * secret leaks — deny-by-default, in that direction on purpose.
 *
 * The four tiers:
 * - **Event-level** (`event`, `participant`, `invitation`, `schedule`): everyone
 *   on the event who holds the kind's capability. `schedule` is NOT the same tier
 *   as `event` — `view_only` participants can view the event but not its running
 *   order, and the feed must not be the back door into it.
 * - **Operator-level** (`hold`, `budget`, `share`): the managing operators only.
 *   Hold rank is the operator's private competitive information (see
 *   `serialize/event.ts`), and a budget or an external share link is pool business.
 * - **Party-scoped** (`deal`, `settlement`, `transfer`): only the parties to that
 *   row — resolved by joining the viewer's participants to the target, exactly as
 *   the resource's own route scopes it.
 * - **Participant-scoped** (`rider`, `setlist`, `archive`): the one participant the row is
 *   ABOUT, plus the operators. Their resources are scoped by ownership rather than
 *   by a capability (`scopedEventRiders`, the setlist list route), so no entry in
 *   `ACTIVITY_KIND_CAPABILITY` could reproduce the rule — `rider.view` is held by
 *   technical crew whose SPONSOR decides which riders they may open, and by no
 *   performer at all, not even for their own. For these kinds `targetId` is the
 *   OWNING `event_participants.id`, not the rider's or setlist's own id; the
 *   subject's id travels in the summary. See `ACTIVITY_PARTICIPANT_SCOPED_KINDS`.
 */
export type ActivityTargetKind =
  | "event"
  | "participant"
  | "invitation"
  | "schedule"
  | "task"
  | "hold"
  | "budget"
  | "share"
  | "deal"
  | "settlement"
  | "transfer"
  | "rider"
  | "setlist"
  | "archive";

/**
 * The capability that gates each non-party kind. Party-scoped kinds are absent —
 * their rule is membership of the target, not a capability, so they are handled
 * by their own id branch on the read side.
 */
export const ACTIVITY_KIND_CAPABILITY: Partial<Record<ActivityTargetKind, Capability>> = {
  event: "event.view",
  participant: "event.view",
  invitation: "event.view",
  schedule: "schedule.view",
  // An event-scoped task is readable by anyone holding `event.view` — that is the
  // literal gate on `GET /tasks?eventId=` — so its history sits at the same tier.
  task: "event.view",
  hold: "event.edit",
  budget: "budget.view",
  share: "event.edit",
};

/**
 * Kinds whose row is visible to the participant it is ABOUT (and to the operators,
 * via the operator tier), resolved by `target_id IN (the viewer's participant ids)`.
 *
 * The rule is ownership, not a capability, which is why these cannot live in
 * `ACTIVITY_KIND_CAPABILITY`: a rider is visible to its submitter, to the operators,
 * and to crew only within their sponsor's reach (decisions #12); a setlist is
 * visible to its author, to the operators, and to whoever it was explicitly shared
 * with. The two reach-based cases — sponsored crew, an explicit setlist share — get
 * NO feed row rather than a wrong one: deny-by-default, the same direction the rest
 * of this module fails in.
 *
 * `archive` joined them for the same reason and with a sharper edge: filing an
 * event away is a preference of ONE profile (`event_participants.archived_at`,
 * migration 0020), not news about the show. "The venue archived this" belongs in
 * the venue's own history and nowhere else — a performer must not read it as the
 * booking being shelved. The operator tier still sees these rows on their own
 * events, which is the pre-existing shape of that tier and not special to this
 * kind.
 *
 * `target_id` therefore holds the owning `event_participants.id`. That row is never
 * hard-deleted (`status = 'removed'`), so the history outlives both the rider and
 * the participant's involvement.
 */
export const ACTIVITY_PARTICIPANT_SCOPED_KINDS = ["rider", "setlist", "archive"] as const;

/**
 * The capability that makes a viewer an OPERATOR of the event for feed purposes:
 * pool visibility, which the ceiling (`isGrantable`) only ever grants to a
 * `host`/`co_host`. Operators additionally see every party-scoped row on their own
 * events — they administer the event's money, so its deals, settlements and
 * transfers are their business even where they are not themselves a named party.
 * A private agent↔performer commission is the one exception, and it is kept out by
 * never being WRITTEN (see `routes/settlement.ts`), not by being filtered here.
 */
export const ACTIVITY_OPERATOR_CAPABILITY: Capability = "budget.view";

export interface ActivityEntry {
  eventId?: string;
  type: string; // e.g. "deal.created", "participant.added", "event.published"
  /** What the row is ABOUT — the feed is visible iff the viewer can view this target. */
  targetKind: ActivityTargetKind;
  targetId: string;
  /**
   * Human-relevant facts about the change. NEVER money: a summary is read by
   * everyone the kind admits, and an amount in a `deal` or `settlement` row would
   * hand a performer a figure the serializer redacts from the resource itself.
   */
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

/**
 * The names of the fields an update actually changed. The feed says WHICH fields
 * moved, never their values: an event's `extras` (guest list, ticket tiers) is
 * operator-only in `serialize/event.ts`, so echoing a patch body into a row every
 * participant reads would undo that redaction. Values are carried only where the
 * field is already event-public (status) and stated explicitly at the call site.
 */
export function changedFieldNames(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
): string[] {
  return Object.keys(patch).filter((field) => {
    const next = patch[field];
    if (next === undefined) return false;
    const previous = before[field];
    // jsonb leaves and dates compare by value, not identity.
    return JSON.stringify(previous ?? null) !== JSON.stringify(next ?? null);
  });
}
