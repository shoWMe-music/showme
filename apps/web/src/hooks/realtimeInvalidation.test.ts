import {
  getGetApiV1EventsIdBudgetsBidLinesQueryKey,
  getGetApiV1EventsIdChangeRequestQueryKey,
  getGetApiV1EventsIdDealsQueryKey,
  getGetApiV1EventsIdHoldQueryKey,
  getGetApiV1EventsIdQueryKey,
  getGetApiV1EventsIdScheduleQueryKey,
  getGetApiV1EventsIdSettlementsQueryKey,
  getGetApiV1EventsQueryKey,
  getGetApiV1NotificationsQueryKey,
} from "@showme/api-client";
import { describe, expect, it } from "vitest";
import { isEventQueryKey } from "./realtimeInvalidation";

/**
 * WHAT A FRAME ABOUT ONE EVENT MAKES STALE (QA sweep run 6, QA6-3).
 *
 * `useRealtimeStream` listed seven query keys by hand where the generated client
 * exposes twenty-four for an event, and the missing one that mattered was the change
 * request: a crew member watched *"Waiting on 2 people to answer"* minutes after the
 * night had moved. These assert the RULE — every read under this event's path — so a
 * route added later needs no line anywhere.
 */
const EVENT = "e2e00000-0000-4000-8000-0000000000e1";
const OTHER = "e2e00000-0000-4000-8000-0000000000e2";

describe("isEventQueryKey", () => {
  it("matches the event's own read", () => {
    expect(isEventQueryKey(getGetApiV1EventsIdQueryKey(EVENT), EVENT)).toBe(true);
  });

  it("matches the change request — the read whose absence was the defect", () => {
    expect(isEventQueryKey(getGetApiV1EventsIdChangeRequestQueryKey(EVENT), EVENT)).toBe(true);
  });

  it("matches every other sub-resource the seven-key list left out", () => {
    // Each of these drives a live surface the frame used to leave asserting the
    // opposite of the truth: the hold panel's queue, the schedule a call time comes
    // from, the settlement board.
    expect(isEventQueryKey(getGetApiV1EventsIdHoldQueryKey(EVENT), EVENT)).toBe(true);
    expect(isEventQueryKey(getGetApiV1EventsIdScheduleQueryKey(EVENT), EVENT)).toBe(true);
    expect(isEventQueryKey(getGetApiV1EventsIdSettlementsQueryKey(EVENT), EVENT)).toBe(true);
    expect(isEventQueryKey(getGetApiV1EventsIdDealsQueryKey(EVENT), EVENT)).toBe(true);
  });

  it("matches a NESTED read, which no hand-written list could express in one line", () => {
    expect(
      isEventQueryKey(getGetApiV1EventsIdBudgetsBidLinesQueryKey(EVENT, "a-budget-id"), EVENT),
    ).toBe(true);
  });

  it("leaves another event's reads alone", () => {
    expect(isEventQueryKey(getGetApiV1EventsIdQueryKey(OTHER), EVENT)).toBe(false);
    expect(isEventQueryKey(getGetApiV1EventsIdDealsQueryKey(OTHER), EVENT)).toBe(false);
  });

  it("does not match an event whose id merely STARTS with this one", () => {
    // The segment boundary is part of the test, so a prefix is not a match. Ids are
    // uuids today and this cannot happen; it is asserted because the rule is a string
    // comparison and that is the way a string comparison goes wrong.
    expect(isEventQueryKey(getGetApiV1EventsIdQueryKey(`${EVENT}-and-more`), EVENT)).toBe(false);
  });

  it("leaves the events LIST and the bell alone", () => {
    // The list is not this event's read — it is every event's, and it is invalidated
    // where it is written to rather than on every frame about one night.
    expect(isEventQueryKey(getGetApiV1EventsQueryKey(), EVENT)).toBe(false);
    expect(isEventQueryKey(getGetApiV1NotificationsQueryKey(), EVENT)).toBe(false);
  });

  it("ignores a non-string key part", () => {
    // The Messages tab keys its own queries as `["event-messages", eventId]`, and the
    // hook invalidates those by their own key. A bare id must not be read as a path.
    expect(isEventQueryKey(["event-messages", EVENT], EVENT)).toBe(false);
    expect(isEventQueryKey([{ scope: EVENT }, 42], EVENT)).toBe(false);
  });
});
