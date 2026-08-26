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
export const conflict = (message = "Conflict") => new HttpError(409, message, "conflict");
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
