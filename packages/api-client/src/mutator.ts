/**
 * The single HTTP client behind every generated query/mutation hook.
 *
 * Orval calls `customFetch(config)` for each endpoint; this is where the app's
 * cross-cutting concerns live in ONE place: the API base URL, the Firebase auth
 * token (`Authorization: Bearer`), the acting-profile header (`x-profile-id`),
 * and turning the API's typed error envelope into a thrown `ApiError`.
 *
 * The package stays framework-agnostic — it never reads `import.meta.env`. The
 * host app calls `configureApiClient(...)` once at startup to supply the base URL
 * and a token getter.
 */

export interface ApiClientConfig {
  /** API origin, e.g. "http://localhost:8080". No trailing slash needed. */
  baseUrl: string;
  /** Returns the current Firebase ID token (or null when signed out). */
  getToken?: () => string | null | Promise<string | null>;
  /** Returns the acting profile id for the `x-profile-id` header, if any. */
  getProfileId?: () => string | null;
}

let config: ApiClientConfig = { baseUrl: "" };

/** Wire the client once, at app startup, before any hook runs. */
export function configureApiClient(next: ApiClientConfig): void {
  config = next;
}

/** The API's typed error envelope: { error: { code, message, details? } }. */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The config shape orval's fetch client passes in. */
export interface RequestConfig {
  url: string;
  method: string;
  params?: Record<string, unknown>;
  data?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

function buildUrl(path: string, params?: Record<string, unknown>): string {
  const base = config.baseUrl.replace(/\/$/, "");
  const url = new URL(`${base}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export async function customFetch<T>(request: RequestConfig): Promise<T> {
  const token = config.getToken ? await config.getToken() : null;
  const profileId = config.getProfileId?.() ?? null;

  // Build via Headers so names dedupe case-insensitively — the generated client
  // may send `Content-Type` while we default `content-type`; a plain object would
  // keep both and `fetch` would join them into an invalid "application/json,
  // application/json" that the server rejects as 415.
  const headers = new Headers(request.headers);
  // ...and ONLY when there is a body to describe. A bodyless POST that still
  // declares `application/json` is rejected by Fastify with 400 "Body cannot be
  // empty when content-type is set to 'application/json'", which silently broke
  // every bodyless POST hook in the app — issuing an invoice, and every sibling
  // action shaped like it. The `verify-e2e` skill's `api-as.mjs` never hit this
  // because it omits the header entirely.
  if (request.data !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (profileId) headers.set("x-profile-id", profileId);

  const response = await fetch(buildUrl(request.url, request.params), {
    method: request.method,
    headers,
    body: request.data === undefined ? undefined : JSON.stringify(request.data),
    signal: request.signal,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    const envelope = payload as ApiErrorBody | undefined;
    throw new ApiError(
      response.status,
      envelope?.error?.code ?? "unknown",
      envelope?.error?.message ?? response.statusText,
      envelope?.error?.details,
    );
  }

  return payload as T;
}

export default customFetch;
