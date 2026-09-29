/** A thrown error carrying an HTTP status — mapped to a JSON body by the app's error handler. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const unauthorized = (message = "Unauthorized") =>
  new HttpError(401, message, "unauthorized");
export const forbidden = (message = "Forbidden") => new HttpError(403, message, "forbidden");
export const notFound = (message = "Not found") => new HttpError(404, message, "not_found");
export const badRequest = (message = "Bad request") => new HttpError(400, message, "bad_request");
export const conflict = (message = "Conflict", code = "conflict") =>
  new HttpError(409, message, code);
export const tooManyRequests = (message = "Too many requests") =>
  new HttpError(429, message, "too_many_requests");
/**
 * A dependency this route needs is not configured or not answering — the request
 * was fine and retrying later may work. Distinct from a 500 on purpose: an API
 * running without the Google client secret is a DEPLOYMENT state, not a bug, and
 * saying so lets the screen offer the right sentence instead of "something went
 * wrong" (see `lib/calendar-integration.ts`).
 */
export const serviceUnavailable = (message = "Service unavailable") =>
  new HttpError(503, message, "service_unavailable");

/**
 * The code for "these terms are sealed, reopen the agreement first".
 *
 * `apps/web/src/lib/errors.ts::TERMS_SEALED_CODE` reads exactly this, so ONE place turns it into a
 * sentence a promoter can act on — the same arrangement `ENTITLEMENT_REQUIRED_CODE` has, and for the
 * same reason. That refusal's own message names the FIELD that moved and the ROUTE to call next,
 * which is right for the assistant/agent-native surface (decisions #16.14) and wrong on a toast: a
 * venue operator was shown "so agreementBodyText cannot change … POST /deals/<uuid>/reopen"
 * (QA sweep run 12).
 *
 * A code and not a text match, because the other 409s on that route are already plain English
 * addressed to their reader — "Deal was changed by someone else; reload and retry", "Only a draft
 * agreement can be sent" — and a blanket rewrite of `code === "conflict"` would have replaced four
 * good sentences to fix one bad one.
 */
export const TERMS_SEALED_CODE = "terms_sealed";

/**
 * Did Postgres refuse this write because it collided with a unique index?
 *
 * SQLSTATE `23505`. It lives beside the HTTP constructors because that is the
 * only thing any caller does with the answer: a unique violation is how the
 * database says "someone already took this", and the honest reply is a 409 that
 * names what was taken. Four route files each carried an identical private copy
 * of this predicate; the constant is the kind of thing that must be spelt once.
 *
 * Deliberately structural rather than an `instanceof` check — the driver's error
 * class is not re-exported, and the shape (`{ code }`) is stable across both the
 * `pg` and `postgres.js` paths the app has used.
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
