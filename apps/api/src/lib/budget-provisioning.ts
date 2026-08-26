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
 * An operator gets a PRIVATE budget of their own — their margin line, which the
 * confidentiality filter in `routes/budget.ts` shows to nobody else — and the
 * event gets ONE SHARED ledger as soon as a second operator co-hosts it, which
 * is the common book the co-promoters reconcile against.
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
 * rows in a co-promoter's name.
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
  const operatingProfileIds = new Set(operators.map((operator) => operator.profileId));
  const callerProfileIds = new Set(forProfileIds);

  const missing: { eventId: string; scope: "private" | "shared"; ownerProfileId: string | null }[] =
    [];

  for (const profileId of operatingProfileIds) {
    if (!callerProfileIds.has(profileId)) continue; // not ours to open
    if (privateOwners.has(profileId)) continue;
    missing.push({ eventId, scope: "private", ownerProfileId: profileId });
  }

  // Co-hosting is what calls a shared ledger into being. A solo operator has
  // nobody to reconcile with, so a shared budget would just be a second empty
  // book to keep.
  const hasSharedAlready = existing.some((budget) => budget.scope === "shared");
  if (operatingProfileIds.size > 1 && !hasSharedAlready) {
    missing.push({ eventId, scope: "shared", ownerProfileId: null });
  }

  if (missing.length === 0) return;
  await database.insert(schema.budgets).values(missing).onConflictDoNothing();
}
