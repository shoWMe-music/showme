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
