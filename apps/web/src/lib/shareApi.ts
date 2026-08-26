/**
 * The share viewer's own HTTP client.
 *
 * Everything else in the app talks to the API through the generated hooks, whose
 * mutator attaches a Firebase ID token. A share recipient has no Firebase
 * account — that is the entire point of the surface — so their credential is a
 * different scheme on the same header: `Authorization: ShareBearer <jwt>`, minted
 * by `POST /shares/:token/verify` after the one-time code. Bending the shared
 * mutator to know about a second credential would put off-platform auth into
 * every authenticated request in the app; a small dedicated client keeps it where
 * it belongs.
 *
 * WHERE THE JWT LIVES: `sessionStorage`, keyed by the share token. Not
 * `localStorage` — a 24-hour grant on a borrowed or shared machine should not
 * outlive the tab it was opened in — and not a cookie, because the API is on
 * another origin and CORS here runs with `credentials: false` by deliberate
 * design (see `corsOptions` in the API).
 *
 * THE TOKEN IS THE GRANT. It is a path segment, so it must not be logged, put in
 * an error message, or sent anywhere except the API. The API masks it on its side
 * (`apps/api/src/logging.ts`); this file never console-logs a URL.
 */

const API_BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:8080").replace(/\/$/, "");

const storageKey = (token: string) => `showme.share.${token}`;

export function storedShareJwt(token: string): string | null {
  try {
    return window.sessionStorage.getItem(storageKey(token));
  } catch {
    // Private-mode Safari throws on sessionStorage. Losing the credential means
    // one more code, which is a far better failure than a blank page.
    return null;
  }
}

export function storeShareJwt(token: string, jwt: string): void {
  try {
    window.sessionStorage.setItem(storageKey(token), jwt);
  } catch {
    /* see above — the viewer works without persistence, just not across reloads */
  }
}

export function forgetShareJwt(token: string): void {
  try {
    window.sessionStorage.removeItem(storageKey(token));
  } catch {
    /* nothing to forget */
  }
}

/** The API's typed error envelope, as the viewer needs to read it. */
export class ShareApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ShareApiError";
  }
}

async function request<T>(
  path: string,
  init: { method: string; body?: unknown; jwt?: string | null },
): Promise<T> {
  const headers = new Headers();
  if (init.body !== undefined) headers.set("content-type", "application/json");
  if (init.jwt) headers.set("authorization", `ShareBearer ${init.jwt}`);

  const response = await fetch(`${API_BASE}${path}`, {
    method: init.method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const envelope = payload as { error?: { code?: string; message?: string } } | undefined;
    throw new ShareApiError(
      response.status,
      envelope?.error?.code ?? "unknown",
      envelope?.error?.message ?? response.statusText,
    );
  }
  return payload as T;
}

export function fetchShareDocument<T>(token: string, jwt: string | null): Promise<T> {
  return request(`/api/v1/shares/${token}/document`, { method: "GET", jwt });
}

export function requestShareCode(token: string, email: string): Promise<{ sent: true }> {
  return request(`/api/v1/shares/${token}/otp`, { method: "POST", body: { email } });
}

export async function verifyShareCode(token: string, email: string, code: string): Promise<string> {
  const result = await request<{ token: string }>(`/api/v1/shares/${token}/verify`, {
    method: "POST",
    body: { email, code },
  });
  storeShareJwt(token, result.token);
  return result.token;
}

export function postShareComment(
  token: string,
  jwt: string | null,
  input: { message: string; section?: string },
): Promise<{ id: string }> {
  return request(`/api/v1/shares/${token}/comment`, { method: "POST", body: input, jwt });
}

export function postShareApproval(
  token: string,
  jwt: string | null,
  input: { subject: "settlement" | "agreement"; dealId?: string },
): Promise<{ approvedAt: string }> {
  return request(`/api/v1/shares/${token}/approve`, { method: "POST", body: input, jwt });
}
