import { describe, expect, it } from "vitest";
import { calendarEntryActions } from "./CalendarEntryPreview";

/**
 * THE CALENDAR DAY POPOVER'S TWO ACTS — decisions §25.9.4, Daniel 2026-09-29.
 *
 * `86cbcn189` said the calendar is view-only; `123qy9rnk21`, three days later, asked this popover
 * for **Publish/Unpublish AND Invite**. Daniel: *"Do whatever the later ticket said."* Publish was
 * built; Invite was not, and was owed.
 *
 * The gates are exported and tested here rather than left inline, because a decision made inside a
 * component is a decision no test can reach — this repo's own rule after a surviving mutation on a
 * web view, and this file has no render test.
 */
describe("calendarEntryActions", () => {
  const event = {
    eventId: "e1",
    status: "confirmed",
    published: false,
    capabilities: ["event.view"],
  };

  it("offers Invite to a reader holding participants.manage", () => {
    expect(calendarEntryActions(event).mayInvite).toBe(false);
    expect(
      calendarEntryActions({ ...event, capabilities: ["event.view", "participants.manage"] })
        .mayInvite,
    ).toBe(true);
  });

  /*
   * THE CAPABILITY IS THE ROUTE'S, NOT THE NEIGHBOURING CONTROL'S. `POST /events/:id/participants`
   * authorizes `participants.manage`; publishing authorizes `event.publish`. Offering Invite to
   * somebody holding only the latter would be offering a 403 — the shape this repo has spent a week
   * removing, and the reason the two are asserted apart rather than together.
   */
  it("does not let event.publish stand in for participants.manage, or the reverse", () => {
    const publisher = calendarEntryActions({ ...event, capabilities: ["event.publish"] });
    expect(publisher.mayPublish).toBe(true);
    expect(publisher.mayInvite).toBe(false);

    const inviter = calendarEntryActions({ ...event, capabilities: ["participants.manage"] });
    expect(inviter.mayInvite).toBe(true);
    expect(inviter.mayPublish).toBe(false);
  });

  /*
   * PUBLISH NEEDS A PAGE TO PUT UP. Only a confirmed event has a public one (A-22), so a pending
   * night is offered nothing — while an already-published event can always be taken down, which is
   * the case a naive `status === "confirmed"` check loses.
   */
  it("offers Publish only where there is a page to put up or take down", () => {
    const caps = ["event.publish"];
    expect(
      calendarEntryActions({ ...event, capabilities: caps, status: "pending" }).mayPublish,
    ).toBe(false);
    expect(
      calendarEntryActions({ ...event, capabilities: caps, status: "pending", published: true })
        .mayPublish,
    ).toBe(true);
  });

  /*
   * AND A CALENDAR ITEM IS NOT AN EVENT. It has nothing to publish and nobody to invite to it, so
   * both acts are withheld however many capabilities the reader carries elsewhere.
   */
  it("offers neither act on an entry that is not an event", () => {
    const item = calendarEntryActions({
      eventId: null,
      status: "confirmed",
      published: true,
      capabilities: ["event.publish", "participants.manage"],
    });
    expect(item.mayPublish).toBe(false);
    expect(item.mayInvite).toBe(false);
  });
});
