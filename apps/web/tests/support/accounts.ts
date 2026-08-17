import { fileURLToPath } from "node:url";
import { E2E_ACCOUNTS, type E2eAccountName } from "@showme/shared";

/**
 * Re-exports the canonical E2E accounts (single source of truth in
 * `@showme/shared`) plus the on-disk location of each account's saved auth
 * state. The `setup` project logs each account in once and writes its Firebase
 * session here; every other test reuses it via `storageState` instead of paying
 * for a UI login per test.
 */
export { E2E_ACCOUNTS };
export type { E2eAccountName };

/** Where the `setup` project persists each account's authenticated state. */
export function authFile(name: E2eAccountName): string {
  return fileURLToPath(new URL(`../.auth/${name}.json`, import.meta.url));
}
