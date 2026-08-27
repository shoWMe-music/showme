import { randomUUID } from "node:crypto";
import { schema } from "@showme/db";
import { type TestDatabase, startTestDatabase } from "@showme/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sweepDueTaskReminders } from "./task-reminders";

let harness: TestDatabase;

const NOW = new Date("2026-07-20T12:00:00.000Z");
const AN_HOUR_AGO = new Date(NOW.getTime() - 60 * 60 * 1000);
const NEXT_WEEK = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000);

beforeAll(async () => {
  harness = await startTestDatabase();
});

afterAll(async () => {
  await harness?.stop();
});

/** A user, the profile they own, and the active membership joining the two. */
async function seedProfile(slug: string): Promise<{ userId: string; profileId: string }> {
  const userId = `user-${randomUUID()}`;
  await harness.db
    .insert(schema.users)
    .values({ id: userId, email: `${slug}@example.com`, kind: "operator" });
  const [profile] = await harness.db
    .insert(schema.profiles)
    .values({ kind: "operator", ownerUserId: userId, name: slug, slug })
    .returning({ id: schema.profiles.id });
  if (!profile) throw new Error("failed to seed profile");
  await harness.db
    .insert(schema.profileMembers)
    .values({ profileId: profile.id, userId, role: "owner", status: "active" });
  return { userId, profileId: profile.id };
}

/** The `task.reminder` rows one user has been sent. */
async function remindersOf(userId: string) {
  return harness.db
    .select({ title: schema.notifications.title, link: schema.notifications.link })
    .from(schema.notifications)
    .where(
      and(eq(schema.notifications.userId, userId), eq(schema.notifications.type, "task.reminder")),
    );
}

describe("sweepDueTaskReminders", () => {
  it("rings a due reminder ONCE, however many times it is swept", async () => {
    const owner = await seedProfile(`remind-once-${randomUUID()}`);
    const [task] = await harness.db
      .insert(schema.tasks)
      .values({
        title: "Chase the rider",
        ownerUserId: owner.userId,
        dueDate: "2026-07-25",
        remindAt: AN_HOUR_AGO,
      })
      .returning({ id: schema.tasks.id });
    if (!task) throw new Error("failed to seed task");

    expect(await sweepDueTaskReminders(harness.db, NOW)).toBe(1);
    const first = await remindersOf(owner.userId);
    expect(first).toHaveLength(1);
    expect(first[0]?.title).toBe("Reminder: Chase the rider");
    expect(first[0]?.link).toBe("/tasks");

    // The state, not just the count: the fire-once mark is stamped.
    const [row] = await harness.db
      .select({ remindedAt: schema.tasks.remindedAt, remindAt: schema.tasks.remindAt })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, task.id));
    expect(row?.remindedAt).not.toBeNull();
    // And `remind_at` SURVIVES — the setting is the user's, not the sweep's.
    expect(row?.remindAt?.toISOString()).toBe(AN_HOUR_AGO.toISOString());

    // The whole point. A sweep runs every few minutes; the second pass must be
    // silent, not a second bell.
    expect(await sweepDueTaskReminders(harness.db, NOW)).toBe(0);
    expect(await remindersOf(owner.userId)).toHaveLength(1);
  });

  it("leaves a future reminder, a completed task, and a task with none alone", async () => {
    const owner = await seedProfile(`remind-skips-${randomUUID()}`);
    await harness.db.insert(schema.tasks).values([
      { title: "Later", ownerUserId: owner.userId, remindAt: NEXT_WEEK },
      { title: "Done", ownerUserId: owner.userId, remindAt: AN_HOUR_AGO, completed: true },
      { title: "No reminder", ownerUserId: owner.userId },
    ]);

    expect(await sweepDueTaskReminders(harness.db, NOW)).toBe(0);
    expect(await remindersOf(owner.userId)).toHaveLength(0);

    // The completed one is still STAMPED, so it cannot lie in wait and fire the
    // moment somebody reopens the task.
    const [done] = await harness.db
      .select({ remindedAt: schema.tasks.remindedAt })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.ownerUserId, owner.userId), eq(schema.tasks.title, "Done")));
    expect(done?.remindedAt).not.toBeNull();

    const [later] = await harness.db
      .select({ remindedAt: schema.tasks.remindedAt })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.ownerUserId, owner.userId), eq(schema.tasks.title, "Later")));
    expect(later?.remindedAt).toBeNull();
  });

  it("reaches the OWNER and the ASSIGNEE, and nobody else on the event", async () => {
    const host = await seedProfile(`remind-host-${randomUUID()}`);
    const assignee = await seedProfile(`remind-assignee-${randomUUID()}`);
    const bystander = await seedProfile(`remind-bystander-${randomUUID()}`);

    const [event] = await harness.db
      .insert(schema.events)
      .values({
        hostProfileId: host.profileId,
        title: "Reminder Night",
        baseCurrency: "SEK",
        createdBy: host.userId,
      })
      .returning({ id: schema.events.id });
    if (!event) throw new Error("failed to seed event");

    const [assigneeParticipant] = await harness.db
      .insert(schema.eventParticipants)
      .values([
        { eventId: event.id, profileId: host.profileId, role: "host", status: "confirmed" },
        {
          eventId: event.id,
          profileId: assignee.profileId,
          role: "performer",
          status: "confirmed",
        },
        {
          eventId: event.id,
          profileId: bystander.profileId,
          role: "crew",
          status: "confirmed",
        },
      ])
      .returning({ id: schema.eventParticipants.id, profileId: schema.eventParticipants.profileId })
      .then((rows) => rows.filter((row) => row.profileId === assignee.profileId));
    if (!assigneeParticipant) throw new Error("failed to seed participant");

    await harness.db.insert(schema.tasks).values({
      title: "Load in the backline",
      eventId: event.id,
      ownerProfileId: host.profileId,
      assigneeParticipantId: assigneeParticipant.id,
      remindAt: AN_HOUR_AGO,
    });

    expect(await sweepDueTaskReminders(harness.db, NOW)).toBe(1);
    const hostBell = await remindersOf(host.userId);
    expect(hostBell).toHaveLength(1);
    // An event task links to its workspace, not the standalone Tasks screen.
    expect(hostBell[0]?.link).toBe(`/events/${event.id}`);
    expect(await remindersOf(assignee.userId)).toHaveLength(1);
    // A to-do is one party's slice. The crew on the bill are not told what the
    // operator handed to the performer.
    expect(await remindersOf(bystander.userId)).toHaveLength(0);
  });

  it("honours the tasks notification preference — off means no row at all", async () => {
    const owner = await seedProfile(`remind-muted-${randomUUID()}`);
    await harness.db
      .insert(schema.notificationPreferences)
      .values({ userId: owner.userId, category: "tasks", inApp: false, email: false });

    await harness.db.insert(schema.tasks).values({
      title: "Do not tell me",
      ownerUserId: owner.userId,
      remindAt: AN_HOUR_AGO,
    });

    // The task IS claimed (the sweep did its work); the bell simply stays silent.
    expect(await sweepDueTaskReminders(harness.db, NOW)).toBe(1);
    expect(await remindersOf(owner.userId)).toHaveLength(0);
  });
});
