import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { newShareToken } from "./shareToken";

const originalCrypto = globalThis.crypto;

function setCrypto(value: unknown) {
  Object.defineProperty(globalThis, "crypto", {
    value,
    configurable: true,
    writable: true,
  });
}

describe("newShareToken", () => {
  beforeEach(() => {
    setCrypto(originalCrypto);
  });

  afterEach(() => {
    setCrypto(originalCrypto);
  });

  it("returns crypto.randomUUID() when available", () => {
    setCrypto({
      randomUUID: () => "uuid-from-mock",
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i;
        return arr;
      },
    });
    expect(newShareToken()).toBe("uuid-from-mock");
  });

  it("falls back to share- prefix using getRandomValues when randomUUID is missing", () => {
    setCrypto({
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) {
          arr[i] = Math.floor(Math.random() * 256);
        }
        return arr;
      },
    });
    const token = newShareToken();
    expect(token.startsWith("share-")).toBe(true);
    expect(token.length).toBeGreaterThan(20);
  });

  it("falls back to share- prefix using Math.random when no crypto APIs exist", () => {
    setCrypto(undefined);
    const token = newShareToken();
    expect(token.startsWith("share-")).toBe(true);
    expect(token.length).toBeGreaterThan(20);
  });

  it("produces 1000 distinct values under the Math.random fallback", () => {
    setCrypto(undefined);
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      set.add(newShareToken());
    }
    expect(set.size).toBe(1000);
  });
});
