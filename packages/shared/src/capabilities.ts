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
  // Authoring the ACT's setlist. Deliberately its own capability, not
  // `schedule.*`: the run-of-show is the operator's and the crew's, the setlist
  // is the performer's artistic content (decisions.md "Setlists" — performer
  // authors, operator only *reports* on it, crew see it only when shared).
  "setlist.author",
  // Filing the show's performed-works report with the collecting society — the
  // OTHER half of the setlist module (decisions.md "Setlists": performer authors,
  // operator reports). Deliberately not `setlist.author` inverted and deliberately
  // not folded into `budget.edit`: the filing is an act performed in the
  // operator's name toward an outside body, so it wants a name of its own, and a
  // 403 on it should say what was refused. The ceiling restricts it to the
  // managing operator, so a performer can never hold it even if granted.
  "performance_report.file",
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

/**
 * THE CAPABILITIES THAT MAKE SOMEONE AN ADMINISTRATOR OF AN EVENT — the ones that
 * let a collaborator reshape who stands on it, hand out authority of their own, or
 * destroy it.
 *
 * This is the narrow, honest core of the `MANAGEMENT_CAPABILITIES` notion in
 * `packages/auth/src/presets.ts`. The routine management an ordinary booking needs
 * — `agreement.manage` (every agent holds it), `crew.manage` (every crew lead),
 * `templates.manage` — is deliberately NOT here, because paywalling those would
 * paywall normal booking rather than the act of making someone an admin. Plain
 * `event.edit` is absent for the same reason: a collaborator who can rename an
 * event has not been made an administrator of it. PLAN.md:614 draws the line at
 * *"assign `operator_full`/admin permission set to a collaborator"* — at ADMIN.
 *
 * IT LIVES IN `shared` BECAUSE BOTH SIDES ASK THE QUESTION, and they must not
 * answer it differently. The API charges the `grant_admin` entitlement on it
 * (`assertGrantAdminAllows`). The web app describes a collaborator's access with
 * it — and before it could, the roster compared permission-set IDS against the
 * host's, which reported the seeded co-host (a different row carrying an identical
 * `operator_full` list) as having no special access at all (ClickUp 86cbazcc7).
 * Authority is what a set GRANTS, never which row it is.
 */
export const ADMIN_GRADE_CAPABILITIES: readonly Capability[] = [
  "participants.manage",
  "permission.grant_admin",
  "event.delete",
  "members.manage",
];

/** Does this permission set hand its holder admin-grade authority over the event? */
export function confersAdminAuthority(capabilities: readonly string[] | null | undefined): boolean {
  if (!capabilities) return false;
  return capabilities.some((capability) =>
    (ADMIN_GRADE_CAPABILITIES as readonly string[]).includes(capability),
  );
}
