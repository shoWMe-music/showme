import { describe, expect, it } from "vitest";
import {
  GOOGLE_APP_CALENDAR_SCOPE,
  GOOGLE_CALENDAR_SCOPE,
  createAppCalendar,
  deleteCalendarEvent,
  hasAppCalendarScope,
  insertCalendarEvent,
  patchCalendarEvent,
  requestedScopes,
} from "./lib/google-calendar";

/**
 * The WRITE half of the Google integration (ClickUp 86cbcbjyc / 86cbcbk2j /
 * 86cbcbk53). Everything here is pure over an injected `fetch`, which is the
 * seam `lib/google-calendar.ts` already keeps: it knows Google and nothing about
 * Postgres, so its behaviour can be pinned exactly without a database or a
 * network.
 *
 * These assert the SHAPE OF THE REQUEST, not just that a call was made, because
 * every real failure mode of this feature is a silently-accepted request:
 * a missing `conferenceDataVersion` returns a perfectly good event with no Meet
 * link, and a missing `sendUpdates` returns a perfectly good event that never
 * invited anybody.
 */

interface Captured {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

/** A fetch that records what it was asked and answers with `payload`. */
function recordingFetch(payload: unknown, status = 200) {
  const calls: Captured[] = [];
  const implementation = (async (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response(status === 204 ? null : JSON.stringify(payload), { status });
  }) as unknown as typeof fetch;
  return { calls, implementation };
}

describe("google write — scopes", () => {
  it("asks for the app-calendar scope only when the deployment enables it", () => {
    // OFF by default, because Google rejects the WHOLE authorization with
    // `invalid_scope` if the consent screen has not been configured for it —
    // which would break the working connect flow, not just the new feature.
    expect(requestedScopes({} as NodeJS.ProcessEnv)).toBe(GOOGLE_CALENDAR_SCOPE);
    expect(
      requestedScopes({ GOOGLE_APP_CALENDAR_ENABLED: "true" } as unknown as NodeJS.ProcessEnv),
    ).toBe(`${GOOGLE_CALENDAR_SCOPE} ${GOOGLE_APP_CALENDAR_SCOPE}`);
  });

  it("reads what was actually GRANTED, never what was asked for", () => {
    expect(hasAppCalendarScope(GOOGLE_CALENDAR_SCOPE)).toBe(false);
    expect(hasAppCalendarScope(`${GOOGLE_CALENDAR_SCOPE} ${GOOGLE_APP_CALENDAR_SCOPE}`)).toBe(true);
    expect(hasAppCalendarScope(null)).toBe(false);
    // A user can decline one scope of several, and every connection made before
    // this feature existed has only the first.
    expect(hasAppCalendarScope("https://www.googleapis.com/auth/calendar.events.readonly")).toBe(
      false,
    );
  });
});

describe("google write — creating an event", () => {
  it("sets conferenceDataVersion=1, which is the difference between a Meet link and none", async () => {
    const { calls, implementation } = recordingFetch({
      id: "evt-1",
      hangoutLink: "https://meet.google.com/abc-defg-hij",
    });

    const result = await insertCalendarEvent({
      accessToken: "token",
      calendarId: "showme-cal",
      event: {
        summary: "Production call",
        date: "2027-02-11",
        startTime: "14:00",
        endTime: "15:00",
        timeZone: "Europe/Stockholm",
        withConference: true,
      },
      fetchImplementation: implementation,
    });

    const call = calls[0];
    expect(call?.method).toBe("POST");
    // Without this parameter Google accepts the request, ignores conferenceData
    // entirely and hands back an event with no conference on it.
    expect(call?.url).toContain("conferenceDataVersion=1");
    expect(call?.url).toContain("/calendars/showme-cal/events");
    expect(call?.body?.conferenceData).toMatchObject({
      createRequest: { conferenceSolutionKey: { type: "hangoutsMeet" } },
    });
    expect(result.eventId).toBe("evt-1");
    expect(result.hangoutLink).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("mails the attendees from the connected account, which is the whole point", async () => {
    const { calls, implementation } = recordingFetch({ id: "evt-2" });

    await insertCalendarEvent({
      accessToken: "token",
      calendarId: "showme-cal",
      event: {
        summary: "Load-in",
        date: "2027-02-12",
        attendeeEmails: ["promoter@venue.test", "tour@act.test"],
      },
      fetchImplementation: implementation,
    });

    // `sendUpdates=all` is what actually sends the invitation. Without it the
    // attendees are recorded and never told.
    expect(calls[0]?.url).toContain("sendUpdates=all");
    expect(calls[0]?.body?.attendees).toEqual([
      { email: "promoter@venue.test" },
      { email: "tour@act.test" },
    ]);
  });

  it("gives an all-day appointment Google's EXCLUSIVE end date", async () => {
    const { calls, implementation } = recordingFetch({ id: "evt-3" });

    await insertCalendarEvent({
      accessToken: "token",
      calendarId: "showme-cal",
      event: { summary: "Festival", date: "2027-06-01", endDate: "2027-06-03" },
      fetchImplementation: implementation,
    });

    // Google's all-day `end.date` is exclusive — a three-day festival ends on the
    // 4th. Getting this wrong silently drops the last day.
    expect(calls[0]?.body?.start).toEqual({ date: "2027-06-01" });
    expect(calls[0]?.body?.end).toEqual({ date: "2027-06-04" });
  });

  it("gives a timed appointment with no end an hour, because Google demands one", async () => {
    const { calls, implementation } = recordingFetch({ id: "evt-4" });

    await insertCalendarEvent({
      accessToken: "token",
      calendarId: "showme-cal",
      event: {
        summary: "Quick call",
        date: "2027-02-13",
        startTime: "23:30",
        timeZone: "Europe/Stockholm",
      },
      fetchImplementation: implementation,
    });

    expect(calls[0]?.body?.start).toEqual({
      dateTime: "2027-02-13T23:30",
      timeZone: "Europe/Stockholm",
    });
    // Wraps past midnight rather than producing "24:30".
    expect(calls[0]?.body?.end).toEqual({
      dateTime: "2027-02-13T00:30",
      timeZone: "Europe/Stockholm",
    });
  });
});

describe("google write — editing and cancelling", () => {
  it("PATCHes rather than replaces, so the Meet link and the RSVPs survive a rename", async () => {
    const { calls, implementation } = recordingFetch({ id: "evt-5" });

    await patchCalendarEvent({
      accessToken: "token",
      calendarId: "showme-cal",
      eventId: "evt-5",
      event: { summary: "Renamed", date: "2027-02-14" },
      fetchImplementation: implementation,
    });

    // A full PUT would drop the conference Google minted and every response an
    // attendee has given.
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.url).toContain("/events/evt-5");
  });

  it("tells the attendees when it is cancelled", async () => {
    const { calls, implementation } = recordingFetch(null, 204);

    await deleteCalendarEvent({
      accessToken: "token",
      calendarId: "showme-cal",
      eventId: "evt-6",
      fetchImplementation: implementation,
    });

    expect(calls[0]?.method).toBe("DELETE");
    // An attendee never told the meeting is off still has it in their calendar,
    // which is worse than never having been invited.
    expect(calls[0]?.url).toContain("sendUpdates=all");
  });
});

describe("google write — the dedicated calendar", () => {
  it("CREATES the calendar without listing first, because the scope forbids listing", async () => {
    const { calls, implementation } = recordingFetch({ id: "showme-cal" });

    const id = await createAppCalendar({
      accessToken: "token",
      summary: "shoWMe",
      fetchImplementation: implementation,
    });

    expect(id).toBe("showme-cal");
    // ONE call, and it is the insert. An earlier version listed
    // `users/me/calendarList` first to find an existing calendar — but that method
    // is NOT authorized under `calendar.app.created` (checked against Google's
    // reference), so it would have answered 403 on every call. Worse, `googleWrite`
    // maps 403 to GoogleAuthorizationRevokedError, which the sync reacts to by
    // marking the connection as needing reconnection — so the first push would
    // have told every user their working Google connection had been revoked.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toMatch(/\/calendars$/);
    expect(calls.some((call) => call.url.includes("calendarList"))).toBe(false);
  });

  it("refuses to invent an id when Google does not return one", async () => {
    const { implementation } = recordingFetch({});
    await expect(
      createAppCalendar({
        accessToken: "token",
        summary: "shoWMe",
        fetchImplementation: implementation,
      }),
    ).rejects.toThrow(/no id/);
  });
});
