/**
 * Canonical end-to-end test accounts — the single source of truth shared by the
 * three things that must agree on them:
 *   1. the Firebase Auth **emulator** seed (creates these users with pinned uids),
 *   2. the Postgres seed (`@showme/db` — inserts the matching rows + data), and
 *   3. the Playwright harness (`apps/web/tests` — logs in as each one).
 *
 * The linchpin is that Postgres stores the Firebase uid as `users.id`, so each
 * account's `uid` here IS its Postgres primary key. Pinning the uid keeps the
 * two seeds in lockstep without any lookup.
 *
 * Emulator-only: these are demo-project credentials with a shared throwaway
 * password. They never exist in a real Firebase project.
 */

export type E2eAccountKind = "operator" | "performer" | "team_and_crew" | "agent";

export interface E2eAccount {
  /** Firebase uid — also the Postgres `users.id`. Stable across runs. */
  readonly uid: string;
  readonly email: string;
  readonly password: string;
  /** Firebase `displayName` + Postgres `users.name`. */
  readonly displayName: string;
  readonly kind: E2eAccountKind;
  /** Public name of this account's primary profile. */
  readonly profileName: string;
}

/** One throwaway password for every emulator account (min 6 chars for Firebase). */
export const E2E_PASSWORD = "Test123!pass";

/**
 * Keyed accounts. `performerA`/`performerB` are two distinct performers so a test
 * can exercise performer↔performer interaction; `agent` represents `performerA`;
 * `teamAndCrew` is booked as crew on the operator's event. The cross-wiring
 * itself lives in the Postgres seed — this file only names the actors.
 */
export const E2E_ACCOUNTS = {
  operator: {
    uid: "e2e-operator",
    email: "operator@e2e.showme.test",
    password: E2E_PASSWORD,
    displayName: "The Lantern Hall (operator)",
    kind: "operator",
    profileName: "The Lantern Hall",
  },
  performerA: {
    uid: "e2e-performer-a",
    email: "performer.a@e2e.showme.test",
    password: E2E_PASSWORD,
    displayName: "Marlo Vance",
    kind: "performer",
    profileName: "Marlo Vance",
  },
  performerB: {
    uid: "e2e-performer-b",
    email: "performer.b@e2e.showme.test",
    password: E2E_PASSWORD,
    displayName: "Neon Tide",
    kind: "performer",
    profileName: "Neon Tide",
  },
  teamAndCrew: {
    uid: "e2e-professional",
    email: "professional@e2e.showme.test",
    password: E2E_PASSWORD,
    displayName: "Priya Sound (FOH engineer)",
    kind: "team_and_crew",
    profileName: "Priya Sound",
  },
  agent: {
    uid: "e2e-agent",
    email: "agent@e2e.showme.test",
    password: E2E_PASSWORD,
    displayName: "Astra Booking",
    kind: "agent",
    profileName: "Astra Booking Agency",
  },
} as const satisfies Record<string, E2eAccount>;

export type E2eAccountName = keyof typeof E2E_ACCOUNTS;

/** All accounts as a list — what the two seeds iterate over. */
export const E2E_ACCOUNT_LIST: readonly E2eAccount[] = Object.values(E2E_ACCOUNTS);
