/**
 * What the bill is told when an event changes (ClickUp `86cbcftg3`).
 *
 * A pure suite, and the only one in this directory that needs no database — the rules
 * worth pinning are which fields are announced, which are deliberately silent, and the
 * sentence itself. The delivery is asserted in `participants.test.ts` against the real
 * route.
 */
import { describe, expect, it } from "vitest";
import { eventChangeNotice } from "./lib/event-change-notice";

const EVENT = { title: "Winter Gala", previousTitle: "Winter Gala" };

describe("eventChangeNotice — what is worth saying", () => {
  it("names one field in a sentence", () => {
    expect(eventChangeNotice(["capacity"], EVENT)).toEqual({
      title: '"Winter Gala" was updated',
      body: "The capacity changed.",
      fields: ["capacity"],
    });
  });

  it("joins several without an Oxford comma — it is a sentence, not a list", () => {
    expect(eventChangeNotice(["eventDate", "doorTime", "capacity"], EVENT)?.body).toBe(
      "The date, the doors time and the capacity changed.",
    );
  });

  it("says nothing at all when nothing changed", () => {
    expect(eventChangeNotice([], EVENT)).toBeNull();
  });

  /**
   * The exclusion that matters. A cancellation already tells the bill the night is off,
   * with its reason; a publish already says the page went up. "The status changed"
   * underneath either is noise on top of the message that mattered.
   */
  it("says nothing when only a field announced elsewhere changed", () => {
    expect(eventChangeNotice(["status"], EVENT)).toBeNull();
    expect(eventChangeNotice(["published"], EVENT)).toBeNull();
    expect(eventChangeNotice(["status", "published"], EVENT)).toBeNull();
  });

  it("still speaks about the rest when a status move rides along", () => {
    // Confirming a booking and moving its doors time in one save: the cancellation or
    // publication notice covers the status, this covers the door.
    expect(eventChangeNotice(["status", "doorTime"], EVENT)?.body).toBe("The doors time changed.");
  });

  it("drops a field nobody has written words for", () => {
    // Unlisted is silent BY DESIGN: this sentence reaches every party, and a field with
    // no phrase is a field nobody has decided is theirs to hear about.
    expect(eventChangeNotice(["imageFileId"], EVENT)).toBeNull();
    expect(eventChangeNotice(["imageFileId", "notes"], EVENT)?.body).toBe("The notes changed.");
  });

  it("treats the venue and its profile as one change", () => {
    // Picking a venue from a profile moves both columns; a reader sees one change.
    expect(eventChangeNotice(["venueName", "venueProfileId"], EVENT)?.body).toBe(
      "The venue changed.",
    );
  });

  describe("a rename", () => {
    const renamed = { title: "Spring Gala", previousTitle: "Winter Gala" };

    it("is announced under the OLD name, and carries the new one", () => {
      // The name the reader last saw is the one they will recognise in a bell.
      expect(eventChangeNotice(["title"], renamed)).toEqual({
        title: '"Winter Gala" was renamed',
        body: 'The name changed. It is now "Spring Gala".',
        fields: ["title"],
      });
    });

    it("keeps the other fields in the same sentence", () => {
      expect(eventChangeNotice(["title", "eventDate"], renamed)?.body).toBe(
        'The name and the date changed. It is now "Spring Gala".',
      );
    });

    /**
     * The title is the ONE field whose value travels. Everything else is named and not
     * valued, because `extras` carries the guest list and `serialize/event.ts` redacts
     * several fields per reader — echoing a patch body to every participant would undo
     * that. This asserts the boundary rather than trusting it.
     */
    it("carries no other value, whatever changed", () => {
      const notice = eventChangeNotice(["title", "capacity", "notes", "extras", "curfew"], renamed);
      expect(notice?.body).toBe(
        'The name, the capacity, the notes, the ticket and guest details and the curfew changed. It is now "Spring Gala".',
      );
      // No number, no note text, no guest name — only the new title.
      expect(notice?.body).not.toMatch(/\d/);
    });
  });
});
