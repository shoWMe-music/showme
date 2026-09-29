import { describe, expect, it } from "vitest";
import { riderEmptyState } from "./riderEmptyState";

describe("what an empty riders card may claim", () => {
  it("says nothing about the EVENT to a reader whose answer is scoped", () => {
    /*
     * QA sweep run 13: a crew member read "Nothing has been submitted for this show yet" about two
     * riders that exist. `GET /events/:id/riders` answered `200 []` correctly — crew rider reach is
     * opt-in (decisions #12) — so the emptiness was the READER's, and the sentence claimed it was
     * the show's.
     */
    const scoped = riderEmptyState(false);
    expect(scoped).not.toContain("this show");
    expect(scoped).not.toContain("submitted");
    expect(scoped).toBe("Nothing has arrived for you to read yet.");
  });

  it("still says the plain thing to a reader who sees every rider — THE CONTROL", () => {
    // So the sentence above is the SCOPE and not the card having given up on saying anything.
    expect(riderEmptyState(true)).toBe("No riders or documents yet.");
  });

  it("gives the two readers DIFFERENT sentences", () => {
    // One string for both would make the flag decide nothing — the state the card was in.
    expect(riderEmptyState(true)).not.toBe(riderEmptyState(false));
  });

  it("never claims the show is empty on the scoped branch, whatever the wording becomes", () => {
    /*
     * The one assertion worth keeping if the copy is rewritten: the scoped sentence may not assert
     * anything about the event or about other parties. Checked as a claim rather than as a string.
     */
    const scoped = riderEmptyState(false).toLowerCase();
    for (const forbidden of ["show", "event", "nobody", "no one", "anyone", "parties"]) {
      expect(scoped, `scoped sentence must not mention "${forbidden}"`).not.toContain(forbidden);
    }
  });
});
