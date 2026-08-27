import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenVerifier } from "./auth/token-verifier";
import { calendarRoutes } from "./routes/calendar";
import { buildTestApp } from "./testing";

/** Fake verifier: the bearer token IS the uid, so tests just send `Bearer <uid>`. */
const fakeVerifier: TokenVerifier = {
  async verify(token: string) {
    return { uid: token, email: `${token}@example.showme.test`, name: token };
  },
};

let harness: TestDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  harness = await startTestDatabase();
  app = buildTestApp({ database: harness.db, tokenVerifier: fakeVerifier }, [calendarRoutes]);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await harness?.stop();
});

const auth = (uid: string) => ({ authorization: `Bearer ${uid}` });

/** Seed a user + a profile they own (owner membership), return the profile id. */
async function seedUserWithProfile(id: string): Promise<string> {
  const { db } = harness;
  await db
    .insert(schema.users)
    .values({ id, email: `${id}@example.showme.test`, kind: "operator" });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ kind: "operator", ownerUserId: id, name: id, slug: id })
    .returning();
  if (!profile) throw new Error("profile seed failed");
  await db
    .insert(schema.profileMembers)
    .values({ profileId: profile.id, userId: id, role: "owner", status: "active" });
  return profile.id;
}

describe("calendar — owner-scoped CRUD", () => {
  it("creates a personal item and lists it, filtered by date range", async () => {
    await seedUserWithProfile("c-personal");

    const june = await app.inject({
      method: "POST",
      url: "/api/v1/calendar",
      headers: auth("c-personal"),
      payload: { type: "appointment", title: "Soundcheck", date: "2026-06-15", startTime: "17:00" },
    });
    expect(june.statusCode).toBe(201);
    expect(june.json().ownerUserId).toBe("c-personal");
    expect(june.json().type).toBe("appointment");

    const august = await app.inject({
      method: "POST",
      url: "/api/v1/calendar",
      headers: auth("c-personal"),
      payload: { type: "note", title: "Tour prep", date: "2026-08-20" },
    });
    expect(august.statusCode).toBe(201);

    // Full list has both.
    const all = await app.inject({
      method: "GET",
      url: "/api/v1/calendar",
      headers: auth("c-personal"),
    });
    expect(all.statusCode).toBe(200);
    expect(all.json()).toHaveLength(2);

    // Range excludes the August item.
    const ranged = await app.inject({
      method: "GET",
      url: "/api/v1/calendar?from=2026-06-01&to=2026-06-30",
      headers: auth("c-personal"),
    });
    expect(ranged.statusCode).toBe(200);
    expect(ranged.json()).toHaveLength(1);
    expect(ranged.json()[0].title).toBe("Soundcheck");
  });

  it("creates a profile-scoped item but not for a foreign profile", async () => {
    const profileId = await seedUserWithProfile("c-owner");
    const foreignProfileId = await seedUserWithProfile("c-foreign");

    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/calendar",
      headers: auth("c-owner"),
      payload: {
        type: "task",
        title: "Profile cal",
        date: "2026-09-01",
        ownerProfileId: profileId,
      },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().ownerProfileId).toBe(profileId);
    expect(ok.json().ownerUserId).toBeNull();

    const denied = await app.inject({
      method: "POST",
      url: "/api/v1/calendar",
      headers: auth("c-owner"),
      payload: {
        type: "task",
        title: "Nope",
        date: "2026-09-01",
        ownerProfileId: foreignProfileId,
      },
    });
    expect([403, 404]).toContain(denied.statusCode);
  });

  it("updates and deletes within scope, auditing each mutation", async () => {
    await seedUserWithProfile("c-edit");
    await seedUserWithProfile("c-stranger");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/calendar",
      headers: auth("c-edit"),
      payload: { type: "appointment", title: "Meet promoter", date: "2026-10-05" },
    });
    const itemId = created.json().id;

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/calendar/${itemId}`,
      headers: auth("c-edit"),
      payload: { title: "Meet promoter (rescheduled)", date: "2026-10-06" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().title).toBe("Meet promoter (rescheduled)");
    expect(patched.json().date).toBe("2026-10-06");

    // A stranger cannot reach it.
    const foreignPatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/calendar/${itemId}`,
      headers: auth("c-stranger"),
      payload: { title: "Hijack" },
    });
    expect(foreignPatch.statusCode).toBe(404);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/calendar/${itemId}`,
      headers: auth("c-edit"),
    });
    expect(deleted.statusCode).toBe(200);

    const auditRows = await harness.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, itemId));
    const actions = auditRows.map((row) => row.action);
    expect(actions).toContain("calendar.create");
    expect(actions).toContain("calendar.update");
    expect(actions).toContain("calendar.delete");
  });
});

/* ─────────────────────────────────────────── importing an .ics file ──────── */

/** A CRLF file, the way a real exporter writes one. */
function icsFile(...lines: string[]): string {
  return `${["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//EN", ...lines, "END:VCALENDAR"].join("\r\n")}\r\n`;
}

/**
 * One file with all four shapes the brief names: an all-day entry, a timed one,
 * a folded-and-escaped SUMMARY, and something malformed.
 */
const MIXED_ICS = icsFile(
  "X-WR-CALNAME:Tour",
  "BEGIN:VEVENT",
  "UID:allday@example.test",
  "DTSTART;VALUE=DATE:20260830",
  "DTEND;VALUE=DATE:20260901",
  "SUMMARY:Festival weekend",
  "LOCATION:Gärdet\\, Stockholm",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:timed@example.test",
  "DTSTART:20260904T190000Z",
  "DTEND:20260904T220000Z",
  "SUMMARY:Club show",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:folded@example.test",
  "DTSTART;VALUE=DATE:20260910",
  "SUMMARY:Doors 19:00\\, support 20:00\\; headline 21:00 — long enough that a re",
  " al exporter would fold it here",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:broken@example.test",
  "DTSTART:whenever",
  "SUMMARY:Malformed",
  "END:VEVENT",
);

const importUrl = "/api/v1/calendar/import";

describe("calendar — .ics import", () => {
  it("previews without writing, then commits exactly what it previewed", async () => {
    const profileId = await seedUserWithProfile("c-import");
    const payload = {
      ownerProfileId: profileId,
      timeZone: "Europe/Stockholm",
      ics: MIXED_ICS,
    };

    const preview = await app.inject({
      method: "POST",
      url: importUrl,
      headers: auth("c-import"),
      payload: { ...payload, commit: false },
    });
    expect(preview.statusCode).toBe(200);
    const previewBody = preview.json();
    expect(previewBody).toMatchObject({
      committed: false,
      timeZone: "Europe/Stockholm",
      calendarName: "Tour",
      imported: 3,
      updated: 0,
      skipped: 0,
      rejected: 1,
    });
    // Nothing landed.
    expect(
      await harness.db
        .select()
        .from(schema.calendarItems)
        .where(eq(schema.calendarItems.ownerProfileId, profileId)),
    ).toHaveLength(0);

    const commit = await app.inject({
      method: "POST",
      url: importUrl,
      headers: auth("c-import"),
      payload: { ...payload, commit: true },
    });
    expect(commit.statusCode).toBe(200);
    const body = commit.json();
    expect(body).toMatchObject({ committed: true, imported: 3, updated: 0, rejected: 1 });
    // The preview promised the same verdict for every entry, in the same order.
    expect(body.results.map((result: { outcome: string }) => result.outcome)).toEqual(
      previewBody.results.map((result: { outcome: string }) => result.outcome),
    );

    const rows = await harness.db
      .select()
      .from(schema.calendarItems)
      .where(eq(schema.calendarItems.ownerProfileId, profileId));
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.type === "external")).toBe(true);
    expect(rows.every((row) => row.externalSource === "ics")).toBe(true);
    // An imported commitment occupies the night unless the user says otherwise.
    expect(rows.every((row) => row.blocksAvailability)).toBe(true);

    const byUid = new Map(rows.map((row) => [row.externalId, row]));

    // All-day: a bare day, an INCLUSIVE last day one back off the exclusive DTEND.
    expect(byUid.get("allday@example.test")).toMatchObject({
      date: "2026-08-30",
      endDate: "2026-08-31",
      startTime: null,
      endTime: null,
      entity: "Gärdet, Stockholm",
    });

    // Timed and absolute: 19:00Z is 21:00 in Stockholm on that date (CEST). The
    // 22:00Z end is midnight there, which is the END of the 4th and not the start
    // of the 5th — clamped back so one night does not block two days.
    expect(byUid.get("timed@example.test")).toMatchObject({
      date: "2026-09-04",
      endDate: null,
      startTime: "21:00:00",
      endTime: "23:59:59",
    });

    // Folded + escaped: one summary, commas and semicolons intact.
    expect(byUid.get("folded@example.test")?.title).toBe(
      "Doors 19:00, support 20:00; headline 21:00 — long enough that a real exporter would fold it here",
    );

    // The malformed one is reported, not swallowed, and never became a row.
    expect(byUid.has("broken@example.test")).toBe(false);
    const broken = body.results.find(
      (result: { uid: string | null }) => result.uid === "broken@example.test",
    );
    expect(broken.outcome).toBe("rejected");
    expect(broken.reason).toContain("whenever");

    const audits = await harness.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "calendar.import"));
    expect(audits).toHaveLength(3);
  });

  it("importing the same file twice updates in place and duplicates nothing", async () => {
    const profileId = await seedUserWithProfile("c-import-twice");
    const payload = {
      ownerProfileId: profileId,
      timeZone: "Europe/Stockholm",
      ics: MIXED_ICS,
      commit: true,
    };

    const first = await app.inject({
      method: "POST",
      url: importUrl,
      headers: auth("c-import-twice"),
      payload,
    });
    expect(first.json()).toMatchObject({ imported: 3, updated: 0 });

    // The user makes two decisions about one entry BEFORE re-importing: they take
    // the night back, and they turn it into a show. Neither may be undone by a
    // second import — they are shoWMe's answers about somebody else's event.
    const [entry] = await harness.db
      .select()
      .from(schema.calendarItems)
      .where(
        and(
          eq(schema.calendarItems.ownerProfileId, profileId),
          eq(schema.calendarItems.externalId, "allday@example.test"),
        ),
      );
    if (!entry) throw new Error("import did not write the entry");
    await harness.db
      .update(schema.calendarItems)
      .set({ blocksAvailability: false })
      .where(eq(schema.calendarItems.id, entry.id));

    const second = await app.inject({
      method: "POST",
      url: importUrl,
      headers: auth("c-import-twice"),
      payload,
    });
    expect(second.json()).toMatchObject({ imported: 0, updated: 3, rejected: 1 });

    const rows = await harness.db
      .select()
      .from(schema.calendarItems)
      .where(eq(schema.calendarItems.ownerProfileId, profileId));
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.externalId === "allday@example.test")?.blocksAvailability).toBe(
      false,
    );
  });

  it("skips a UID the file repeats, rather than failing the whole batch", async () => {
    const profileId = await seedUserWithProfile("c-import-dup");
    const twice = icsFile(
      "BEGIN:VEVENT",
      "UID:same@example.test",
      "DTSTART;VALUE=DATE:20260830",
      "SUMMARY:First",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:same@example.test",
      "DTSTART;VALUE=DATE:20260901",
      "SUMMARY:Second",
      "END:VEVENT",
    );

    const response = await app.inject({
      method: "POST",
      url: importUrl,
      headers: auth("c-import-dup"),
      payload: { ownerProfileId: profileId, ics: twice, commit: true },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ imported: 1, skipped: 1 });
    expect(response.json().results[1].reason).toContain("entry 1 of this file");

    const rows = await harness.db
      .select()
      .from(schema.calendarItems)
      .where(eq(schema.calendarItems.ownerProfileId, profileId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("First");
  });

  it("refuses to re-import shoWMe's own export of something the caller already has", async () => {
    const profileId = await seedUserWithProfile("c-import-echo");
    const [own] = await harness.db
      .insert(schema.calendarItems)
      .values({
        ownerProfileId: profileId,
        type: "appointment",
        title: "Production call",
        date: "2026-08-30",
      })
      .returning();
    if (!own) throw new Error("seed failed");

    const roundTrip = icsFile(
      "BEGIN:VEVENT",
      `UID:${own.id}@showme.music`,
      "DTSTART;VALUE=DATE:20260830",
      "SUMMARY:Production call",
      "END:VEVENT",
      "BEGIN:VEVENT",
      // Somebody else's shoWMe export: a real uuid, but not a row this caller can
      // reach — genuinely external to them, so it imports.
      "UID:11111111-2222-3333-4444-555555555555@showme.music",
      "DTSTART;VALUE=DATE:20260901",
      "SUMMARY:Someone else's show",
      "END:VEVENT",
    );

    const response = await app.inject({
      method: "POST",
      url: importUrl,
      headers: auth("c-import-echo"),
      payload: { ownerProfileId: profileId, ics: roundTrip, commit: true },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ imported: 1, skipped: 1 });
    expect(response.json().results[0].reason).toContain("shoWMe's own export");
  });

  it("refuses a file that is not a calendar, and one with no entries", async () => {
    const profileId = await seedUserWithProfile("c-import-junk");
    const send = (ics: string) =>
      app.inject({
        method: "POST",
        url: importUrl,
        headers: auth("c-import-junk"),
        payload: { ownerProfileId: profileId, ics },
      });

    const notCalendar = await send("name,email\nA,a@b.c\n");
    expect(notCalendar.statusCode).toBe(400);
    expect(notCalendar.json().error.message).toContain("BEGIN:VCALENDAR");

    const empty = await send(icsFile("X-WR-CALNAME:Nothing"));
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.message).toContain("no entries");
  });

  it("lets only an owner or admin decide the account is busy", async () => {
    const profileId = await seedUserWithProfile("c-import-owner");

    await harness.db
      .insert(schema.users)
      .values({ id: "c-import-editor", email: "editor@example.showme.test", kind: "operator" });
    await harness.db
      .insert(schema.profileMembers)
      .values({ profileId, userId: "c-import-editor", role: "editor", status: "active" });

    const asEditor = await app.inject({
      method: "POST",
      url: importUrl,
      headers: auth("c-import-editor"),
      payload: { ownerProfileId: profileId, ics: MIXED_ICS },
    });
    expect(asEditor.statusCode).toBe(403);

    const asStranger = await app.inject({
      method: "POST",
      url: importUrl,
      headers: auth("c-import-owner"),
      payload: { ownerProfileId: await seedUserWithProfile("c-import-other"), ics: MIXED_ICS },
    });
    expect(asStranger.statusCode).toBe(404);
  });

  it("falls back to the user's stored zone, and to UTC when there is none", async () => {
    const profileId = await seedUserWithProfile("c-import-zone");
    const utcRun = await app.inject({
      method: "POST",
      url: importUrl,
      headers: auth("c-import-zone"),
      payload: { ownerProfileId: profileId, ics: MIXED_ICS },
    });
    expect(utcRun.json().timeZone).toBe("UTC");

    await harness.db
      .update(schema.users)
      .set({ timezone: "America/New_York" })
      .where(eq(schema.users.id, "c-import-zone"));

    const storedRun = await app.inject({
      method: "POST",
      url: importUrl,
      headers: auth("c-import-zone"),
      payload: { ownerProfileId: profileId, ics: MIXED_ICS },
    });
    expect(storedRun.json().timeZone).toBe("America/New_York");
    // 19:00Z on 4 September is 15:00 in New York — the same instant, another clock.
    const timed = storedRun
      .json()
      .results.find((result: { uid: string | null }) => result.uid === "timed@example.test");
    expect(timed.startTime).toBe("15:00:00");

    // An unusable zone is corrected rather than trusted.
    const nonsense = await app.inject({
      method: "POST",
      url: importUrl,
      headers: auth("c-import-zone"),
      payload: { ownerProfileId: profileId, ics: MIXED_ICS, timeZone: "Mars/Olympus" },
    });
    expect(nonsense.json().timeZone).toBe("UTC");
  });
});
