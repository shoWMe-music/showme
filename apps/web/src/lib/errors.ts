import { ApiError } from "@showme/api-client";

/**
 * The API's code for a PLAN-LIMIT refusal, mirroring
 * `apps/api/src/lib/entitlements.ts::ENTITLEMENT_REQUIRED_CODE`.
 *
 * Both 403s the API can send look identical on the wire apart from this code, and
 * they mean opposite things: `forbidden` = "you may not do this to that", which no
 * amount of money fixes; `entitlement_required` = "your plan doesn't include this",
 * which an upgrade fixes. Matching on the code — never on the message TEXT — is what
 * lets ONE component answer every plan gate in the app without a copy of the upgrade
 * sentence in each screen.
 */
export const ENTITLEMENT_REQUIRED_CODE = "entitlement_required";

/**
 * A PERMISSION REFUSAL IN WORDS, not in the vocabulary of the authorization engine.
 *
 * The API says `Missing capability: deal.view.own`, which is exactly right for a
 * developer reading a response and wrong for the person holding the screen: it names
 * an internal identifier, implies they did something incorrectly, and offers no way
 * forward. Measured 2026-09-26 in two places — a view-only co-operator's Deals tab
 * printed it as the whole explanation, and a performer pressing a Remove they were
 * never meant to have got it as a toast.
 *
 * Matched on the STATUS plus the message shape, never on the capability name: a new
 * capability must not need a new line here. Plan refusals are a different 403 and
 * keep their own message (`ENTITLEMENT_REQUIRED_CODE`), because an upgrade does fix
 * those.
 */
export function isPermissionRefusal(error: unknown): boolean {
  return (
    error instanceof ApiError && error.status === 403 && error.code !== ENTITLEMENT_REQUIRED_CODE
  );
}

function permissionRefusal(error: ApiError): string | null {
  if (error.status !== 403) return null;
  if (error.code === ENTITLEMENT_REQUIRED_CODE) return null;
  return "This part of the event isn't shared with you. Ask the host if you need it.";
}

/** Pull a human-friendly message out of an unknown query/mutation error. */
export function errorMessage(error: unknown, fallback = "Something went wrong."): string {
  if (error instanceof ApiError) return permissionRefusal(error) ?? error.message ?? fallback;
  if (error instanceof Error) return error.message || fallback;
  return fallback;
}

/** Did the API refuse this because of the account's PLAN (rather than its permissions)? */
export function isEntitlementError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code === ENTITLEMENT_REQUIRED_CODE;
}

/**
 * The specific, factual reason behind a plan refusal ("Free plan event limit
 * reached") — the line the upgrade notice shows UNDER its standing copy, so the
 * user learns which limit they met. `null` for anything that is not a plan refusal.
 */
export function entitlementReason(error: unknown): string | null {
  if (!isEntitlementError(error)) return null;
  return error.message.trim() || null;
}
