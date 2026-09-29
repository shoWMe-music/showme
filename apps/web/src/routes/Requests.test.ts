import { describe, expect, it } from "vitest";
import type { RequestItem } from "../hooks/useRequestInbox";
import { requesterName } from "./Requests";

/**
 * WHOSE NAME HEADS A REQUEST CARD — and it is not the same answer in both directions.
 *
 * The card was written for the INBOX, where the recipient is the reader and the only interesting
 * party is the act. The Outgoing tab reuses it whole, so every offer a performer had sent was
 * headed by that performer — the reader themself — with the venue nowhere on it, under a tab
 * whose own subtitle is *"Offers and requests you have sent, and where they stand"* (QA sweep run
 * 11). An agency with several venues in play could not tell two cards apart.
 *
 * Tested here rather than through the screen because the CHOICE is the part that was wrong: a
 * mutation that stops asking the direction passed every other suite.
 */
describe("requesterName", () => {
  const offer = (over: Partial<RequestItem> = {}) =>
    ({
      targetName: "The Lantern Hall",
      onBehalfOfName: null,
      artistName: "Marlo Vance",
      contactName: "Marlo Vance",
      ...over,
    }) as RequestItem;

  it("names the VENUE on an offer the reader sent", () => {
    expect(requesterName(offer(), "outgoing")).toBe("The Lantern Hall");
  });

  it("names the ACT on a request the reader received", () => {
    // The inbox's own question, unchanged: an agent's pitch is headed by the act, not the agency.
    expect(requesterName(offer({ onBehalfOfName: "Marlo Vance" }), "incoming")).toBe("Marlo Vance");
  });

  it("prefers the act over the agency on an incoming pitch", () => {
    expect(
      requesterName(
        offer({ onBehalfOfName: "Marlo Vance", contactName: "Astra Booking Agency" }),
        "incoming",
      ),
    ).toBe("Marlo Vance");
  });

  it("falls back to the act rather than to a blank when the target profile is gone", () => {
    // `targetName` is null only if the profile was deleted. A card headed by the act is still
    // better than one headed by nothing, which is why the chain does not stop at the first miss.
    expect(requesterName(offer({ targetName: null }), "outgoing")).toBe("Marlo Vance");
  });

  it("says so plainly when it has no name at all, in either direction", () => {
    const nameless = offer({ targetName: null, artistName: null, contactName: null });
    expect(requesterName(nameless, "outgoing")).toBe("Unknown recipient");
    expect(requesterName(nameless, "incoming")).toBe("Unknown requester");
  });
});
