export function newShareToken(): string {
  const c: Crypto | undefined =
    typeof globalThis !== "undefined" ? (globalThis.crypto as Crypto | undefined) : undefined;

  if (c && typeof c.randomUUID === "function") {
    try {
      return c.randomUUID();
    } catch {
      // fall through
    }
  }

  if (c && typeof c.getRandomValues === "function") {
    try {
      const bytes = new Uint8Array(8);
      c.getRandomValues(bytes);
      const suffix = Array.from(bytes, (b) => b.toString(36)).join("");
      return `share-${Date.now()}-${suffix}`;
    } catch {
      // fall through
    }
  }

  const suffix =
    Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  return `share-${Date.now()}-${suffix}`;
}
