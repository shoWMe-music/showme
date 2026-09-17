import type { Database } from "@showme/db";
import { schema } from "@showme/db";
import { eq, sql } from "drizzle-orm";
import { canUseFeature, countsTowardEventCap } from "./entitlements";

/**
 * THE BOOKING LADDER — where a booking has got to, moved by what actually
 * happened rather than by somebody remembering to change a dropdown.
 *
 * ClickUp 86cbcehmp. Ran: *"Inviting performers from the system in the flow or
 * from the event manager should move the event from draft to suggested... If the
 * request is accepted by the performer the status changes to 'Pending' (event
 * status)... If the deal is accepted the event status changes to 'Confirmed'."*
 * And, at the end: *"Basically let's make sure the status progression,
 * invitation flows and event logic is not broken."*
 *
 * Until now `events.status` moved in exactly two places: a hand edit through
 * `PATCH /events/:id`, and the hold routes. Nothing about inviting an act,
 * nothing about an act saying yes, nothing about the paperwork being signed — so
 * the status said whatever it was last set to, which on most events was `draft`
 * for ever.
 *
 * ── FORWARD ONLY, AND NEVER OVER SOMETHING ELSE ───────────────────────────
 *
 * Every rule here advances along `draft → suggested → pending → confirmed` and
 * nothing here ever moves a status backwards, so an automatic rung can never
 * undo a decision a person made. Three states are left alone entirely:
 *
 *  - **`on_hold`** — the hold routes own that lane and have their own ranking
 *    cascade. A pencilled date is not a rung on this ladder.
 *  - **`concluded`** — the show happened. Nothing about paperwork reopens it.
 *  - **`cancelled`** — a signature on a withdrawn deal does not resurrect it,
 *    the same reasoning `confirmDealIfComplete` already applies to the deal.
 *
 * A status the ladder does not recognise is returned as `null` — "nothing to
 * do" — rather than forced, because the safe failure here is a stale label the
 * operator can fix, not a booking that silently claims to be confirmed.
 */
export type LadderTrigger = "performer_invited" | "invitation_accepted" | "deal_confirmed";

/** The rungs a booking climbs, in order — the only statuses the ladder moves FROM. */
const LADDER_SOURCES = new Set(["draft", "suggested", "pending"]);

/** Statuses the ladder will never move away from, whatever happens. */
const TERMINAL_FOR_LADDER = new Set(["on_hold", "concluded", "cancelled", "confirmed"]);

/**
 * The rule, as a pure function: where does this event go, given what just
 * happened? `null` means stay put.
 *
 * Kept free of the database on purpose — this is the part worth asserting
 * exhaustively, and a rule that needs a Postgres container to answer a question
 * about two strings does not get tested exhaustively.
 */
export function nextLadderStatus(current: string, trigger: LadderTrigger): string | null {
  if (TERMINAL_FOR_LADDER.has(current)) return null;

  switch (trigger) {
    // An act has been put on the bill and has not answered. That is what
    // `suggested` means, and only a `draft` can become one: adding a second
    // support act to a night that is already pending must not drag the whole
    // event back down a rung.
    case "performer_invited":
      return current === "draft" ? "suggested" : null;

    // Somebody said yes.
    //
    // `draft` is accepted here as well as `suggested`, deliberately. The strict
    // reading of the ticket is `suggested → pending` only — but every event
    // invited BEFORE this shipped is sitting at `draft` with live invitations on
    // it (30 of them in production), and under the strict rule an acceptance on
    // one of those would move nothing at all, for ever. An act saying yes is
    // objectively past "draft", and this is still forward-only, so honouring it
    // costs nothing and removes a silent dead state.
    case "invitation_accepted":
      return current === "draft" || current === "suggested" ? "pending" : null;

    // Every signatory has signed. This is the one rung that consumes the
    // free-tier event cap — see `advanceEventStatus`, which is why this function
    // is not the last word on it.
    //
    // Named sources rather than "anything not terminal". The permissive form
    // advanced ANY unrecognised status straight to `confirmed`, which is a bad
    // way to be wrong: a value this rule has never heard of is precisely the
    // case where it knows least, and booking the night is the most expensive
    // thing it could do about that. Surfaced by the exhaustive table in
    // `event-status-ladder.test.ts` — no route can currently produce such a
    // value, so nothing was broken, but the next status added to the enum would
    // have inherited "confirms itself" for free.
    case "deal_confirmed":
      return LADDER_SOURCES.has(current) ? "confirmed" : null;

    default:
      return null;
  }
}

/**
 * Apply the ladder to one event, inside the caller's transaction.
 *
 * Returns the status it moved to, or `null` if it stayed put — so a caller can
 * say what happened without re-reading the row.
 *
 * ── WHY A BLOCKED PLAN DOES NOT THROW ──────────────────────────────────────
 *
 * `confirmed` and `concluded` consume the free-tier event cap
 * (`CAP_COUNTING_EVENT_STATUSES`), and that file is explicit that every write
 * path setting `events.status` must gate on it. So this one does. What it does
 * NOT do is refuse.
 *
 * The trigger for that rung is the LAST SIGNATURE ON AN AGREEMENT, and the
 * person who supplies it is usually the performer — not the host whose plan is
 * being measured. Throwing would mean an act presses Sign, gets a 403 about
 * somebody else's billing, and the deal they just agreed to does not confirm.
 * That is the wrong failure in every direction: it breaks the signature (which
 * is a real, wanted event) to enforce a limit on the operator (who is not even
 * in the room).
 *
 * So a blocked plan leaves the event where it is and the deal confirms
 * regardless. The cap still binds where it is supposed to — the deliberate act
 * of confirming an event, gated in `holds.ts` and `routes/events.ts`, which DO
 * throw. The ladder is an automatic consequence, and an automatic consequence is
 * the wrong place to enforce a paywall.
 *
 * ── AND IT IS UNREACHABLE TODAY. Read this before trusting it. ─────────────
 *
 * `FREE_OPERATOR_EVENT_LIMIT` is `null` (`lib/entitlements.ts`) — deliberately,
 * because the pricing page says "Unlimited events" on Basic too — so
 * `canUseFeature("create_event")` currently returns `allowed` for every tier and
 * the branch below never taken. It is therefore **written but not exercised**:
 * no test covers it, because there is no way to reach it without changing that
 * constant, and a test that changed it would be asserting a pricing decision
 * rather than this rule.
 *
 * It is here anyway because `entitlements.ts` is explicit that "whatever is
 * counted here is what every write path that sets `events.status` must gate on",
 * and this is such a path. The day a limit is reintroduced this rung must not
 * silently start minting confirmed events past the cap. **If you reintroduce
 * one, test this branch on the way.**
 */
export async function advanceEventStatus(
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle db/tx handle, as `loadEventSummary`.
  tx: any,
  input: { eventId: string; trigger: LadderTrigger },
  now: Date = new Date(),
): Promise<{ from: string; to: string } | null> {
  const [event] = await tx
    .select({
      id: schema.events.id,
      status: schema.events.status,
      hostProfileId: schema.events.hostProfileId,
    })
    .from(schema.events)
    .where(eq(schema.events.id, input.eventId));
  if (!event) return null;

  const next = nextLadderStatus(event.status, input.trigger);
  if (!next || next === event.status) return null;

  if (countsTowardEventCap(next) && !countsTowardEventCap(event.status)) {
    const gate = await canUseFeature(tx as Database, event.hostProfileId, "create_event", now);
    if (!gate.allowed) return null; // see the note above — never throws
  }

  await tx
    .update(schema.events)
    .set({
      status: next,
      // Same optimistic-locking bump the hold cascade uses. Expressed in SQL
      // rather than read-then-write because this runs inside somebody else's
      // transaction and must not clobber a concurrent edit's version.
      version: sql`${schema.events.version} + 1`,
      updatedAt: now,
    })
    .where(eq(schema.events.id, event.id));

  return { from: event.status, to: next };
}
