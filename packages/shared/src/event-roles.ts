/**
 * HOW AN EVENT ROLE IS WRITTEN ON SCREEN.
 *
 * `event_participants.role` is an enum whose first two members are `host` and
 * `co_host`, and until this module existed every screen printed them by
 * title-casing the raw value — five separate copies of the same three-line
 * helper, in `EventDetail`, `useBudgetEditor`, `EventAgreementTab`,
 * `useEventSettlement` and `InvitationLanding`. So the word "Host" reached the
 * reader from five places at once and could only be changed in five.
 *
 * **The word is "Operator".** `docs/decisions.md` #16.20 settled it — *"Operator
 * labels the event-manager; ownership is transferable ('host' collided with the
 * door-person meaning)"* — and `docs/story.md` builds the whole account kind on
 * it: the operator is "the party producing and managing an event", the one who
 * "books the talent, plans the budget, hosts the event, and runs the settlement"
 * and takes the residual. Every other surface in the product already says
 * operator; the event roster was the one place still saying host.
 *
 * **The stored value does not change.** `host` and `co_host` remain the enum
 * members, the permission-set ceiling still keys on them
 * (`routes/groups.ts`, `routes/settlement.ts`), and so do the roster's icon and
 * tone maps. This is a display rename, and lives here precisely so it can never
 * again be mistaken for a data one.
 */

/**
 * The product's own word for each `event_participant_role` member.
 *
 * `support` is deliberately absent: title-casing already produces "Support",
 * and an entry that only repeats the fallback is a line that can drift from it.
 */
const EVENT_PARTICIPANT_ROLE_LABELS: Record<string, string> = {
  host: "Operator",
  co_host: "Co-operator",
  crew_lead: "Crew lead",
};

/**
 * `team_and_crew` → "Team and crew". The generic tidy-up for an enum value with
 * no product word of its own — a rider type, a participant status, a role that
 * arrived as free text on an invitation.
 */
export function humanizeEnumValue(raw: string): string {
  return raw.replace(/_/g, " ").replace(/^\w/, (character) => character.toUpperCase());
}

/**
 * The label for one participant's role on an event.
 *
 * Falls back to `humanizeEnumValue` rather than to the raw string, so a role
 * this table has not been taught — a new enum member, or the free-text role an
 * invitation carries — still reads as a word rather than as a column value.
 */
export function eventParticipantRoleLabel(role: string): string {
  return EVENT_PARTICIPANT_ROLE_LABELS[role] ?? humanizeEnumValue(role);
}

/**
 * DOES THIS PARTY SIGN ITS OWN LINE ON ONE AGREEMENT, without holding event-scoped
 * `agreement.confirm`? (QA sweep run 10, QA10-3.)
 *
 * The owner's rule for crew reads across word for word: *"they can confirm an agreement if it is with
 * them."* A co-promoter standing behind a party line on ONE agreement is exactly that, and it stays
 * deal-scoped for the same reason — a co-host on *Standard for the role* still holds no event-scoped
 * `agreement.confirm`, so they still do not decide whether the show happens (`hold/confirm`).
 *
 * **IT LIVES HERE BECAUSE BOTH SIDES ASK IT, AND THE CLIENT'S COPY WAS ONE ENTRY BEHIND.** The
 * server's set has carried `co_host` all along; `useEventAgreements.ts` restated it as
 * `new Set(["crew","crew_lead"])`, so a co-host named as the payer of a room hire was offered no
 * *Confirm your line* control while `POST /deals/:did/confirm` answered **200** to the same account.
 * The Dashboard then told them *"Sign your line on QA10 Rental Night"* and linked to a card with no
 * button on it, and `POST /settlement/compute` refuses while the agreement is unsigned — so from the
 * browser that night could not be settled at all. `CLAUDE.md` already records this shape as *"an
 * unsignable agreement that froze a whole event's settlement"*.
 *
 * `useEventAgreements.ts`'s own comment stated the intent the duplicate broke: the button is offered
 * *"to exactly the callers `POST /deals/:did/confirm` will accept — no dead affordance, and no hidden
 * one either."* One definition is what makes that true rather than aspirational.
 *
 * Takes plain strings because the two callers type their roles differently — `@showme/auth` has
 * `EventRole` and `DealPartyRole`, the web has whatever the API sent — and an unrecognised value
 * answers `false`, which is the safe direction: no button rather than a dead one.
 *
 * `host` is deliberately NOT here, and that is measured rather than assumed: `POST /events` writes
 * the host's participant row with `operator_full`, which carries `agreement.confirm` outright, so no
 * host reaches this dead end by any path the app has. A `performer` and a `support` act are absent
 * for the same kind of reason — `PERFORMER_FLOOR` carries `agreement.confirm`, so they never need it.
 */
const DEAL_SCOPED_CONFIRM_EVENT_ROLES: ReadonlySet<string> = new Set([
  "crew",
  "crew_lead",
  "co_host",
]);

export function confirmsOwnDealLines(eventRole: string, roleInDeal: string): boolean {
  // An observer is on the deal to READ it. Nothing about being able to see an agreement says
  // anything about being able to sign it (decisions #4).
  if (roleInDeal === "observer") return false;
  return DEAL_SCOPED_CONFIRM_EVENT_ROLES.has(eventRole);
}
