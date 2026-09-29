import { ApiError } from "@showme/api-client";
import { describe, expect, it } from "vitest";
import {
  ENTITLEMENT_REQUIRED_CODE,
  errorMessage,
  isEntitlementError,
  isPermissionRefusal,
} from "./errors";

/**
 * A REFUSAL IS NOT A FAILURE, AND NOT A CAPABILITY NAME (QA sweep run 3).
 *
 * The API's own wording — `Missing capability: deal.view.own` — reached the screen in
 * two measured places: a view-only co-operator's Deals tab printed it as the whole
 * explanation, and a performer pressing a Remove they never had got it as a toast. It
 * names an internal identifier, implies the reader did something wrong, and offers no
 * way forward.
 *
 * The plan refusal is the case that must NOT be swallowed: an upgrade really does fix
 * that one, so its own message has to survive.
 */
describe("errorMessage", () => {
  it("puts a permission refusal in words a person can act on", () => {
    const refusal = new ApiError(403, "forbidden", "Missing capability: deal.view.own");
    const message = errorMessage(refusal);

    expect(message).not.toContain("deal.view.own");
    expect(message).not.toContain("capability");
    expect(message).toContain("isn't shared with you");
  });

  it("keeps a plan refusal's own message, because an upgrade fixes that one", () => {
    const planned = new ApiError(403, ENTITLEMENT_REQUIRED_CODE, "Free plan event limit reached");

    expect(errorMessage(planned)).toBe("Free plan event limit reached");
    expect(isEntitlementError(planned)).toBe(true);
    expect(isPermissionRefusal(planned)).toBe(false);
  });

  it("leaves every other status alone", () => {
    expect(errorMessage(new ApiError(409, "conflict", "This settlement is fully paid"))).toBe(
      "This settlement is fully paid",
    );
    expect(errorMessage(new ApiError(404, "not_found", "Task not found"))).toBe("Task not found");
    expect(errorMessage(new Error("network down"))).toBe("network down");
    expect(errorMessage(null, "Something went wrong.")).toBe("Something went wrong.");
  });
});

describe("isPermissionRefusal", () => {
  it("is true only for a non-plan 403", () => {
    expect(isPermissionRefusal(new ApiError(403, "forbidden", "nope"))).toBe(true);
    expect(isPermissionRefusal(new ApiError(403, ENTITLEMENT_REQUIRED_CODE, "upgrade"))).toBe(
      false,
    );
    expect(isPermissionRefusal(new ApiError(404, "not_found", "gone"))).toBe(false);
    expect(isPermissionRefusal(new Error("boom"))).toBe(false);
  });
});

describe("a 409 written for an API caller, said to a person", () => {
  const sealed = (message: string) => new ApiError(409, "terms_sealed", message);

  it("replaces the field name and the HTTP route with a sentence and the control", () => {
    /*
     * What the operator was shown (QA sweep run 12), character for character from
     * `routes/deals.ts`:
     *
     *   "A party has already signed this agreement, so agreementBodyText cannot change — their
     *    signature is on the figures as they stand. Reopen it for renegotiation first, which tears
     *    every signature up: POST /deals/36ff1176-1333-4f85-bdbb-383bad290d67/reopen"
     */
    const said = errorMessage(
      sealed(
        "A party has already signed this agreement, so agreementBodyText cannot change — their signature is on the figures as they stand. Reopen it for renegotiation first, which tears every signature up: POST /deals/36ff1176-1333-4f85-bdbb-383bad290d67/reopen",
      ),
    );
    expect(said).not.toContain("agreementBodyText");
    expect(said).not.toContain("POST /deals");
    expect(said).not.toContain("36ff1176");
    // And it names the control that is on the card, so the reader has somewhere to go.
    expect(said).toContain("Reopen it");
  });

  it("says the same thing for the CONFIRMED wording, which is the route's other branch", () => {
    // Both branches carry the route; the code is what they share, and matching the code is what
    // makes one sentence cover both.
    const said = errorMessage(
      sealed(
        "These terms are frozen — guaranteeAmount cannot change on a confirmed agreement. Reopen it for renegotiation first: POST /deals/abc/reopen",
      ),
    );
    expect(said).not.toContain("guaranteeAmount");
    expect(said).not.toContain("POST /deals");
  });

  it("LEAVES EVERY OTHER 409 ALONE — they are already addressed to their reader", () => {
    /*
     * The reason this matches a code and not `code === "conflict"`: a blanket map would have
     * replaced four good sentences to fix one bad one. These are the other 409s the deals route
     * throws, verbatim.
     */
    for (const message of [
      "Deal was changed by someone else; reload and retry",
      "Only a draft agreement can be sent",
      "Only an agreement somebody has signed can be reopened",
      "This agreement cannot be deleted.",
    ]) {
      expect(errorMessage(new ApiError(409, "conflict", message)), message).toBe(message);
    }
  });

  it("does not swallow a 403 — the permission sentence still wins on its own status", () => {
    // THE CONTROL on the ordering: `sealedTermsRefusal` runs first in `errorMessage`, so it must
    // answer null for anything that is not its code.
    expect(errorMessage(new ApiError(403, "forbidden", "Missing capability: deal.view.own"))).toBe(
      "This part of the event isn't shared with you. Ask the host if you need it.",
    );
  });

  it("keeps a plan refusal's own reason, which an upgrade does fix", () => {
    expect(
      errorMessage(new ApiError(403, "entitlement_required", "Free plan event limit reached")),
    ).toBe("Free plan event limit reached");
  });
});
