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
