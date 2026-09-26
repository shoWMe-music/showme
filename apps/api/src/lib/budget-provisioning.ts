import type { Database } from "@showme/db";
import { schema } from "@showme/db";
import { and, eq, inArray, ne } from "drizzle-orm";

/**
 * The event roles that operate an event, and so are the ones a budget belongs
 * to. Mirrors `OPERATOR_EVENT_ROLES` in the auth engine's ceiling: those are
 * exactly the roles that may ever hold `budget.view`, so provisioning a budget
 * for anyone else would create a row its owner could never open.
 */
const OPERATING_ROLES = ["host", "co_host"] as const;

/**
 * Give this event the budgets its operators are entitled to, if it has not got
 * them yet.
 *
 * THE EVENT HAS ONE LEDGER, ALWAYS — the `shared` budget. It is the night's book:
 * what the Budget Planner opens on, and the only thing `copyBudgetOnce` copies
 * into the settlement. A `private` budget is the extra an operator MAY ALSO keep
 * (PLAN.md:215) — their own margin line, which the confidentiality filter in
 * `routes/budget.ts` shows to nobody else, and which the reconciliation
 * deliberately never reads.
 *
 * So a private book only comes into being when there is a CO-HOST to keep it
 * from. A solo operator gets exactly one book, it is the shared ledger, and the
 * planner shows no scope chooser (`EventDetail.tsx` renders it only for two
 * books or more) — nothing on their screen says "shared", because there is
 * nobody to share it with.
 *
 * **This was inverted until 2026-09-26, and it settled nights with no costs.**
 * A solo operator was given ONLY a private book, on the reasoning that "a solo
 * operator has nobody to reconcile with, so a shared budget would just be a
 * second empty book to keep". But every reader downstream takes the shared
 * budget and only the shared budget — `copyBudgetOnce`, `seedTicketTiersIntoBudget`
 * and the planner's own `doorForecastFrom`. So the operator typed costs into the
 * one book they were offered and nothing read them: `seedTicketTiersIntoBudget`
 * then CREATED a shared budget for the event's ticket tiers, and the night
 * settled with revenue and no costs at all. Measured on a one-operator event:
 * a SEK 1,000 production cost entered in the planner, Deductions SEK 0 in the
 * settlement, and the 70% act paid 4,410 instead of 3,710. It is the exact
 * mirror of the "costs and no revenue" hole closed in `a033436`, and it survived
 * that session because the seeded reference event is co-hosted.
 *
 * Existing events were healed by migration 0046, which relabels a solo event's
 * private budget as the shared ledger rather than stranding what was typed in it.
 *
 * When a co-host later joins, the ledger does NOT move: what the solo operator
 * planned stays in the reconciliation, which is what the co-host is there to
 * reconcile, and both operators get a private margin book from that point on.
 *
 * This runs on demand rather than at the eight separate places a participant
 * row is created (invitation accept, group assignment, agent assignment, inbound
 * booking, calendar promotion, direct add, event create). Putting it behind the
 * read means the invariant cannot be missed by a path that forgets to call it,
 * and events created before budgets were provisioned at all heal on first open
 * instead of needing a backfill.
 *
 * Idempotent and safe to race: the two partial unique indexes added in migration
 * 0013 are what `onConflictDoNothing` conflicts on, so two simultaneous readers
 * cannot both win.
 *
 * `forProfileIds` is the caller's own memberships. A private budget is only ever
 * created for a profile the caller belongs to — reading an event must not mint
 * rows in a co-promoter's name. The shared ledger belongs to the event rather
 * than to anyone, so it is provisioned for whichever operator opens it first.
 */
export async function ensureEventBudgets(
  database: Database,
  eventId: string,
  forProfileIds: readonly string[],
): Promise<void> {
  const operators = await database
    .select({ profileId: schema.eventParticipants.profileId })
    .from(schema.eventParticipants)
    .where(
      and(
        eq(schema.eventParticipants.eventId, eventId),
        inArray(schema.eventParticipants.role, [...OPERATING_ROLES]),
        ne(schema.eventParticipants.status, "removed"),
      ),
    );
  if (operators.length === 0) return;

  const existing = await database
    .select({ scope: schema.budgets.scope, ownerProfileId: schema.budgets.ownerProfileId })
    .from(schema.budgets)
    .where(eq(schema.budgets.eventId, eventId));

  const privateOwners = new Set(
    existing.filter((budget) => budget.scope === "private").map((budget) => budget.ownerProfileId),
  );
  // An erased participant (migration 0032) is a name on the bill with no profile
  // behind it, so it can never be the operator a private ledger belongs to.
  const operatingProfileIds = new Set(
    operators
      .map((operator) => operator.profileId)
      .filter((profileId): profileId is string => profileId !== null),
  );
  const callerProfileIds = new Set(forProfileIds);

  const missing: { eventId: string; scope: "private" | "shared"; ownerProfileId: string | null }[] =
    [];

  // The night's book, and the only one the settlement reads. Every event that
  // has an operator at all has one, co-hosted or not.
  const hasSharedAlready = existing.some((budget) => budget.scope === "shared");
  if (!hasSharedAlready) {
    missing.push({ eventId, scope: "shared", ownerProfileId: null });
  }

  // Co-hosting is what calls a PRIVATE book into being: it is the margin line an
  // operator keeps from the other operator, so with nobody to keep it from it
  // would only be a second book to choose between — and choosing wrong is what
  // put a night's costs outside its own settlement.
  if (operatingProfileIds.size > 1) {
    for (const profileId of operatingProfileIds) {
      if (!callerProfileIds.has(profileId)) continue; // not ours to open
      if (privateOwners.has(profileId)) continue;
      missing.push({ eventId, scope: "private", ownerProfileId: profileId });
    }
  }

  if (missing.length === 0) return;
  await database.insert(schema.budgets).values(missing).onConflictDoNothing();
}
