import { describe, expect, it } from "vitest";
import { type OfferDraft, offerBody, offerProblem, offerProblemMessage } from "./offerDraft";

/**
 * WHAT A SENDABLE OFFER IS (QA sweep run 7, QA7-5).
 *
 * `POST /offers` and its generated hook have existed all along and the hook had **no
 * caller anywhere in `apps/web`** — so the Outgoing tab listed seeded rows no user of
 * this build could produce, and the free-tier offer cap was unreachable code.
 */
const TODAY = "2026-09-28";
const VENUE = "e2e00000-0000-4000-8000-0000000000a1";
const ACT = "e2e00000-0000-4000-8000-0000000000a2";

const draft = (over: Partial<OfferDraft> = {}): OfferDraft => ({
  targetProfileId: VENUE,
  wantedDate: "2026-12-04",
  feeMin: "",
  feeMax: "",
  pitch: "",
  onBehalfOfProfileId: "",
  ...over,
});

describe("offerProblem", () => {
  it("passes a minimal offer — a venue and a date is all the route needs", () => {
    expect(offerProblem(draft(), { today: TODAY, senderIsAnAgent: false })).toBeNull();
  });

  it("asks for the venue first, then the date", () => {
    // In the order a person fills the form in, so the message names the first thing they
    // have not done rather than the last.
    expect(
      offerProblem(draft({ targetProfileId: "", wantedDate: "" }), {
        today: TODAY,
        senderIsAnAgent: false,
      }),
    ).toBe("no-venue");
    expect(offerProblem(draft({ wantedDate: "" }), { today: TODAY, senderIsAnAgent: false })).toBe(
      "no-date",
    );
  });

  it("refuses a date that has gone, and accepts today", () => {
    expect(
      offerProblem(draft({ wantedDate: "2026-09-27" }), { today: TODAY, senderIsAnAgent: false }),
    ).toBe("date-in-the-past");
    // Tonight is a real offer — a last-minute fill is exactly when one gets sent.
    expect(
      offerProblem(draft({ wantedDate: TODAY }), { today: TODAY, senderIsAnAgent: false }),
    ).toBeNull();
  });

  it("treats a blank fee as 'not saying', not as zero", () => {
    // The route takes the key or takes nothing, and a fee range is optional in a pitch.
    expect(
      offerProblem(draft({ feeMin: "", feeMax: "" }), { today: TODAY, senderIsAnAgent: false }),
    ).toBeNull();
    expect(
      offerProblem(draft({ feeMin: "5000", feeMax: "" }), { today: TODAY, senderIsAnAgent: false }),
    ).toBeNull();
  });

  it("refuses a fee that is not a number, and a negative one", () => {
    for (const bad of ["abc", "1 000", "-5"]) {
      expect(offerProblem(draft({ feeMin: bad }), { today: TODAY, senderIsAnAgent: false })).toBe(
        "fee-not-a-number",
      );
    }
  });

  it("refuses a range that runs backwards", () => {
    expect(
      offerProblem(draft({ feeMin: "9000", feeMax: "5000" }), {
        today: TODAY,
        senderIsAnAgent: false,
      }),
    ).toBe("fee-upside-down");
    // Equal is a fixed fee, not a mistake.
    expect(
      offerProblem(draft({ feeMin: "5000", feeMax: "5000" }), {
        today: TODAY,
        senderIsAnAgent: false,
      }),
    ).toBeNull();
  });

  it("makes an AGENT name the act, and nobody else", () => {
    // #14: an agent acts on behalf of an act. An offer from an agency on nobody's behalf
    // is the "no agency attribution" defect inverted — and the route refuses the key from
    // a non-agent, so an act must not send one.
    expect(offerProblem(draft(), { today: TODAY, senderIsAnAgent: true })).toBe("no-act");
    expect(
      offerProblem(draft({ onBehalfOfProfileId: ACT }), { today: TODAY, senderIsAnAgent: true }),
    ).toBeNull();
    expect(offerProblem(draft(), { today: TODAY, senderIsAnAgent: false })).toBeNull();
  });

  it("has a sentence for every problem it can answer", () => {
    // A problem with no message disables the button and explains nothing, which is the
    // failure this pair exists to prevent.
    const problems = [
      "no-venue",
      "no-date",
      "date-in-the-past",
      "fee-not-a-number",
      "fee-upside-down",
      "no-act",
    ] as const;
    for (const problem of problems) {
      expect(offerProblemMessage(problem)).toBeTruthy();
    }
    expect(offerProblemMessage(null)).toBeNull();
  });
});

describe("offerBody", () => {
  const toMinor = (major: string) => String(Math.round(Number(major) * 100));

  it("sends only the venue and the date when nothing else was typed", () => {
    // Every optional key OMITTED rather than sent empty: the route's schema takes the key
    // or takes nothing, and "" is a value somebody typed.
    expect(offerBody(draft(), toMinor)).toEqual({
      targetProfileId: VENUE,
      // The same id twice, on purpose: an offer's target IS the venue, and
      // `venue_profile_id` is the column the operator's clash check reads (#25.1, QA7-4).
      venueProfileId: VENUE,
      wantedDate: "2026-12-04",
    });
  });

  it("converts the fees to minor units at the edge", () => {
    expect(offerBody(draft({ feeMin: "5000", feeMax: "9000" }), toMinor)).toEqual({
      targetProfileId: VENUE,
      venueProfileId: VENUE,
      wantedDate: "2026-12-04",
      offerFeeMin: "500000",
      offerFeeMax: "900000",
    });
  });

  it("trims the pitch and drops it when it is only spaces", () => {
    expect(offerBody(draft({ pitch: "  We tour in December.  " }), toMinor).pitch).toBe(
      "We tour in December.",
    );
    expect(offerBody(draft({ pitch: "   " }), toMinor)).not.toHaveProperty("pitch");
  });

  it("carries the act only when there is one", () => {
    expect(offerBody(draft({ onBehalfOfProfileId: ACT }), toMinor).onBehalfOfProfileId).toBe(ACT);
    expect(offerBody(draft(), toMinor)).not.toHaveProperty("onBehalfOfProfileId");
  });
});
