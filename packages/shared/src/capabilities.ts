/**
 * The capability catalog — the fixed vocabulary the authorization engine grants
 * and checks. Stored per permission set as `permission_sets.capabilities text[]`.
 *
 * `deal.view.all` / `settlement.view.all` are deliberately absent: decisions.md
 * #4 dropped them. Deal and settlement visibility is PURE party-scoping — you
 * see a deal iff you are one of its `deal_parties`. The operator's broad view is
 * emergent from being a party on the event's main deals, not a see-everything
 * capability.
 */
export const CAPABILITIES = [
  // Event
  "event.view",
  "event.edit",
  "event.delete",
  "event.publish",
  "event.send_info_email",
  "participants.manage",

  // Deals & budget
  "deal.view.own",
  "deal.edit",
  "budget.view",
  "budget.edit",
  "revenue.edit",

  // Settlement
  "settlement.view.own",
  "settlement.edit",
  "settlement.confirm",
  "settlement.finalize",

  // Event content
  "rider.submit",
  "rider.view",
  "schedule.view",
  "schedule.edit",
  "crew.manage",
  "crew.submit",
  "agreement.manage",
  "agreement.confirm",
  "message.post",

  // Profile & administration
  "profile.edit",
  "members.manage",
  "templates.manage",
  "permission.grant_admin",
] as const;

/** One of the known capabilities. */
export type Capability = (typeof CAPABILITIES)[number];

const CAPABILITY_SET: ReadonlySet<Capability> = new Set(CAPABILITIES);

/** Narrows an arbitrary string to a known `Capability`. */
export function isCapability(value: string): value is Capability {
  return CAPABILITY_SET.has(value as Capability);
}
