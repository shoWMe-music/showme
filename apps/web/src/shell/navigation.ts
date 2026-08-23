import type { IconName } from "@showme/design-system";
import type { AccountKind } from "../auth/AuthProvider";

/** Every registered nav route. `to` is a real router path so navigation and
 * active-state highlighting stay in lockstep with the router. */
export type NavRoute =
  | "/"
  | "/calendar"
  | "/events"
  | "/tasks"
  | "/reports"
  | "/settlements"
  | "/projections"
  | "/requests"
  | "/invoices"
  | "/team"
  | "/contacts"
  | "/audience"
  | "/profiles"
  | "/settings";

export interface NavItem {
  label: string;
  icon: IconName;
  to: NavRoute;
  badge?: "requests";
  /** The account kinds this destination is offered to. See NAV below. */
  kinds: readonly AccountKind[];
}

/** The four account kinds, in the order story.md introduces them. */
export const ACCOUNT_KINDS: readonly AccountKind[] = [
  "operator",
  "performer",
  "team_and_crew",
  "agent",
];

/** Offered to every kind — the shared spine of the app. */
const EVERY_KIND = ACCOUNT_KINDS;

/**
 * THE navigation map — one place, not scattered `&&`s in the sidebar JSX.
 *
 * **This is navigation, not authorization.** Every route stays registered in
 * `router.tsx` and reachable by URL for every kind; the server decides who may
 * read what, and it already does (`authorize(capability)` + party-scoped SQL).
 * Do NOT "tidy" this into route guards — hiding a link the API would answer is
 * a *tidiness* choice; refusing the data is the API's, and duplicating it here
 * would be a second, weaker copy of the rule that drifts.
 *
 * What `kinds` encodes is the honest question "can this kind ever have anything
 * on this screen, and is the screen's purpose theirs?" — grounded in docs/story.md
 * (purpose + boundary) and checked against the route behind each item. Order is
 * the render order (screen-specs §0.1); the operator set is unchanged.
 */
export const NAV: readonly NavItem[] = [
  { label: "Dashboard", icon: "grid", to: "/", kinds: EVERY_KIND },
  // Personal calendar items (`GET /calendar`, owner-scoped) over the events the
  // caller participates in — everyone has a schedule.
  { label: "Calendar", icon: "calendar", to: "/calendar", kinds: EVERY_KIND },
  // `GET /events` is participant-reachable (events ⋈ event_participants ⋈
  // profile_members), so every kind sees the events it is actually on.
  { label: "Events", icon: "calendar-check", to: "/events", kinds: EVERY_KIND },
  // `GET /tasks` = the caller's own + their profiles' + an event's shared to-do.
  { label: "Tasks", icon: "check", to: "/tasks", kinds: EVERY_KIND },
  // Operator only. This screen is the PRO *filing* — every card's only action is
  // "Report to STIM · Not filed" — and decisions.md #627-629 puts the report on
  // the operator (`setlist_reports`) and the setlist on the performer.
  //   · performer — authors the setlist, never files it; their surface is the
  //     Setlists screen, which does not exist yet (the rest of A-25).
  //   · team_and_crew — "crew are NOT a core consumer" (decisions.md #631); they
  //     only ever see a setlist explicitly shared to their participant row.
  //   · agent — a booking agent handles live bookings only, "not publishing"
  //     (story.md); PRO royalties are the writer's income, not the agent's.
  { label: "Performance Reports", icon: "trending-up", to: "/reports", kinds: ["operator"] },
  // `GET /settlements` is party-scoped: one settlement row per participant, so a
  // performer's payouts, a crew fee and an agent's net-0 line all live here. This
  // is the money screen for everyone — never cut it for looking operator-ish.
  { label: "Settlements", icon: "receipt", to: "/settlements", kinds: EVERY_KIND },
  // Operator only. `GET /insights/profiles/:id/{summary,revenue}` aggregates over
  // `events.host_profile_id` and the event budget, and `POST /events` refuses any
  // non-operator profile ("Only operator profiles can create events") — so a
  // performer / crew / agent profile hosts nothing and this screen is 0 forever.
  // story.md also forbids it: a performer "never sees the event budget/pool", and
  // crew "see the schedule and their own deal, never the budget".
  { label: "Financial Projections", icon: "trending-up", to: "/projections", kinds: ["operator"] },
  // "Requests", not "Incoming Requests" — the page carries both directions and
  // names the active one itself; a fixed "Incoming" here contradicts the Outgoing
  // view. Membership-scoped both ways: an operator triages, a performer sends
  // offers, an agent sends them on behalf of an act, and a team_and_crew profile
  // is a valid target of the public form (and the front door of the future
  // team-and-crew marketplace, story.md).
  { label: "Requests", icon: "inbox", to: "/requests", badge: "requests", kinds: EVERY_KIND },
  // Invoices are owner-profile-scoped with a direction (`issued` | `received`):
  // a performer bills their fee, crew bills labor, an agent bills commission.
  // The money-out layer belongs to whoever is paid (decisions.md #5).
  { label: "Bills & Invoices", icon: "file", to: "/invoices", kinds: EVERY_KIND },
  // Groups are user-owned and cross-profile, and "anyone may bring crew, not just
  // the operator" (decisions.md #12) — `POST /events/:id/groups` accepts the
  // `crew.submit` floor held by performer / support / agent / crew_lead.
  { label: "Team", icon: "users", to: "/team", kinds: EVERY_KIND },
  // A per-profile address book of counterparties with their payout identity
  // (IBAN / VAT). Everyone who invoices someone keeps one; for an agent the
  // promoter book *is* the job.
  { label: "Contacts", icon: "building", to: "/contacts", kinds: EVERY_KIND },
  // The fan CRM — ticket buyers, newsletter, socials. Owned by whoever the
  // audience belongs to: the operator's room and the performer's following.
  //   · team_and_crew — an arm's-length service provider paid a fee for labor,
  //     "not talent" (story.md); a FOH engineer has no fanbase in shoWMe.
  //   · agent — the performer's "merch and broader career are theirs — not their
  //     booking agent's" (story.md); the fanbase is the act's, not the agency's.
  // (It is empty for operator and performer too, but for a different reason: no
  // audience read endpoint exists yet. That is a missing screen, not a kind rule.)
  { label: "Audience", icon: "users", to: "/audience", kinds: ["operator", "performer"] },
  { label: "My Profiles", icon: "user", to: "/profiles", kinds: EVERY_KIND },
  { label: "Settings", icon: "settings", to: "/settings", kinds: EVERY_KIND },
];

/**
 * The sidebar for one account kind, in render order.
 *
 * `kind` is the ACCOUNT kind (`users.kind`), which is fixed at signup and is what
 * decides "the entire app the user sees" (story.md). It is also the kind of every
 * profile the user creates — `POST /profiles` refuses any other ("A profile's kind
 * must match your account kind") — so the account kind and the acting profile's
 * kind agree for every profile the user owns.
 *
 * A null session cannot happen here (the router only mounts once the session is
 * `authed`), so it falls back to the items every kind holds rather than to the
 * widest set: an unknown viewer should see less, not more.
 */
export function navigationFor(kind: AccountKind | null): NavItem[] {
  return NAV.filter((item) =>
    kind ? item.kinds.includes(kind) : item.kinds.length === ACCOUNT_KINDS.length,
  );
}

/**
 * Is this destination one the account kind can actually hold data for? The same
 * mapping the sidebar reads, asked per route — because the routes stay REGISTERED
 * for every kind on purpose (hiding a link is navigation, not authorization), and
 * a screen reached by URL should say so plainly instead of firing requests the
 * server will rightly refuse. Driving `/projections` as the agent fired four 403s
 * on the event budget: correct refusals, useless screen.
 */
export function isDestinationForKind(route: NavRoute, kind: AccountKind | null): boolean {
  const item = NAV.find((navigationItem) => navigationItem.to === route);
  if (!item) return true; // a route with no sidebar entry is nobody's to hide
  return kind ? item.kinds.includes(kind) : true;
}
