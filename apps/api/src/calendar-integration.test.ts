import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCalendarIntegration, refreshTokenSealContext } from "./lib/calendar-integration";
import { shouldRunFullSync } from "./lib/calendar-sync";
import {
  type GoogleCalendarEvent,
  buildGoogleAuthorizationUrl,
  declinedBySelf,
  isRegisteredRedirectUri,
  normalizeGoogleEvent,
  normalizeGoogleEvents,
  previousDay,
  wallClockInTimeZone,
} from "./lib/google-calendar";
import {
  OAUTH_STATE_LIFETIME_MILLISECONDS,
  OAuthStateError,
  signOAuthState,
  verifyOAuthState,
} from "./lib/oauth-state";
import { SecretTamperedError, createSecretSealer } from "./lib/token-encryption";

/**
 * The parts of the calendar integration that are plain functions — sealing a
 * credential, signing the OAuth `state`, and turning Google's event shape into
 * shoWMe's. No container, no network: every case here is a decision the code
 * makes on its own, and each one has cost somebody a real bug somewhere.
 */

const KEY = randomBytes(32).toString("base64");

describe("token encryption", () => {
  const sealer = createSecretSealer(KEY);
  const context = refreshTokenSealContext({
    userId: "user-1",
    provider: "google",
    providerAccountId: "someone@example.showme.test",
  });

  it("round-trips a refresh token", () => {
    const token = "1//0cIzI-a-refresh-token-that-must-survive";
    const sealed = sealer.seal(token, context);
    expect(sealer.open(sealed, context)).toBe(token);
  });

  it("never stores the plaintext — the ciphertext contains none of it", () => {
    const token = "1//0cIzI-a-refresh-token-that-must-survive";
    const sealed = sealer.seal(token, context);
    expect(sealed.ciphertext).not.toContain(token);
    expect(Buffer.from(sealed.ciphertext, "base64").toString("utf8")).not.toContain("refresh");
  });

  it("draws a fresh nonce per seal, so the same token never seals to the same bytes", () => {
    const first = sealer.seal("same-token", context);
    const second = sealer.seal("same-token", context);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  // THE ONE THAT MATTERS. Without the authentication tag this test passes with a
  // wrong plaintext instead of failing, and the API hands the mangled result to
  // Google as a credential.
  it("REFUSES a tampered ciphertext rather than decrypting it", () => {
    const sealed = sealer.seal("1//0cIzI-token", context);
    const bytes = Buffer.from(sealed.ciphertext, "base64");
    bytes[0] = (bytes[0] ?? 0) ^ 0x01;
    const tampered = { ...sealed, ciphertext: bytes.toString("base64") };
    expect(() => sealer.open(tampered, context)).toThrow(SecretTamperedError);
  });

  it("refuses a tampered authentication tag", () => {
    const sealed = sealer.seal("1//0cIzI-token", context);
    const tag = Buffer.from(sealed.authTag, "base64");
    tag[0] = (tag[0] ?? 0) ^ 0xff;
    expect(() => sealer.open({ ...sealed, authTag: tag.toString("base64") }, context)).toThrow(
      SecretTamperedError,
    );
  });

  it("refuses a ciphertext opened under a different nonce", () => {
    const sealed = sealer.seal("1//0cIzI-token", context);
    const otherIv = randomBytes(12).toString("base64");
    expect(() => sealer.open({ ...sealed, iv: otherIv }, context)).toThrow(SecretTamperedError);
  });

  // The associated-data binding: a token lifted onto another user's row is dead.
  it("refuses a ciphertext moved to another connection", () => {
    const sealed = sealer.seal("1//0cIzI-token", context);
    const attackerContext = refreshTokenSealContext({
      userId: "user-2",
      provider: "google",
      providerAccountId: "someone@example.showme.test",
    });
    expect(() => sealer.open(sealed, attackerContext)).toThrow(SecretTamperedError);
  });

  it("refuses a ciphertext opened with a different key", () => {
    const sealed = sealer.seal("1//0cIzI-token", context);
    const otherSealer = createSecretSealer(randomBytes(32).toString("base64"));
    expect(() => otherSealer.open(sealed, context)).toThrow(SecretTamperedError);
  });

  it("rejects a key that is not 32 bytes, at wiring time", () => {
    expect(() => createSecretSealer(randomBytes(16).toString("base64"))).toThrow(
      /must decode to 32 bytes/,
    );
  });
});

describe("the integration is optional", () => {
  it("is null unless all three secrets are present", () => {
    expect(createCalendarIntegration({})).toBeNull();
    expect(
      createCalendarIntegration({ googleOAuthClientId: "id", googleOAuthClientSecret: "secret" }),
    ).toBeNull();
    expect(
      createCalendarIntegration({ googleOAuthClientId: "id", calendarTokenEncryptionKey: KEY }),
    ).toBeNull();
  });

  it("builds when all three are present", () => {
    const integration = createCalendarIntegration({
      googleOAuthClientId: "id",
      googleOAuthClientSecret: "secret",
      calendarTokenEncryptionKey: KEY,
    });
    expect(integration?.googleOAuthClient.clientId).toBe("id");
  });
});

describe("the OAuth state", () => {
  const claims = {
    userId: "user-1",
    profileId: "11111111-1111-1111-1111-111111111111",
    redirectUri: "https://showme-app.web.app/oauth/google/callback",
  };

  it("round-trips the claims it was signed with", () => {
    const verified = verifyOAuthState(KEY, signOAuthState(KEY, claims));
    expect(verified.userId).toBe(claims.userId);
    expect(verified.profileId).toBe(claims.profileId);
    expect(verified.redirectUri).toBe(claims.redirectUri);
  });

  // The forgery this whole mechanism exists to stop: an attacker naming a victim.
  it("REFUSES a state whose claims were edited", () => {
    const state = signOAuthState(KEY, claims);
    const [payload = "", mac = ""] = state.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    decoded.userId = "victim";
    const forged = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${mac}`;
    expect(() => verifyOAuthState(KEY, forged)).toThrow(OAuthStateError);
  });

  it("refuses a state signed with a different secret", () => {
    const state = signOAuthState(randomBytes(32).toString("base64"), claims);
    expect(() => verifyOAuthState(KEY, state)).toThrow(/does not verify/);
  });

  it("refuses a malformed state rather than crashing", () => {
    expect(() => verifyOAuthState(KEY, "nonsense")).toThrow(OAuthStateError);
    expect(() => verifyOAuthState(KEY, "")).toThrow(OAuthStateError);
  });

  it("expires — a consent screen left open all afternoon is not accepted", () => {
    const issued = new Date("2026-08-26T10:00:00Z");
    const state = signOAuthState(KEY, claims, issued);
    const justInside = new Date(issued.getTime() + OAUTH_STATE_LIFETIME_MILLISECONDS - 1000);
    const justOutside = new Date(issued.getTime() + OAUTH_STATE_LIFETIME_MILLISECONDS + 1000);
    expect(verifyOAuthState(KEY, state, justInside).userId).toBe("user-1");
    expect(() => verifyOAuthState(KEY, state, justOutside)).toThrow(/expired/);
  });

  it("gives two flows started in the same instant different states", () => {
    const now = new Date("2026-08-26T10:00:00Z");
    expect(signOAuthState(KEY, claims, now)).not.toBe(signOAuthState(KEY, claims, now));
  });
});

describe("the authorization URL", () => {
  it("asks for offline access and forces the consent screen", () => {
    const url = new URL(
      buildGoogleAuthorizationUrl({
        clientId: "client-id",
        redirectUri: "https://showme-app.web.app/oauth/google/callback",
        state: "the-state",
      }),
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    // Without prompt=consent a reconnect gets no refresh token and dies in an hour.
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/calendar.events");
    expect(url.searchParams.get("state")).toBe("the-state");
    // The secret is not, and can never be, in a URL a browser follows.
    expect(url.toString()).not.toContain("client_secret");
  });

  it("only accepts the registered redirect addresses", () => {
    expect(isRegisteredRedirectUri("https://showme-app.web.app/oauth/google/callback")).toBe(true);
    expect(isRegisteredRedirectUri("http://localhost:8975/oauth/google/callback")).toBe(true);
    expect(isRegisteredRedirectUri("https://evil.example.com/oauth/google/callback")).toBe(false);
    // A prefix match would let this through; membership does not.
    expect(
      isRegisteredRedirectUri("https://showme-app.web.app.evil.com/oauth/google/callback"),
    ).toBe(false);
  });
});

describe("normalising Google's events", () => {
  const STOCKHOLM = "Europe/Stockholm";

  it("reads a timed event in the calendar's zone", () => {
    const event: GoogleCalendarEvent = {
      id: "founder-lunch",
      status: "confirmed",
      summary: "🧑‍🍳 Founder Lunch",
      start: { dateTime: "2026-09-11T12:00:00+02:00", timeZone: STOCKHOLM },
      end: { dateTime: "2026-09-11T13:00:00+02:00", timeZone: STOCKHOLM },
    };
    const normalized = normalizeGoogleEvent(event, STOCKHOLM);
    expect(normalized).toEqual({
      kind: "event",
      event: {
        externalId: "founder-lunch",
        title: "🧑‍🍳 Founder Lunch",
        date: "2026-09-11",
        endDate: null,
        startTime: "12:00:00",
        endTime: "13:00:00",
        location: null,
      },
    });
  });

  /**
   * THE DST CASE. The same recurring 09:00 coffee arrives at `+02:00` in October
   * and `+01:00` in November; both must read back as 09:00. A conversion that
   * takes the offset from one instance and reuses it moves every winter entry an
   * hour — the class of bug this repo has already fixed four times.
   */
  it("keeps a recurring wall-clock time across the daylight-saving boundary", () => {
    const summerInstance = normalizeGoogleEvent(
      {
        id: "coffee-2026-10-14",
        summary: "☕️ Morning Coffee",
        start: { dateTime: "2026-10-14T09:00:00+02:00", timeZone: STOCKHOLM },
        end: { dateTime: "2026-10-14T09:30:00+02:00", timeZone: STOCKHOLM },
      },
      STOCKHOLM,
    );
    const winterInstance = normalizeGoogleEvent(
      {
        id: "coffee-2026-11-04",
        summary: "☕️ Morning Coffee",
        start: { dateTime: "2026-11-04T09:00:00+01:00", timeZone: STOCKHOLM },
        end: { dateTime: "2026-11-04T09:30:00+01:00", timeZone: STOCKHOLM },
      },
      STOCKHOLM,
    );

    expect(summerInstance).toMatchObject({ event: { date: "2026-10-14", startTime: "09:00:00" } });
    expect(winterInstance).toMatchObject({ event: { date: "2026-11-04", startTime: "09:00:00" } });
    // And each instance keeps its OWN id, which is what `singleEvents=true` buys:
    // one row per morning, not one row for the whole series.
    expect(summerInstance).toMatchObject({ event: { externalId: "coffee-2026-10-14" } });
  });

  it("resolves an event authored in another zone into the calendar's zone", () => {
    // 09:30 Berlin in January is 09:30 Stockholm; in a zone that differs it moves.
    const normalized = normalizeGoogleEvent(
      {
        id: "cross-zone",
        summary: "Kickoff",
        start: { dateTime: "2026-11-13T18:00:00-05:00", timeZone: "America/New_York" },
        end: { dateTime: "2026-11-13T19:00:00-05:00", timeZone: "America/New_York" },
      },
      STOCKHOLM,
    );
    // 18:00 New York (UTC-5) = 00:00 the next day in Stockholm (UTC+1).
    expect(normalized).toMatchObject({
      event: { date: "2026-11-14", startTime: "00:00:00", endTime: "01:00:00" },
    });
  });

  it("treats an all-day entry's exclusive end date as the day before", () => {
    // Google says "the 10th to the 11th" for a holiday that occupies ONE day.
    const single = normalizeGoogleEvent(
      {
        id: "day-off",
        summary: "Day off",
        start: { date: "2026-10-10" },
        end: { date: "2026-10-11" },
      },
      STOCKHOLM,
    );
    expect(single).toMatchObject({
      event: { date: "2026-10-10", endDate: null, startTime: null, endTime: null },
    });

    const festival = normalizeGoogleEvent(
      {
        id: "festival",
        summary: "Festival",
        start: { date: "2026-07-02" },
        end: { date: "2026-07-06" },
      },
      STOCKHOLM,
    );
    expect(festival).toMatchObject({ event: { date: "2026-07-02", endDate: "2026-07-05" } });
  });

  it("treats a cancelled event as a deletion, not a skip", () => {
    expect(normalizeGoogleEvent({ id: "gone", status: "cancelled" }, STOCKHOLM)).toEqual({
      kind: "deleted",
      externalId: "gone",
    });
  });

  it("treats a cancelled INSTANCE of a series as a deletion of that instance", () => {
    expect(
      normalizeGoogleEvent(
        { id: "coffee-2026-11-04", status: "cancelled", recurringEventId: "coffee" },
        STOCKHOLM,
      ),
    ).toEqual({ kind: "deleted", externalId: "coffee-2026-11-04" });
  });

  /**
   * THE DECISION on declined invitations, asserted so it cannot drift: an event
   * the user has said no to does not block, and if it was imported while still
   * open it is removed. Anything short of an explicit "no" still blocks.
   */
  it("removes an event this user declined, and keeps every other response", () => {
    const withResponse = (responseStatus: string): GoogleCalendarEvent => ({
      id: `invite-${responseStatus}`,
      summary: "Industry mixer",
      start: { dateTime: "2026-09-11T18:00:00+02:00" },
      end: { dateTime: "2026-09-11T20:00:00+02:00" },
      attendees: [
        { responseStatus: "accepted" },
        { self: true, responseStatus },
        { responseStatus: "declined" },
      ],
    });

    expect(normalizeGoogleEvent(withResponse("declined"), STOCKHOLM).kind).toBe("deleted");
    for (const response of ["accepted", "tentative", "needsAction"]) {
      expect(normalizeGoogleEvent(withResponse(response), STOCKHOLM).kind).toBe("event");
    }
    // Somebody ELSE declining is not this user declining.
    expect(declinedBySelf(withResponse("accepted"))).toBe(false);
  });

  it("blocks an event with no attendee list — that is the user's own entry", () => {
    const own = normalizeGoogleEvent(
      {
        id: "own",
        summary: "Studio",
        start: { dateTime: "2026-09-11T18:00:00+02:00" },
        end: { dateTime: "2026-09-11T20:00:00+02:00" },
      },
      STOCKHOLM,
    );
    expect(own.kind).toBe("event");
  });

  it("ignores Google's working-location markers", () => {
    const normalized = normalizeGoogleEvent(
      {
        id: "wl",
        eventType: "workingLocation",
        start: { date: "2026-09-11" },
        end: { date: "2026-09-12" },
      },
      STOCKHOLM,
    );
    expect(normalized).toEqual({ kind: "ignored", reason: "working location" });
  });

  it("ends a to-midnight event on its own day instead of spanning two", () => {
    // 22:00 → 00:00 is one late night, not two blocked days.
    const normalized = normalizeGoogleEvent(
      {
        id: "late-show",
        summary: "Late show",
        start: { dateTime: "2026-09-11T22:00:00+02:00" },
        end: { dateTime: "2026-09-12T00:00:00+02:00" },
      },
      STOCKHOLM,
    );
    expect(normalized).toMatchObject({
      event: { date: "2026-09-11", endDate: null, startTime: "22:00:00", endTime: "23:59:59" },
    });
  });

  it("carries a genuine overnight event across to the next day", () => {
    const normalized = normalizeGoogleEvent(
      {
        id: "overnight",
        summary: "Overnight drive",
        start: { dateTime: "2026-09-11T22:00:00+02:00" },
        end: { dateTime: "2026-09-12T06:00:00+02:00" },
      },
      STOCKHOLM,
    );
    expect(normalized).toMatchObject({ event: { date: "2026-09-11", endDate: "2026-09-12" } });
  });

  it("falls back to all-day when the extent is unknown", () => {
    // `lib/availability.ts`: over-blocking costs an enquiry, under-blocking
    // double-books a night. An unknown extent takes the safe reading.
    const normalized = normalizeGoogleEvent(
      { id: "no-end", summary: "Something", start: { dateTime: "2026-09-11T22:00:00+02:00" } },
      STOCKHOLM,
    );
    expect(normalized).toMatchObject({
      event: { date: "2026-09-11", startTime: null, endTime: null },
    });
  });

  it("names an untitled entry rather than importing an empty string", () => {
    const normalized = normalizeGoogleEvent(
      { id: "private", summary: "   ", start: { date: "2026-09-11" }, end: { date: "2026-09-12" } },
      STOCKHOLM,
    );
    expect(normalized).toMatchObject({ event: { title: "Busy" } });
  });

  it("splits a whole listing into writes, removals and things to ignore", () => {
    const batch = normalizeGoogleEvents(
      [
        { id: "a", summary: "Keep", start: { date: "2026-09-11" }, end: { date: "2026-09-12" } },
        { id: "b", status: "cancelled" },
        { id: "c", eventType: "workingLocation", start: { date: "2026-09-11" } },
        { summary: "no id" },
      ],
      STOCKHOLM,
    );
    expect(batch.events.map((event) => event.externalId)).toEqual(["a"]);
    expect(batch.deletedExternalIds).toEqual(["b"]);
    expect(batch.ignored).toBe(2);
  });
});

describe("wall-clock helpers", () => {
  it("renders midnight as 00, never as 24", () => {
    // `hour12: false` produces "24" in several ICU builds, which Postgres accepts
    // as a `time` and no availability window ever matches.
    expect(wallClockInTimeZone(new Date("2026-11-13T23:00:00Z"), "Europe/Stockholm").time).toBe(
      "00:00:00",
    );
  });

  it("steps a bare date back a day without touching a local zone", () => {
    expect(previousDay("2026-10-11")).toBe("2026-10-10");
    expect(previousDay("2026-01-01")).toBe("2025-12-31");
    expect(previousDay("2026-03-01")).toBe("2026-02-28");
  });
});

describe("choosing between a full and an incremental sync", () => {
  const now = new Date("2026-08-26T12:00:00Z");
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

  it("is full on the first sync — there is no cursor yet", () => {
    expect(shouldRunFullSync({ syncToken: null, lastFullSyncAt: null }, now)).toBe(true);
  });

  it("is incremental once a cursor exists", () => {
    expect(shouldRunFullSync({ syncToken: "token", lastFullSyncAt: daysAgo(1) }, now)).toBe(false);
  });

  it("re-lists in full once the window has stopped moving", () => {
    // A sync token inherits the time window of the listing that minted it, so a
    // connection that never re-lists keeps a horizon that never advances.
    expect(shouldRunFullSync({ syncToken: "token", lastFullSyncAt: daysAgo(30) }, now)).toBe(true);
  });
});
