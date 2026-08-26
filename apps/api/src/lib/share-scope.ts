import { type EventRole, isGrantable } from "@showme/auth";
import { schema } from "@showme/db";
import { type Capability, isCapability } from "@showme/shared";
import { and, eq, or, sql } from "drizzle-orm";
import { badRequest, forbidden } from "../errors";

/**
 * What a SHARE may grant, and to whom — the scope half of off-platform access
 * (`docs/off-platform-access.md`).
 *
 * A share is a tokenized capability grant, and `shares.capabilities` draws from
 * the SAME catalog as `permission_sets` (`packages/shared/src/capabilities.ts`).
 * That is the whole granularity model: there is no second vocabulary of "section
 * ids" beside it. The old app had twenty-one hardcoded section names
 * (`budget-calculator`, `deal-structure`, `guest-list`, …) which the server had
 * no way to enforce, because a section id is not something `authorize()` knows
 * about. Here a section of the shared document IS a capability, so the
 * serializer decides what appears and the template only draws what it is handed.
 */

/**
 * The capabilities a share may carry. A strict subset of the catalog: everything
 * absent from this list is either an EDIT right (a link-holder never edits — they
 * read, confirm and comment) or meaningless off-platform (`profile.edit`,
 * `members.manage`).
 *
 * `settlement.confirm` and `agreement.confirm` are the two that make a share more
 * than a document — they are audit A-33, "off-platform parties can comment but
 * never approve". `agreement.confirm` is this catalog's name for what the old app
 * called confirming a deal: the agreement is folded into the deal (decisions #1),
 * so there is no separate `deal.confirm` to add.
 */
export const SHARABLE_CAPABILITIES: readonly Capability[] = [
  "event.view",
  "schedule.view",
  "rider.view",
  "budget.view",
  "deal.view.own",
  "settlement.view.own",
  "settlement.confirm",
  "agreement.confirm",
  "message.post",
];

const SHARABLE = new Set<Capability>(SHARABLE_CAPABILITIES);

/**
 * Capabilities that may NEVER ride an anonymous link.
 *
 * `access: 'public'` means "no identity challenge" — the opaque token is the only
 * key, so whoever holds the URL is whoever holds the URL. That is acceptable for a
 * call sheet and unacceptable for money: a forwarded email would hand a stranger a
 * performer's settlement, and there would be no record of who read it.
 *
 * The owner's ruling (2026-08, Q17) is stronger than the doc's "sensible default":
 * shares go to an email address and are redeemed with an OTP. The web app therefore
 * offers no public tier at all. This set is the server-side floor under that
 * decision — a caller reaching the API directly cannot mint an anonymous link to a
 * budget, a deal, a settlement, an approval or the comment thread.
 */
const PROTECTED_ONLY: ReadonlySet<Capability> = new Set<Capability>([
  "budget.view",
  "deal.view.own",
  "settlement.view.own",
  "settlement.confirm",
  "agreement.confirm",
  // Commenting is an identified act: the operator reads "who said this", and the
  // comment is attributed to a `share_recipient`. Anonymous is not an author.
  "message.post",
]);

/**
 * Does the sharer have this capability's REACH on the event?
 *
 * For everything but one capability the question is exactly `held.has(...)`, and
 * that is the whole check. **Riders are the exception, and it is not a special
 * case invented here** — it is the rule `routes/riders.ts` already enforces. No
 * operator preset carries `rider.view` (`packages/auth/src/presets.ts`); an
 * operator's all-rider reach comes from being a MANAGING operator, which
 * `scopedEventRiders` reads off `budget.view` ("operators see everything"). So an
 * operator who can open every rider on the event held none of the capability that
 * shares one, and the Riders tick-box in Share & Export was disabled for every
 * operator alive — a control that could never be used by the only account kind
 * the dialog belongs to.
 *
 * Asking the same question the rider route asks keeps the two answers together:
 * if the reach rule ever moves, it moves in one idiom rather than diverging into
 * "who may see a rider" and "who may share one".
 */
function hasReach(capability: Capability, held: ReadonlySet<Capability>): boolean {
  if (held.has(capability)) return true;
  return capability === "rider.view" && held.has("budget.view");
}

/**
 * Narrow the capabilities requested for a new share.
 *
 * Three gates, in order:
 *
 * 1. **Known and sharable** — the string must be a real capability and one this
 *    module admits. Until now `capabilities` was `z.array(z.string())`, so a share
 *    could be minted granting `"settlement.destroy"` or any typo, and the string
 *    would sit in the database looking like authority.
 * 2. **Reachable by the sharer** — you cannot hand out what you cannot see. This
 *    is the escalation that mattered: creating a share needs `event.edit`, and an
 *    `editor` holds `event.edit` while the role filter strips `budget.view` from
 *    them. Without this check they could mint a link granting `budget.view`, open
 *    it themselves, and read the pool the ceiling had just refused them. See
 *    `hasReach` for the one capability where holding it is not the question.
 * 3. **Allowed at this access tier** — see `PROTECTED_ONLY`.
 */
export function narrowSharedCapabilities(
  requested: readonly string[],
  held: ReadonlySet<Capability>,
  access: "public" | "protected",
): Capability[] {
  if (requested.length === 0) throw badRequest("A share must grant at least one capability");

  const capabilities: Capability[] = [];
  for (const value of requested) {
    if (!isCapability(value) || !SHARABLE.has(value)) {
      throw badRequest(`Not a sharable capability: ${value}`);
    }
    if (!hasReach(value, held)) {
      throw forbidden(`You cannot share a capability you do not hold: ${value}`);
    }
    if (access === "public" && PROTECTED_ONLY.has(value)) {
      throw badRequest(
        `${value} may only be shared with a verified recipient — use access "protected"`,
      );
    }
    if (!capabilities.includes(value)) capabilities.push(value);
  }
  return capabilities;
}

/**
 * The capabilities a given VIEWER actually gets, which is never more than the
 * share grants and can be less.
 *
 * When the recipient is a party on the event, the authorization engine's CEILING
 * still applies to them (`isGrantable`, decisions #4): only a managing operator
 * (host / co_host) may ever see the pool. story.md calls this inviolable — a
 * performer never sees the event budget "even if an operator *wanted* to show
 * them" — so a share cannot be the back door around it. An operator who ticks
 * "Budget" on a link to their headliner gets a link whose budget section is not
 * there.
 *
 * A recipient who is NOT a party (an accountant, a sponsor, a co-promoter's
 * bookkeeper) has no event role and therefore no ceiling of their own; the
 * operator's grant is the only authority in play, and it stands as issued. The
 * ceiling protects a *relationship*; it is not a global secrecy rule.
 */
export function viewerCapabilities(
  granted: readonly Capability[],
  participantRole: EventRole | null,
): Set<Capability> {
  if (!participantRole) return new Set(granted);
  return new Set(granted.filter((capability) => isGrantable(capability, participantRole)));
}

/** A share recipient resolved onto the event — the party-scope key. */
export interface RecipientParty {
  participantId: string;
  role: EventRole;
  profileId: string;
  displayName: string | null;
}

/**
 * Find the event participant an email address belongs to.
 *
 * This is the "email → party" join `docs/off-platform-access.md` promises,
 * replacing the old app's multi-hop walk: one indexed query over
 * `event_participants ⋈ profile_members`, matching either the membership's own
 * contact email (an off-platform stub carries one, `lib/off-platform.ts`) or the
 * email of the signed-in user behind it.
 *
 * Returns `null` for a recipient who is nobody on this event — which is a normal
 * answer, not a failure: they get whatever the share grants, party-scoped to
 * nothing, so every "own" section renders empty rather than showing them somebody
 * else's line.
 */
export async function findRecipientParty(
  // The Drizzle app-db and a transaction share one query API; naming the exact
  // generic here adds noise for no safety (same alias as `lib/off-platform.ts`).
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle db/tx handle.
  database: any,
  eventId: string,
  email: string,
): Promise<RecipientParty | null> {
  const normalized = email.trim().toLowerCase();
  const rows = await database
    .select({
      participantId: schema.eventParticipants.id,
      role: schema.eventParticipants.role,
      profileId: schema.eventParticipants.profileId,
      displayName: schema.profiles.name,
      createdAt: schema.eventParticipants.createdAt,
    })
    .from(schema.eventParticipants)
    .innerJoin(
      schema.profileMembers,
      eq(schema.profileMembers.profileId, schema.eventParticipants.profileId),
    )
    .innerJoin(schema.profiles, eq(schema.profiles.id, schema.eventParticipants.profileId))
    .leftJoin(schema.users, eq(schema.users.id, schema.profileMembers.userId))
    .where(
      and(
        eq(schema.eventParticipants.eventId, eventId),
        or(
          eq(sql`lower(${schema.profileMembers.email})`, normalized),
          eq(sql`lower(${schema.users.email})`, normalized),
        ),
      ),
    )
    .orderBy(schema.eventParticipants.createdAt);

  const first = rows[0];
  if (!first) return null;
  return {
    participantId: first.participantId,
    role: first.role as EventRole,
    profileId: first.profileId,
    displayName: first.displayName ?? null,
  };
}
