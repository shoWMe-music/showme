/**
 * What an operator can put on a share link, in the words they would use.
 *
 * The vocabulary IS the capability catalog (`packages/shared/src/capabilities.ts`)
 * — one entry per capability a share may carry, with a plain-English name and a
 * sentence saying what the recipient will actually see. There is deliberately no
 * second list of "section ids" beside it: the old app's Share & Export tree
 * exposed twenty-one hardcoded ones (`budget-calculator`, `deal-structure`,
 * `guest-list`, …) that the server had no way to enforce, so what the tick-box
 * promised and what the link served were two different systems.
 *
 * Here the tick-box IS the grant. `apps/api/src/lib/share-scope.ts` holds the same
 * list on the server and refuses anything outside it, so this file cannot offer a
 * scope the API would not honour.
 */

export interface ShareScope {
  /** The capability, exactly as the API stores it in `shares.capabilities`. */
  readonly capability: string;
  readonly label: string;
  readonly description: string;
  /** Reading vs acting — the dialog groups them, because they are different asks. */
  readonly kind: "view" | "act";
}

export const SHARE_SCOPES: readonly ShareScope[] = [
  {
    capability: "event.view",
    label: "Event details",
    description: "Title, date, venue, capacity and the notes on the show.",
    kind: "view",
  },
  {
    capability: "schedule.view",
    label: "Schedule",
    description: "The run of show — load-in, soundcheck, doors, set times.",
    kind: "view",
  },
  {
    capability: "rider.view",
    label: "Riders & documents",
    description: "Their own rider and the venue's house documents. Never another act's.",
    kind: "view",
  },
  {
    capability: "budget.view",
    label: "Budget",
    description:
      "The shared ledger and its totals. A performer or crew recipient will not see this — the authorization ceiling refuses it whatever the link says.",
    kind: "view",
  },
  {
    capability: "deal.view.own",
    label: "Their deal",
    description: "The agreement, and only the line that belongs to them.",
    kind: "view",
  },
  {
    capability: "settlement.view.own",
    label: "Their settlement",
    description: "Their own entitlement, what is held, and what they are owed.",
    kind: "view",
  },
  {
    capability: "agreement.confirm",
    label: "Confirm the agreement",
    description: "Lets them sign off their own line on the deal.",
    kind: "act",
  },
  {
    capability: "settlement.confirm",
    label: "Approve the settlement",
    description: "Lets them approve the figures as their party.",
    kind: "act",
  },
  {
    capability: "message.post",
    label: "Comment",
    description: "Lets them reply, per section, on what they were shown.",
    kind: "act",
  },
];

/** The capability a scope's "act" depends on being shared alongside it. */
const REQUIRES: Record<string, string> = {
  "agreement.confirm": "deal.view.own",
  "settlement.confirm": "settlement.view.own",
};

/**
 * Add whatever a chosen scope cannot work without.
 *
 * Approving a settlement you were not shown is not a thing anyone should be asked
 * to do, so ticking "Approve the settlement" also shares it. Done here rather than
 * in the modal so the rule is testable and the component stays a renderer.
 */
export function withRequiredScopes(chosen: readonly string[]): string[] {
  const capabilities = new Set(chosen);
  for (const capability of chosen) {
    const required = REQUIRES[capability];
    if (required) capabilities.add(required);
  }
  return SHARE_SCOPES.filter((scope) => capabilities.has(scope.capability)).map(
    (scope) => scope.capability,
  );
}

/**
 * May this operator put this scope on a link?
 *
 * Normally: do they hold the capability on the event. **Riders are the exception**,
 * and it mirrors `apps/api/src/lib/share-scope.ts`'s `hasReach` exactly, which in
 * turn mirrors `routes/riders.ts`: no operator permission set carries `rider.view`
 * at all, and an operator's all-rider reach comes from being a MANAGING operator —
 * the same thing `budget.view` marks. Without this the Riders tick-box was greyed
 * out for every operator on every event, which is precisely the dead affordance
 * the style guide forbids: a control offered and never usable.
 */
export function canShareScope(capability: string, held: ReadonlySet<string>): boolean {
  if (held.has(capability)) return true;
  return capability === "rider.view" && held.has("budget.view");
}

/** The label for a capability, for the "this link shares…" summary lines. */
export function shareScopeLabel(capability: string): string {
  return SHARE_SCOPES.find((scope) => scope.capability === capability)?.label ?? capability;
}

/** The absolute URL a recipient opens. The token IS the grant — never log this. */
export function shareUrl(token: string): string {
  return `${window.location.origin}/shares/${token}`;
}
