/**
 * The Events screen's filter chips, as queries.
 *
 * `useEventList` itself needs React and TanStack Query, but the part worth
 * asserting does not: `eventListQuery` is the entire filtering rule, since nothing
 * is filtered in the browser. Every case here is a rule that reads as arbitrary
 * from the call site and whose failure is silent — a wrong query returns a SHORTER
 * LIST, which is indistinguishable from a customer who has fewer shows.
 */
import { describe, expect, it } from "vitest";
import { type EventFilterKey, eventListQuery } from "./useEventList";

const ALL_CHIPS: EventFilterKey[] = ["all", "pending", "on_hold", "concluded", "draft", "archived"];

describe("eventListQuery", () => {
  /**
   * "Pending" means "awaiting a response", and that is TWO row values: `pending`
   * and `suggested` (an offer nobody has answered yet). Sending only `pending`
   * would hide every unanswered offer from the chip whose entire job is to show
   * them — which is why the API's `status` takes a list.
   */
  it("asks for pending AND suggested behind the one Pending chip", () => {
    expect(eventListQuery("pending").status).toEqual(["pending", "suggested"]);
  });

  it("asks for exactly one status behind the single-status chips", () => {
    expect(eventListQuery("on_hold").status).toEqual(["on_hold"]);
    expect(eventListQuery("concluded").status).toEqual(["concluded"]);
    expect(eventListQuery("draft").status).toEqual(["draft"]);
  });

  /**
   * `undefined`, not `[]`. An empty array would serialize to `status=` and ask the
   * server for events whose status is the empty string — no rows, so "All" would
   * render an empty screen.
   */
  it("sends no status parameter at all for All", () => {
    expect(eventListQuery("all").status).toBeUndefined();
    expect(eventListQuery("all").archived).toBeUndefined();
  });

  /**
   * Archived asks a question about the READER, not about the booking: it reads
   * `event_participants.archived_at`, so it cannot be one more value in the status
   * list and travels as its own parameter. It must send NO status, or it would ask
   * for archived events of one particular status.
   */
  it("asks for archived events by the reader's filing, with no status attached", () => {
    expect(eventListQuery("archived")).toMatchObject({ archived: "only", status: undefined });
  });

  /**
   * The server's default is `exclude`, so leaving `archived` unset is what keeps
   * filed-away events out of every everyday view. A chip that set it to anything
   * else would leak them back into the list it was archived out of.
   */
  it("leaves archived unset on every other chip, so filed-away events stay hidden", () => {
    for (const chip of ALL_CHIPS.filter((one) => one !== "archived")) {
      expect(eventListQuery(chip).archived).toBeUndefined();
    }
  });

  it("pages every chip the same way", () => {
    for (const chip of ALL_CHIPS) {
      expect(eventListQuery(chip).limit).toBe(20);
    }
  });

  /**
   * The query is the react-query cache key. If two chips produced the same object
   * they would share a cache entry and show each other's rows; if one produced a
   * fresh array on every call the key would change identity each render.
   */
  it("gives each chip a distinct query", () => {
    const serialized = ALL_CHIPS.map((chip) => JSON.stringify(eventListQuery(chip)));
    expect(new Set(serialized).size).toBe(ALL_CHIPS.length);
  });

  it("is stable — the same chip asks the same question twice", () => {
    for (const chip of ALL_CHIPS) {
      expect(eventListQuery(chip)).toEqual(eventListQuery(chip));
    }
  });

  /**
   * The returned array must be a COPY of the module's constant. Handing out the
   * shared one lets a caller (or a query serializer that sorts in place) mutate the
   * chip definition itself, and the corruption would outlive the render.
   */
  it("hands out a copy, not the shared status constant", () => {
    const first = eventListQuery("pending").status;
    first?.push("cancelled");
    expect(eventListQuery("pending").status).toEqual(["pending", "suggested"]);
  });
});
