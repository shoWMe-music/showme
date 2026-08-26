import type { NormalizedExternalEvent } from "./external-calendar";

/**
 * THE GOOGLE ADAPTER — everything provider-shaped, and nothing else.
 *
 * `lib/external-calendar.ts` is the seam: hand it `NormalizedExternalEvent`s and
 * it makes `calendar_items` agree with them, idempotently, without knowing where
 * they came from. This module is the other side of that line. It is the only file
 * in the repo that knows what a `nextSyncToken` is, that `end.date` is exclusive,
 * or that `invalid_grant` is a sentence a user needs to read.
 *
 * NO SDK, ON PURPOSE. `googleapis` is ~40MB of generated client for four HTTP
 * calls, on a service that scales to zero and pays for its own cold starts. The
 * rest of the codebase already calls Brevo and ClickUp with `fetch` (`lib/email.ts`);
 * this is the same trade, and `fetch` is injectable, which is what makes the
 * normalisation testable without a network.
 *
 * ── WHAT THE SCOPE BUYS ──────────────────────────────────────────────────────
 * `calendar.events` and nothing more. Verified against the live API: under it,
 * `calendars.get` and `calendarList.get` both answer 403. That is why the account
 * identity and the calendar's timezone are read off the `events.list` response's
 * own `summary`/`timeZone` fields rather than from a metadata call, and why the
 * consent screen does not ask for `openid email`.
 *
 * ── THE FOUR TRAPS IN GOOGLE'S EVENT SHAPE ───────────────────────────────────
 * 1. **All-day vs timed.** `start.date` (a bare day) or `start.dateTime` (an
 *    instant). They are never both present and the code must branch on which.
 * 2. **`end.date` is EXCLUSIVE.** A one-day holiday on the 10th arrives as
 *    `start.date = 10th, end.date = 11th`. Storing that verbatim blocks two days.
 * 3. **`status: "cancelled"` is a DELETION, not a skip.** Skipping it leaves the
 *    row in place and the night blocked forever by a meeting that is not happening.
 * 4. **Recurrence.** Without `singleEvents=true` a weekly coffee is ONE event
 *    carrying an RRULE, and importing it blocks exactly one morning ever. With it,
 *    Google expands the series into instances that each carry their own id.
 *
 * ── AND THE ONE THAT IS NOT IN THE SHAPE ─────────────────────────────────────
 * **Daylight saving.** Google returns `2026-10-14T09:00:00+02:00` and
 * `2026-11-04T09:00:00+01:00` for the same recurring 09:00 coffee — the offset
 * moves, the wall clock does not. Anything that reads an offset once and applies
 * it to the rest of the year shifts every winter entry by an hour. Every
 * conversion here goes through `Intl` with an IANA zone, which consults the
 * tzdata for THAT instant.
 */

/* ─────────────────────────────────────────────────────── the OAuth client ─── */

export interface GoogleOAuthClient {
  clientId: string;
  /** NEVER sent to a browser. The exchange happens here, in the API. */
  clientSecret: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImplementation?: typeof fetch;
}

/** Exactly what the calendar integration needs; Google returns more. */
export interface GoogleTokenGrant {
  accessToken: string;
  /** Present only on the FIRST consent (`prompt=consent` forces it). */
  refreshToken: string | null;
  scope: string;
  expiresInSeconds: number;
}

/**
 * The user revoked us. Google says `invalid_grant`, and it is an ordinary event —
 * anybody may withdraw access from their Google account page at any time — so it
 * gets its own type and the caller records it as connection state rather than
 * letting a 500 escape on every subsequent sync.
 */
export class GoogleAuthorizationRevokedError extends Error {
  constructor(readonly detail: string) {
    super("Google access was revoked or expired — reconnect the calendar");
    this.name = "GoogleAuthorizationRevokedError";
  }
}

/** Any other non-2xx from Google, carrying enough to log without leaking a token. */
export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`Google Calendar API error (${status}): ${detail.slice(0, 300)}`);
    this.name = "GoogleApiError";
  }
}

/**
 * A stored sync token has aged out (410 GONE). Not a failure: it means "start
 * over with a full listing", and the caller does exactly that.
 */
export class GoogleSyncTokenExpiredError extends Error {
  constructor() {
    super("The stored sync token expired — a full re-listing is required");
    this.name = "GoogleSyncTokenExpiredError";
  }
}

export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
export const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

/**
 * The only scope asked for: read AND write events on the user's calendars.
 * Write is needed because the outbound mirror (`mirrorPayloadForEvent`) pushes
 * shoWMe events back — asking for it once is better than a second consent screen
 * the day that ships. It does NOT grant the calendar list, sharing settings, or
 * any identity claim.
 */
export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

/**
 * Where Google is allowed to send the user back. An ALLOW-LIST, not a parameter,
 * even though the value also has to be registered in the Google Cloud console: a
 * redirect the caller may choose freely is how an authorization code ends up
 * being delivered to somebody else's server. These two are the registered pair —
 * the deployed SPA, and the loopback listener used to mint a token from a laptop.
 */
export const REGISTERED_REDIRECT_URIS = [
  "https://showme-app.web.app/oauth/google/callback",
  "http://localhost:8975/oauth/google/callback",
] as const;

export function isRegisteredRedirectUri(candidate: string): boolean {
  return (REGISTERED_REDIRECT_URIS as readonly string[]).includes(candidate);
}

/**
 * The URL that starts the flow.
 *
 * `access_type=offline` is what makes Google issue a refresh token at all;
 * `prompt=consent` is what makes it issue one AGAIN on a reconnect — without it a
 * user who has already granted access gets an access token and no refresh token,
 * and the reconnect silently produces a connection that dies in an hour.
 */
export function buildGoogleAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string;
}): string {
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", input.scope ?? GOOGLE_CALENDAR_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", input.state);
  return url.toString();
}

async function postForm(
  client: GoogleOAuthClient,
  endpoint: string,
  form: Record<string, string>,
): Promise<Response> {
  const doFetch = client.fetchImplementation ?? fetch;
  return doFetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
}

/** Google's error envelope on the token endpoint. */
function readOAuthError(payload: unknown): { error: string; description: string } {
  const body = (payload ?? {}) as { error?: string; error_description?: string };
  return { error: body.error ?? "unknown", description: body.error_description ?? "" };
}

/**
 * Turn the one-time code from the consent screen into a refresh token.
 *
 * `redirectUri` must be byte-identical to the one the code was authorized
 * against; Google refuses the exchange otherwise, which is a feature — it is what
 * stops a code minted for one client surface being spent from another.
 */
export async function exchangeAuthorizationCode(
  client: GoogleOAuthClient,
  input: { code: string; redirectUri: string },
): Promise<GoogleTokenGrant> {
  const response = await postForm(client, GOOGLE_TOKEN_ENDPOINT, {
    code: input.code,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const { error, description } = readOAuthError(payload);
    // A code that was already spent, or was minted for a different client, comes
    // back as invalid_grant too — same remedy either way: run the flow again.
    if (error === "invalid_grant") throw new GoogleAuthorizationRevokedError(description || error);
    throw new GoogleApiError(response.status, `${error} ${description}`);
  }

  const grant = payload as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    expires_in?: number;
  };
  if (!grant.access_token) throw new GoogleApiError(response.status, "no access_token in grant");
  return {
    accessToken: grant.access_token,
    refreshToken: grant.refresh_token ?? null,
    // What the user ACTUALLY consented to, not what was asked for. They differ
    // whenever somebody unticks a box on the consent screen.
    scope: grant.scope ?? "",
    expiresInSeconds: grant.expires_in ?? 3600,
  };
}

/**
 * Spend a refresh token for a short-lived access token.
 *
 * The refresh response carries NO new refresh token — Google issues one only at
 * consent — so nothing here writes back to the sealed column.
 */
export async function refreshAccessToken(
  client: GoogleOAuthClient,
  refreshToken: string,
): Promise<GoogleTokenGrant> {
  const response = await postForm(client, GOOGLE_TOKEN_ENDPOINT, {
    client_id: client.clientId,
    client_secret: client.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const { error, description } = readOAuthError(payload);
    // THE ORDINARY FAILURE. The user pressed "Remove access" on their Google
    // account page, or the token went unused for six months, or the project left
    // testing mode. All of them arrive here, and all of them mean the same thing
    // to the person: reconnect.
    if (error === "invalid_grant") throw new GoogleAuthorizationRevokedError(description || error);
    throw new GoogleApiError(response.status, `${error} ${description}`);
  }

  const grant = payload as { access_token?: string; scope?: string; expires_in?: number };
  if (!grant.access_token) throw new GoogleApiError(response.status, "no access_token on refresh");
  return {
    accessToken: grant.access_token,
    refreshToken: null,
    scope: grant.scope ?? "",
    expiresInSeconds: grant.expires_in ?? 3600,
  };
}

/**
 * Tell Google to forget the grant. Called by Disconnect, BEFORE the row is
 * deleted — a disconnect that leaves a working key upstream is a lie, and once
 * the row is gone there is nothing left to revoke with.
 *
 * Revoking either token of a grant revokes the whole grant, so one call is enough.
 * A 400 here means the token was already dead, which is the desired end state:
 * the caller treats it as success rather than blocking the disconnect.
 */
export async function revokeToken(
  client: GoogleOAuthClient,
  token: string,
): Promise<{ revoked: boolean; detail: string }> {
  const response = await postForm(client, GOOGLE_REVOKE_ENDPOINT, { token });
  if (response.ok) return { revoked: true, detail: "" };
  const detail = await response.text().catch(() => "");
  if (response.status === 400) return { revoked: false, detail: detail.slice(0, 200) };
  throw new GoogleApiError(response.status, detail);
}

/* ─────────────────────────────────────────────────────────── the listing ─── */

/** The subset of Google's event resource this adapter reads. */
export interface GoogleCalendarEvent {
  id?: string;
  status?: string;
  summary?: string;
  location?: string;
  eventType?: string;
  transparency?: string;
  recurringEventId?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
}

export interface GoogleEventListing {
  events: GoogleCalendarEvent[];
  /** The cursor for the NEXT sync. Present only on the last page. */
  nextSyncToken: string | null;
  /** The calendar's display name — for the primary calendar, the account address. */
  calendarSummary: string | null;
  /** The calendar's IANA zone. The frame every wall-clock time below is read in. */
  calendarTimeZone: string | null;
}

export interface ListCalendarEventsInput {
  accessToken: string;
  calendarId: string;
  /** Incremental when present. Mutually exclusive with the time window below. */
  syncToken?: string | null;
  /** Only on a FULL listing — Google rejects them alongside a sync token. */
  timeMin?: string;
  timeMax?: string;
  fetchImplementation?: typeof fetch;
  /** Safety valve: stop paging rather than loop forever on a pathological calendar. */
  maxPages?: number;
}

/**
 * List a calendar's events, following `nextPageToken` to the end.
 *
 * `singleEvents=true` is non-negotiable — see trap 4 above. `showDeleted` is left
 * to Google's own default, which is exactly right in both modes: on an incremental
 * listing it is forced true (and Google REFUSES `showDeleted=false` with a sync
 * token, because the deletions are the point), and on a full listing the default
 * omits tombstones we have no use for.
 *
 * WHY `timeMin`/`timeMax` are full-listing-only: Google rejects them alongside a
 * sync token, because the token already encodes the window of the listing that
 * minted it. That is also why the connection records `last_full_sync_at` — the
 * window does not travel forward on its own.
 */
export async function listCalendarEvents(
  input: ListCalendarEventsInput,
): Promise<GoogleEventListing> {
  const doFetch = input.fetchImplementation ?? fetch;
  const maxPages = input.maxPages ?? 40;

  const events: GoogleCalendarEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;
  let calendarSummary: string | null = null;
  let calendarTimeZone: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const url = new URL(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(input.calendarId)}/events`,
    );
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("maxResults", "250");
    if (input.syncToken) {
      url.searchParams.set("syncToken", input.syncToken);
    } else {
      if (input.timeMin) url.searchParams.set("timeMin", input.timeMin);
      if (input.timeMax) url.searchParams.set("timeMax", input.timeMax);
    }
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await doFetch(url.toString(), {
      headers: { authorization: `Bearer ${input.accessToken}` },
    });

    if (response.status === 410) throw new GoogleSyncTokenExpiredError();
    if (!response.ok) {
      throw new GoogleApiError(response.status, await response.text().catch(() => ""));
    }

    const body = (await response.json()) as {
      items?: GoogleCalendarEvent[];
      nextPageToken?: string;
      nextSyncToken?: string;
      summary?: string;
      timeZone?: string;
    };

    if (body.items) events.push(...body.items);
    calendarSummary = body.summary ?? calendarSummary;
    calendarTimeZone = body.timeZone ?? calendarTimeZone;
    nextSyncToken = body.nextSyncToken ?? null;
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }

  return { events, nextSyncToken, calendarSummary, calendarTimeZone };
}

/**
 * WHO THIS CALENDAR BELONGS TO, and what zone it keeps — with the narrowest
 * request that can answer it.
 *
 * The obvious call (`calendars.get`) is a 403 under the `calendar.events` scope,
 * so the identity is read off a listing's own envelope instead. The window is one
 * day wide and `maxResults=1` so this stays a single cheap round trip: the
 * envelope fields are present on every page, whether or not any event comes back.
 *
 * It deliberately does NOT request a sync token — a listing this narrow would mint
 * a cursor bound to a one-day window, and storing that would strand the connection
 * on a horizon of twenty-four hours.
 */
export async function readCalendarIdentity(input: {
  accessToken: string;
  calendarId: string;
  fetchImplementation?: typeof fetch;
  now?: Date;
}): Promise<{ calendarSummary: string | null; calendarTimeZone: string | null }> {
  const doFetch = input.fetchImplementation ?? fetch;
  const now = input.now ?? new Date();
  const url = new URL(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(input.calendarId)}/events`,
  );
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("timeMin", now.toISOString());
  url.searchParams.set("timeMax", new Date(now.getTime() + 86_400_000).toISOString());

  const response = await doFetch(url.toString(), {
    headers: { authorization: `Bearer ${input.accessToken}` },
  });
  if (!response.ok) {
    throw new GoogleApiError(response.status, await response.text().catch(() => ""));
  }
  const body = (await response.json()) as { summary?: string; timeZone?: string };
  return { calendarSummary: body.summary ?? null, calendarTimeZone: body.timeZone ?? null };
}

/* ────────────────────────────────────────────────────── the push channel ─── */

/**
 * WATCHING A CALENDAR — `events.watch`, the push half of sync.
 *
 * Google will POST to `address` whenever anything on the calendar changes. What
 * arrives is a notification with an EMPTY BODY: every fact is in the headers, and
 * the only fact it carries is "something moved". It never says what. That is why
 * the handler's whole job is to look the connection up and run the ordinary
 * incremental sync, which already knows how to ask "what changed since my cursor".
 *
 * THE ADDRESS IS NOT FREE. Google refuses to register a channel unless the host
 * is HTTPS and the DOMAIN IS USER-VERIFIED against this Cloud project — a
 * `*.run.app` URL can never qualify. For shoWMe that is `api.showme.music`,
 * verified in `prod-showme` and fronted by the HTTPS load balancer.
 *
 * THE `token` IS THE AUTHENTICATION. Google echoes it back in
 * `X-Goog-Channel-Token` on every ping. The receiving route is public — Google
 * will not send a Firebase token — so that echo plus the channel-id lookup is all
 * there is. It must therefore be unguessable, per channel, and never reused.
 */
export interface GoogleWatchChannel {
  /** The id we chose. Google echoes it as `X-Goog-Channel-ID`. */
  channelId: string;
  /** Google's handle for the watched resource. Required to stop the channel. */
  resourceId: string;
  /** When Google will stop sending. About a week out; null if it did not say. */
  expiresAt: Date | null;
}

export async function watchCalendarEvents(input: {
  accessToken: string;
  calendarId: string;
  /** A fresh, unguessable id for this channel. */
  channelId: string;
  /** The public HTTPS endpoint on a user-verified domain. */
  address: string;
  /** The shared secret Google will echo back on every ping. */
  token: string;
  fetchImplementation?: typeof fetch;
}): Promise<GoogleWatchChannel> {
  const doFetch = input.fetchImplementation ?? fetch;
  const response = await doFetch(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(input.calendarId)}/events/watch`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        id: input.channelId,
        type: "web_hook",
        address: input.address,
        token: input.token,
      }),
    },
  );

  if (!response.ok) {
    throw new GoogleApiError(response.status, await response.text().catch(() => ""));
  }
  const body = (await response.json()) as {
    id?: string;
    resourceId?: string;
    expiration?: string;
  };
  if (!body.resourceId) {
    throw new GoogleApiError(response.status, "watch returned no resourceId");
  }
  return {
    channelId: body.id ?? input.channelId,
    resourceId: body.resourceId,
    // `expiration` is milliseconds since the epoch, as a STRING. Parsed as a
    // number, not fed to `new Date(string)`, which would read it as a date.
    expiresAt: body.expiration ? new Date(Number(body.expiration)) : null,
  };
}

/**
 * Stop a channel. Called on disconnect — otherwise Google keeps pinging about a
 * calendar nobody is listening to, and every ping is a 404 from our side that
 * Google retries with backoff.
 *
 * A channel that has already expired or been stopped answers 404. That is the
 * desired end state, so it is reported rather than thrown.
 */
export async function stopWatchChannel(input: {
  accessToken: string;
  channelId: string;
  resourceId: string;
  fetchImplementation?: typeof fetch;
}): Promise<{ stopped: boolean }> {
  const doFetch = input.fetchImplementation ?? fetch;
  const response = await doFetch(`${GOOGLE_CALENDAR_API}/channels/stop`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ id: input.channelId, resourceId: input.resourceId }),
  });
  if (response.status === 404) return { stopped: false };
  if (!response.ok) {
    throw new GoogleApiError(response.status, await response.text().catch(() => ""));
  }
  return { stopped: true };
}

/* ──────────────────────────────────────────────────── the normalisation ─── */

/**
 * An instant, read as a wall clock in a named zone.
 *
 * THE ONLY CORRECT WAY TO DO THIS, and the reason it is a named function with a
 * comment this long: Sweden is `+02:00` until the last Sunday in October and
 * `+01:00` after it, so a 09:00 recurring event arrives from Google as
 * `T09:00:00+02:00` in September and `T09:00:00+01:00` in November. Taking the
 * offset from one instance, or from the connection, or from `new Date().
 * getTimezoneOffset()`, shifts half the year by an hour. `Intl.DateTimeFormat`
 * with an IANA zone asks the tz database about THAT instant, which is the only
 * source that knows where the boundary falls.
 *
 * `hourCycle: "h23"` and not `hour12: false`: the latter renders midnight as
 * "24" in several ICU versions, which would turn `00:15` into `24:15` — a time
 * Postgres accepts as a `time` and then no window ever matches.
 */
export function wallClockInTimeZone(
  instant: Date,
  timeZone: string,
): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);

  const field = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";

  return {
    date: `${field("year")}-${field("month")}-${field("day")}`,
    time: `${field("hour")}:${field("minute")}:${field("second")}`,
  };
}

/** `2026-10-11` → `2026-10-10`. Built from the parts: a bare date has no zone. */
export function previousDay(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  // `Date.UTC` and UTC getters throughout — this is calendar arithmetic on a bare
  // day, and letting it touch a local zone is exactly how a date slips by one.
  const shifted = new Date(Date.UTC(year, month - 1, day - 1));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/**
 * Did the person whose calendar this is say NO to this invitation?
 *
 * THE DECISION, since the seam's notes leave it open: **a declined invitation does
 * not block.** `lib/availability.ts` rightly prefers over-blocking when the extent
 * of a commitment is UNKNOWN — but this is not unknown. The user has already
 * stated, in their own calendar, that they are not going. Treating that as a busy
 * night would make shoWMe contradict the answer they gave, and it is the single
 * most common way a shared calendar produces false conflicts: a musician invited
 * to forty industry events they declined would look unbookable all year.
 *
 * `needsAction`, `tentative` and `accepted` all block. Only an explicit "no" does
 * not — and an event with no attendee list at all is the user's own entry, which
 * always blocks.
 */
export function declinedBySelf(event: GoogleCalendarEvent): boolean {
  return (event.attendees ?? []).some(
    (attendee) => attendee.self === true && attendee.responseStatus === "declined",
  );
}

/** What one Google event means to shoWMe: an entry, a removal, or nothing at all. */
export type NormalizedGoogleEvent =
  | { kind: "event"; event: NormalizedExternalEvent }
  | { kind: "deleted"; externalId: string }
  | { kind: "ignored"; reason: string };

/**
 * ONE Google event → the seam's shape. Pure: no clock, no network, no database.
 *
 * `calendarTimeZone` is the calendar's own zone and is the frame the times are
 * resolved into — NOT the event's `start.timeZone`. An event created while its
 * author was in Berlin still appears on this user's Swedish calendar at the Swedish
 * wall-clock hour, and the Swedish hour is what has to line up with the rest of
 * their day when shoWMe decides whether a night is free.
 */
export function normalizeGoogleEvent(
  event: GoogleCalendarEvent,
  calendarTimeZone: string,
): NormalizedGoogleEvent {
  if (!event.id) return { kind: "ignored", reason: "no id" };

  // TRAP 3: a tombstone. `status: "cancelled"` is how BOTH a deleted event and a
  // deleted instance of a recurring series arrive, and it is the only way an
  // incremental sync ever learns that something is gone.
  if (event.status === "cancelled") return { kind: "deleted", externalId: event.id };

  // A declined invitation is a removal, not a skip: if it was imported while it
  // was still open, the row has to go or the night stays blocked by an event the
  // user has already said no to.
  if (declinedBySelf(event)) return { kind: "deleted", externalId: event.id };

  // Google's "Working location" entries are all-day markers describing WHERE
  // somebody works, not commitments. Importing them would block every working day
  // of every user who has the feature on.
  if (event.eventType === "workingLocation") {
    return { kind: "ignored", reason: "working location" };
  }

  const title = event.summary?.trim() || "Busy";
  const location = event.location ?? null;

  // TRAP 1 + 2: an all-day entry, whose `end.date` is EXCLUSIVE.
  if (event.start?.date) {
    const date = event.start.date;
    const exclusiveEnd = event.end?.date;
    const lastDay = exclusiveEnd ? previousDay(exclusiveEnd) : date;
    return {
      kind: "event",
      event: {
        externalId: event.id,
        title,
        date,
        // null rather than the same day, which is what the seam expects for a
        // single-day entry and what keeps the `end_date >= date` check honest.
        endDate: lastDay > date ? lastDay : null,
        startTime: null,
        endTime: null,
        location,
      },
    };
  }

  if (!event.start?.dateTime) return { kind: "ignored", reason: "no start" };

  const start = wallClockInTimeZone(new Date(event.start.dateTime), calendarTimeZone);
  if (!event.end?.dateTime) {
    // A start with no end. `lib/availability.ts` treats an unknown extent as
    // all-day on purpose — over-blocking costs an enquiry, under-blocking
    // double-books a night.
    return {
      kind: "event",
      event: {
        externalId: event.id,
        title,
        date: start.date,
        endDate: null,
        startTime: null,
        endTime: null,
        location,
      },
    };
  }

  const end = wallClockInTimeZone(new Date(event.end.dateTime), calendarTimeZone);
  let endDate = end.date;
  let endTime = end.time;

  // An event that runs to midnight ends AT the end of its own day, not at the
  // start of the next one. Google says `T00:00:00` on the following date; taken
  // literally that makes a 22:00–24:00 gig span two days, and a two-day span
  // blocks both of them whole (the availability rule cannot describe the middle
  // of a range with one pair of times). One clamp, one day back.
  if (endTime === "00:00:00" && endDate > start.date) {
    endDate = previousDay(endDate);
    endTime = "23:59:59";
  }

  return {
    kind: "event",
    event: {
      externalId: event.id,
      title,
      date: start.date,
      endDate: endDate > start.date ? endDate : null,
      startTime: start.time,
      endTime,
      location,
    },
  };
}

export interface NormalizedGoogleBatch {
  events: NormalizedExternalEvent[];
  deletedExternalIds: string[];
  ignored: number;
}

/** The whole listing, split into what to write and what to remove. Pure. */
export function normalizeGoogleEvents(
  events: readonly GoogleCalendarEvent[],
  calendarTimeZone: string,
): NormalizedGoogleBatch {
  const batch: NormalizedGoogleBatch = { events: [], deletedExternalIds: [], ignored: 0 };
  for (const event of events) {
    const normalized = normalizeGoogleEvent(event, calendarTimeZone);
    if (normalized.kind === "event") batch.events.push(normalized.event);
    else if (normalized.kind === "deleted") batch.deletedExternalIds.push(normalized.externalId);
    else batch.ignored += 1;
  }
  return batch;
}
