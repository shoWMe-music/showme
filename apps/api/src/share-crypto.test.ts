import { describe, expect, it } from "vitest";
import {
  JWT_TTL_SECONDS,
  emailHash,
  generateOtpCode,
  generateSalt,
  hashOtpCode,
  mintShareJwt,
  normalizeEmail,
  signShareJwt,
  verifyOtpCode,
  verifyShareJwt,
} from "./lib/share-crypto";

const SECRET = "unit-test-secret";

describe("share-crypto — OTP salted hash", () => {
  it("round-trips a code through salt+SHA256 and rejects a wrong one", () => {
    const salt = generateSalt();
    const code = generateOtpCode();
    const stored = hashOtpCode(salt, code);

    expect(code).toMatch(/^\d{6}$/);
    expect(stored).not.toContain(code); // plaintext never present in the hash
    expect(verifyOtpCode(salt, code, stored)).toBe(true);
    expect(verifyOtpCode(salt, "000000", stored)).toBe(false);
  });

  it("is salted — the same code hashes differently under different salts", () => {
    const code = "123456";
    expect(hashOtpCode(generateSalt(), code)).not.toBe(hashOtpCode(generateSalt(), code));
  });

  it("hashes email case/space-insensitively", () => {
    expect(emailHash("  Foo@Example.ShowMe.Test ")).toBe(emailHash("foo@example.showme.test"));
    expect(normalizeEmail("  Foo@Example.ShowMe.Test ")).toBe("foo@example.showme.test");
  });
});

describe("share-crypto — HS256 JWT sign/verify", () => {
  it("signs and verifies a valid token, returning its claims", () => {
    const jwt = mintShareJwt("share-token", "user@example.showme.test", SECRET);
    expect(jwt.split(".")).toHaveLength(3);

    const claims = verifyShareJwt(jwt, SECRET);
    expect(claims).not.toBeNull();
    expect(claims?.token).toBe("share-token");
    expect(claims?.email).toBe("user@example.showme.test");
    expect(claims?.exp).toBe((claims?.iat ?? 0) + JWT_TTL_SECONDS);
  });

  it("rejects a tampered payload (signature no longer matches)", () => {
    const now = Date.now();
    const jwt = signShareJwt(
      {
        token: "t",
        email: "a@b.showme.test",
        iat: Math.floor(now / 1000),
        exp: Math.floor(now / 1000) + 60,
      },
      SECRET,
    );
    const [header, , signature] = jwt.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ token: "t", email: "evil@b.showme.test", iat: 0, exp: 9999999999 }),
    ).toString("base64url");
    const forged = `${header}.${forgedPayload}.${signature}`;
    expect(verifyShareJwt(forged, SECRET)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const jwt = mintShareJwt("t", "a@b.showme.test", SECRET);
    expect(verifyShareJwt(jwt, "other-secret")).toBeNull();
  });

  it("rejects an expired token", () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const jwt = signShareJwt(
      { token: "t", email: "a@b.showme.test", iat: past - 60, exp: past },
      SECRET,
    );
    expect(verifyShareJwt(jwt, SECRET)).toBeNull();
  });

  it("rejects a malformed token without throwing", () => {
    expect(verifyShareJwt("not-a-jwt", SECRET)).toBeNull();
    expect(verifyShareJwt("a.b", SECRET)).toBeNull();
  });
});
