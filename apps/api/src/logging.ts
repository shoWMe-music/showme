import type { FastifyRequest, FastifyServerOptions } from "fastify";

/**
 * Structured logging, shaped for Cloud Logging.
 *
 * The API ran with `logger: false` until 2026-08-26, so every production 500
 * reached the browser as an empty envelope with nothing behind it — the
 * `request.log.error(error)` in `apiErrorHandler` was writing to a no-op. This
 * module is what makes that line real.
 *
 * Three things Cloud Logging wants that pino does not emit by default:
 *
 * - the level must be a **`severity` string**, not pino's numeric `level`;
 * - the human-readable text must be under **`message`**, not pino's `msg`;
 * - the entry time must be RFC3339 under **`timestamp`**, or the entry is
 *   stamped with its ingestion time rather than when it actually happened.
 *
 * And one thing this app in particular wants: an off-platform share is
 * authorized by a token carried **in the URL path** (`/shares/:token`, see
 * `routes/shares.ts`). Logging raw URLs would therefore print a live capability
 * grant into Cloud Logging on every single request to that route — so URLs are
 * sanitized on the way out, and the request serializer never emits headers at
 * all.
 */

/** What replaces a secret in a log line. */
const REDACTED = "[redacted]";

/** pino's level label → the severity string Cloud Logging understands. */
const CLOUD_LOGGING_SEVERITY: Record<string, string> = {
  trace: "DEBUG",
  debug: "DEBUG",
  info: "INFO",
  warn: "WARNING",
  error: "ERROR",
  fatal: "CRITICAL",
};

/**
 * Path segments after which the NEXT segment is a secret rather than an
 * identifier. `/api/v1/shares/<token>/otp` → `/api/v1/shares/[redacted]/otp`.
 */
const SECRET_AFTER_SEGMENT = new Set(["shares"]);

/** Query parameters that carry a secret. */
const SECRET_QUERY_PARAMETERS = ["token", "code", "otp"];

/** Mask the path segments that are capability grants, not identifiers. */
function sanitizePath(path: string): string {
  const segments = path.split("/");
  return segments
    .map((segment, index) =>
      SECRET_AFTER_SEGMENT.has(segments[index - 1] ?? "") ? REDACTED : segment,
    )
    .join("/");
}

/** Mask the query parameters that carry secrets, leaving the rest readable. */
function sanitizeQuery(query: string): string {
  const parameters = new URLSearchParams(query);
  let masked = false;
  for (const name of SECRET_QUERY_PARAMETERS) {
    if (parameters.has(name)) {
      parameters.set(name, REDACTED);
      masked = true;
    }
  }
  // Only re-encode when something actually changed, so ordinary URLs are logged
  // exactly as they arrived rather than in URLSearchParams' normalized form.
  return masked ? parameters.toString() : query;
}

/** Strip every secret out of a request URL before it reaches a log line. */
export function sanitizeUrl(url: string): string {
  const separator = url.indexOf("?");
  if (separator === -1) return sanitizePath(url);
  return `${sanitizePath(url.slice(0, separator))}?${sanitizeQuery(url.slice(separator + 1))}`;
}

/**
 * The logger Fastify is built with. `false` under test so 419 API tests stay
 * silent; otherwise structured JSON on stdout, which is exactly what Cloud Run
 * forwards to Cloud Logging.
 */
export function loggerOptions(
  environment: NodeJS.ProcessEnv = process.env,
): FastifyServerOptions["logger"] {
  if (environment.NODE_ENV === "test") return false;

  return {
    level: environment.LOG_LEVEL ?? "info",
    messageKey: "message",
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    formatters: {
      level: (label: string) => ({ severity: CLOUD_LOGGING_SEVERITY[label] ?? "DEFAULT" }),
    },
    // The serializers below already withhold every header, so this is a second
    // line of defence for anything that logs a request or a token by hand.
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "*.headers.authorization",
        "*.authorization",
        "*.token",
        "*.password",
      ],
      censor: REDACTED,
    },
    serializers: {
      // Deliberately no `headers` — the Authorization header is a Firebase ID
      // token, and there is no diagnosis it helps with that the route and the
      // resolved principal do not.
      req: (request: FastifyRequest) => ({
        method: request.method,
        url: sanitizeUrl(request.url),
        route: request.routeOptions?.url,
        remoteAddress: request.ip,
      }),
      // Structurally typed rather than `FastifyReply`: pino hands the response
      // serializer a reply-like whose `routeOptions` is optional, which the full
      // FastifyReply type does not admit.
      res: (reply: { statusCode: number }) => ({ statusCode: reply.statusCode }),
    },
  };
}
