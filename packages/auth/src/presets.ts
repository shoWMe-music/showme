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
 * they keep only their VIEW floor — the action capabilities (confirm/approve) move
 * to the agent. Delegation, not revocation: they still see their own slice.
 */
const DELEGATED_PERFORMER_FLOOR: readonly Capability[] = [
  "event.view",
  "deal.view.own",
  "settlement.view.own",
  "schedule.view",
];

/**
 * The FLOOR (decisions #4): inalienable capabilities per event-role that the
 * operator can never strip. Unioned into `effective` regardless of the
 * permission set. Operators/agents get their real authority from the band. When
 * `delegated` (a performer represented by an agent on this event), the floor
 * drops to view-only.
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

/** Pool/budget financials — never grantable to an arm's-length party. */
const POOL_CAPABILITIES: ReadonlySet<Capability> = new Set([
  "budget.view",
  "budget.edit",
  "revenue.edit",
]);

/**
 * The CEILING (decisions #4): what a relationship may be granted at all. Only the
 * managing operators (host/co_host) may ever hold pool/budget visibility — an
 * arm's-length party can never be granted it, even if a permission set lists it.
 */
export function isGrantable(capability: Capability, role: EventRole): boolean {
  if (OPERATOR_EVENT_ROLES.has(role)) {
    return true;
  }
  return !POOL_CAPABILITIES.has(capability);
}
