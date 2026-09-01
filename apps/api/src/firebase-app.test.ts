import { describe, expect, it } from "vitest";
import { createFirebaseStorageSigner } from "./lib/storage";

/**
 * A PUBLIC route may need a signed URL, and nothing on that path verifies a
 * token.
 *
 * Firebase Admin used to be initialised as a side effect of `createFirebaseToken
 * Verifier` — so on any request WITHOUT a token, `initializeApp()` never ran and
 * the storage signer threw "The default Firebase app does not exist". It reached
 * production: a published profile whose picture was an uploaded file returned a
 * 500 from `GET /public/profiles/:slug`, while every authenticated route was
 * fine because the verifier had run first.
 *
 * This asserts the property that was missing: the signer must stand on its own.
 * It cannot assert a successful SIGN here — that needs real Google credentials —
 * so it asserts the one failure that proves the bug is back, and treats every
 * other outcome (including a credentials error) as the app having existed.
 */
describe("the storage signer does not depend on a token having been verified", () => {
  it("never fails with 'The default Firebase app does not exist'", async () => {
    const signer = createFirebaseStorageSigner("example-bucket.appspot.com");
    let message = "";
    try {
      await signer.signDownload("profiles/whoever/avatar.png");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    // The bug's exact signature. Any other error is the environment lacking
    // credentials, which is expected in a test and is NOT what this guards.
    expect(message).not.toContain("default Firebase app does not exist");
  });
});
