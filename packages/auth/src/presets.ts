import type { Capability } from "@showme/shared";

/**
 * Profile-membership roles (mirrors the DB `profile_member_role` enum). The role
 * is the OUTER filter in the two-layer composition: the permission set says what
 * an event-role may touch; the role narrows it (an editor can't touch money or
 * management even if their set grants it).
 */
export type ProfileRole = "owner" | "admin" | "editor" | "viewer" | "crew";

/**
 * Preset permission sets = the transparency tiers (authorization skill). These
 * are capability bundles a participant's `permission_set` is seeded from. Note
 * there is deliberately no `*.view.all` — deal/settlement visibility is pure
 * party-scoping (decisions #4); the operator sees everything by being a party on
 * the event's deals, not via a capability.
 */
export const PRESET_PERMISSION_SETS = {
  operator_full: [
    "event.view",
    "event.edit",
    "event.delete",
    "event.publish",
    "event.send_info_email",
    "participants.manage",
    "deal.view.own",
    "deal.edit",
    "budget.view",
    "budget.edit",
    "revenue.edit",
    "settlement.view.own",
    "settlement.edit",
    "settlement.confirm",
    "settlement.finalize",
    "schedule.view",
    "schedule.edit",
    // An operator sees every rider on their own event — `scopedEventRiders`
    // already returns all of them, it was just reading `budget.view` as a proxy
    // for "is an operator" because THIS LIST DID NOT CARRY THE CAPABILITY. That
    // gap had a visible cost: the share dialog asked whether the sharer held
    // `rider.view`, so an operator could never put a rider on a link — the
    // tick-box was greyed out on every event. The capability now says what was
    // already true. Scope is still decided at read time (operator → all riders;
    // performer → their own, decisions #12), so this widens nothing.
    "rider.view",
    "crew.manage",
    "agreement.manage",
    "agreement.confirm",
    "message.post",
  ],
  performer: [
    "event.view",
    "deal.view.own",
    "settlement.view.own",
    "settlement.confirm",
    "rider.submit",
    "schedule.view",
    // The setlist is the act's own artistic content — the performer authors it,
    // the operator only files the PRO report derived from it (decisions.md
    // "Setlists"). Deliberately absent from the operator, agent and crew presets.
    "setlist.author",
    "message.post",
  ],
  // Crew tiers — the transparency dial per crew person (decisions #12). Schedule-only
  // is the floor-plus-nothing tier (chef, bartender, door); technical adds rider
  // visibility (sound, lighting, backline). Riders stay OPT-IN — never in the floor.
  crew_schedule_only: ["event.view", "schedule.view"],
  crew_technical: ["event.view", "schedule.view", "rider.view"],
  view_only: ["event.view"],
  // The fanned-out agent bundle (decisions #14): negotiate/approve on the
  // performer's behalf. Pool/budget caps are stripped by the ceiling anyway.
  agent: [
    "event.view",
    "deal.view.own",
    "deal.edit",
    "settlement.view.own",
    "agreement.manage",
    "agreement.confirm",
    "schedule.view",
    "message.post",
    // Bring crew on behalf of the performers they represent — sponsored by the
    // agent, so scoped to the agent's own reach (those performers), decisions #12.
    "crew.submit",
  ],
} satisfies Record<string, Capability[]>;

/** The name of a preset permission set. */
export type PresetName = keyof typeof PRESET_PERMISSION_SETS;

/** Money capabilities an `editor` may never hold, regardless of the permission set. */
const FINANCIAL_EDIT_CAPABILITIES: readonly Capability[] = [
  "budget.edit",
  "revenue.edit",
  "deal.edit",
  "settlement.edit",
  "settlement.confirm",
  "settlement.finalize",
];

/** Management capabilities an `editor` may never hold. */
const MANAGEMENT_CAPABILITIES: readonly Capability[] = [
  "participants.manage",
  "members.manage",
  "permission.grant_admin",
  "event.delete",
  "templates.manage",
  "crew.manage",
  "agreement.manage",
];

/** The only capabilities a `viewer`/`crew` keeps — everything else is read-stripped. */
const VIEW_ONLY_CAPABILITIES: readonly Capability[] = [
  "event.view",
  "deal.view.own",
  "budget.view",
  "settlement.view.own",
  "schedule.view",
  // Opt-in for crew who need it (sound/lighting) — visibility is still SCOPED to the
  // crew's sponsor at read time (operator → all riders; performer → own only, #12).
  "rider.view",
];

/**
 * Narrow a permission set's capabilities by the holder's profile role. `owner`
 * and `admin` keep the full set; `editor` loses money + management; `viewer` and
 * `crew` are read-only. This is a pure function — the second half of
 * `effective = ⋃ role_filter(permission_set.capabilities, profile_role)`.
 */
export function roleFilter(capabilities: readonly Capability[], role: ProfileRole): Capability[] {
  if (role === "owner" || role === "admin") {
    return [...capabilities];
  }
  if (role === "editor") {
    const stripped = new Set<Capability>([
      ...FINANCIAL_EDIT_CAPABILITIES,
      ...MANAGEMENT_CAPABILITIES,
    ]);
    return capabilities.filter((capability) => !stripped.has(capability));
  }
  // viewer | crew — read-only.
  const allowed = new Set<Capability>(VIEW_ONLY_CAPABILITIES);
  return capabilities.filter((capability) => allowed.has(capability));
}

/** A profile's role ON an event (mirrors the DB `event_participant_role` enum). */
export type EventRole =
  | "host"
  | "co_host"
  | "performer"
  | "support"
  | "crew_lead"
  | "crew"
  | "agent";

/** The managing operators — the only relationship that may see the pool/budget. */
const OPERATOR_EVENT_ROLES: ReadonlySet<EventRole> = new Set(["host", "co_host"]);

/** A performer's inviolable floor — own slice + confirms; the operator cannot revoke it. */
const PERFORMER_FLOOR: readonly Capability[] = [
  "event.view",
  "deal.view.own",
  "settlement.view.own",
  "schedule.view",
  "rider.submit",
  "setlist.author",
  "settlement.confirm",
  "agreement.confirm",
  // Bring their own (sub-hire) crew — sponsored by the performer, scoped to the
  // performer's own reach (decisions #12; story.md sub-hire). Operator never sees it.
  "crew.submit",
];

/** A crew member's inviolable floor. */
const CREW_FLOOR: readonly Capability[] = [
  "event.view",
  "schedule.view",
  "deal.view.own",
  "settlement.view.own",
];

/** A crew LEAD also brings their own team — sponsored by the lead (decisions #12). */
const CREW_LEAD_FLOOR: readonly Capability[] = [...CREW_FLOOR, "crew.submit"];

/**
 * When a performer's participation is DELEGATED to their agent (decisions #14),
 * they keep their VIEW floor plus artistic authorship — the BUSINESS action
 * capabilities (confirm/approve) move to the agent. Delegation, not revocation:
 * they still see their own slice, and they still write their own setlist.
 */
const DELEGATED_PERFORMER_FLOOR: readonly Capability[] = [
  "event.view",
  "deal.view.own",
  "settlement.view.own",
  "schedule.view",
  // Authoring the setlist stays with the ACT even under full delegation. What a
  // performer hands an agent is BUSINESS authority (negotiate, confirm, approve),
  // never artistic content — story.md's boundary between the two kinds. Dropping
  // it here would leave nobody able to author: the agent preset does not carry it
  // (and the ceiling refuses it to an `agent` event role anyway), so the setlist
  // would be unwritable for exactly the acts that have representation.
  "setlist.author",
  // The rider is the ACT's own document too — its technical and hospitality
  // requirements (decisions #12: "riders are the performer's artifact"), not a
  // term anyone negotiates. Same argument as the setlist, and the same failure if
  // it is dropped: the agent preset does not carry `rider.submit` either, so a
  // represented performer had NOBODY who could attach their tech rider to the
  // show. That is what "riders cannot upload" looked like for every act with an
  // agent — a 403 on attach, from the party whose rider it is.
  "rider.submit",
];

/**
 * The FLOOR (decisions #4): inalienable capabilities per event-role that the
 * operator can never strip. Unioned into `effective` regardless of the
 * permission set. Operators/agents get their real authority from the band. When
 * `delegated` (a performer represented by an agent on this event), the floor
 * drops to view-only plus `setlist.author` (business moves, artistry does not).
 */
export function baselineCapabilities(role: EventRole, delegated = false): readonly Capability[] {
  if (delegated && (role === "performer" || role === "support")) {
    return DELEGATED_PERFORMER_FLOOR;
  }
  switch (role) {
    case "performer":
    case "support":
      return PERFORMER_FLOOR;
    case "crew_lead":
      return CREW_LEAD_FLOOR;
    case "crew":
      return CREW_FLOOR;
    default:
      return ["event.view"]; // host / co_host / agent
  }
}

/**
 * A party's role ON one deal (mirrors the DB `deal_party_role` enum). `observer`
 * is the read-only share (decisions #4: "sharing a deal = adding them as a
 * `deal_party` with `role_in_deal='observer'`") — an observer watches an
 * agreement, it never signs one.
 */
export type DealPartyRole = "payer" | "payee" | "split_member" | "commission" | "observer";

/** What standing as a SIGNATORY on one agreement confers — on that agreement alone. */
const DEAL_SIGNATORY_FLOOR: readonly Capability[] = ["agreement.confirm"];

/**
 * The event roles whose confirm authority is DEAL-scoped rather than event-scoped.
 *
 * Crew are arm's-length labour: story.md's boundary is that they "see the schedule
 * and their own deal, never the budget", so `CREW_FLOOR` is deliberately thin and
 * `agreement.confirm` is deliberately not in it. But an agreement only freezes once
 * EVERY non-observer party has signed, and a venue↔crew deal has exactly two — the
 * operator and the crew member. Without a way for the crew side to sign, such a deal
 * could be sent and could never reach `confirmed`: a dead end.
 *
 * The owner's rule (2026-08-26) is narrower than "crew get `agreement.confirm`":
 * *"crew can confirm an agreement if it is with them — if they are the payee."* So
 * this is NOT a floor capability. Crew still hold no `agreement.confirm` on the
 * event, which matters because that is exactly what `POST /events/:id/hold/confirm`
 * gates on, and no crew member decides whether the show happens. They hold it on ONE
 * agreement: the one carrying a signatory line they stand behind.
 *
 * Performers and their agents are deliberately absent. For them the EVENT floor
 * already answers the question, and the one case where it deliberately answers "no"
 * — a performer whose participation is delegated to their agent (decisions #14) — is
 * a case a deal-scoped re-grant would silently undo: they are still the payee on
 * their own line, so handing confirm back here would revoke the delegation the
 * agent's whole authority rests on.
 */
const DEAL_SCOPED_CONFIRM_EVENT_ROLES: ReadonlySet<EventRole> = new Set(["crew", "crew_lead"]);

/**
 * The DEAL-scoped floor (decisions #4's floor, resolved per agreement instead of
 * per event): what the caller may do on ONE deal purely by standing behind one of
 * its party lines. Composed by the route as
 * `effective_on_this_deal = effective_on_the_event ∪ ⋃ dealPartyBaselineCapabilities(...)`
 * over the caller's OWN lines, so it can only ever widen what the caller may do to
 * the very agreement they are named on.
 *
 * Everything it can return is below the ceiling by construction — no pool/budget
 * capability and no performer-authored capability is in `DEAL_SIGNATORY_FLOOR` —
 * which is asserted in `authorize.test.ts` rather than left to reading.
 */
export function dealPartyBaselineCapabilities(
  role: EventRole,
  roleInDeal: DealPartyRole,
): readonly Capability[] {
  if (roleInDeal === "observer") return [];
  if (!DEAL_SCOPED_CONFIRM_EVENT_ROLES.has(role)) return [];
  return DEAL_SIGNATORY_FLOOR;
}

/**
 * Pool/budget financials — never grantable to an arm's-length party.
 *
 * `settlement.edit` and `settlement.finalize` are here for the same reason
 * `budget.view` is, and their absence was a hole in the ceiling. `POST
 * /events/:id/settlement/compute` gates on `settlement.edit` and answers with
 * `serializeSummary`: the event POOL, every party's entitlement/collected/paid/
 * held/net, and every transfer between them. Nothing in that response is
 * party-scoped, because the only caller it was ever meant for is the operator
 * running the reconciliation. Neither capability appears in the `performer`,
 * `agent` or crew presets — but the ceiling is what makes that a rule instead of a
 * default, and until now an operator could hand a performer a permission set
 * carrying `settlement.edit` and the engine would have allowed it. story.md is
 * explicit that a performer sees only their own slice "even if an operator wanted
 * to show them (an inviolable ceiling)" — so this is the ceiling catching up with
 * the routes that grew under it.
 */
const POOL_CAPABILITIES: ReadonlySet<Capability> = new Set([
  "budget.view",
  "budget.edit",
  "revenue.edit",
  "settlement.edit",
  "settlement.finalize",
]);

/**
 * The ACT's own artistic content — authorable only by the act itself. Not even a
 * managing operator may be granted it: the operator *consumes* the setlist (the
 * PRO report) and the agent carries business authority, neither writes the songs
 * (decisions.md "Setlists"; story.md's operator/agent boundary).
 */
const PERFORMER_AUTHORED_CAPABILITIES: ReadonlySet<Capability> = new Set(["setlist.author"]);

/** The event roles that ARE the act — the only ones who may author its content. */
const PERFORMING_EVENT_ROLES: ReadonlySet<EventRole> = new Set(["performer", "support"]);

/**
 * The CEILING (decisions #4): what a relationship may be granted at all. Only the
 * managing operators (host/co_host) may ever hold pool/budget visibility — an
 * arm's-length party can never be granted it, even if a permission set lists it.
 */
export function isGrantable(capability: Capability, role: EventRole): boolean {
  // Checked BEFORE the operator short-circuit — host/co_host are not exempt from
  // the artistic boundary the way they are exempt from the pool ceiling.
  if (PERFORMER_AUTHORED_CAPABILITIES.has(capability)) {
    return PERFORMING_EVENT_ROLES.has(role);
  }
  if (OPERATOR_EVENT_ROLES.has(role)) {
    return true;
  }
  return !POOL_CAPABILITIES.has(capability);
}
