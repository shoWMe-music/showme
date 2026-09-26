import { describe, expect, it } from "vitest";
import { roomFieldText } from "./useEventInlineFields";

/**
 * "ROOM / STAGE: ASSIGNED" (QA sweep run 3 r3:165).
 *
 * The event page named the room by fetching the venue's whole room catalogue and
 * looking the id up in it. `GET /profiles/:id/stages` is a venue-MEMBERSHIP read and
 * a 404 to everyone else by design — "a venue's internal geography is not something
 * a stranger enumerates" — so on one event, one field, side by side: the host read
 * `Main Room` and the co-promoter read `Assigned`, off four retried 404s. The event
 * now carries `stageName`, and the catalogue is asked for only to offer a choice.
 */
describe("roomFieldText", () => {
  const choices = [
    { id: "", name: "No room set" },
    { id: "room-main", name: "Main Room" },
  ];

  it("names the room from the event when the catalogue is out of reach", () => {
    expect(roomFieldText("room-main", [{ id: "", name: "No room set" }], "Main Room")).toBe(
      "Main Room",
    );
  });

  it("prefers the live catalogue, so a rename in another tab wins", () => {
    expect(roomFieldText("room-main", choices, "Old Name")).toBe("Main Room");
  });

  it("still says Assigned when the id resolves to nothing at all", () => {
    expect(roomFieldText("room-main", [], null)).toBe("Assigned");
    expect(roomFieldText("room-main", [], undefined)).toBe("Assigned");
  });

  it("says nothing at all when no room is set — that is not 'Assigned'", () => {
    expect(roomFieldText("", choices, "Main Room")).toBe("");
  });
});
