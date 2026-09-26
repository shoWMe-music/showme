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
