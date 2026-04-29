import { describe, it, expect } from "vitest";
import { parseRecipientInput } from "./parseRecipientInput";

describe("parseRecipientInput", () => {
  it("returns empty arrays for empty input", () => {
    expect(parseRecipientInput("")).toEqual({ valid: [], invalid: [] });
    expect(parseRecipientInput("   ")).toEqual({ valid: [], invalid: [] });
  });

  it("accepts a single valid email", () => {
    const r = parseRecipientInput("alice@example.com");
    expect(r.valid).toEqual(["alice@example.com"]);
    expect(r.invalid).toEqual([]);
  });

  it("trims surrounding whitespace and lower-cases", () => {
    const r = parseRecipientInput("  Alice@Example.COM  ");
    expect(r.valid).toEqual(["alice@example.com"]);
    expect(r.invalid).toEqual([]);
  });

  it("splits comma-separated lists", () => {
    const r = parseRecipientInput("alice@x.com, bob@y.com,charlie@z.com");
    expect(r.valid).toEqual(["alice@x.com", "bob@y.com", "charlie@z.com"]);
    expect(r.invalid).toEqual([]);
  });

  it("splits semicolon-separated lists", () => {
    const r = parseRecipientInput("alice@x.com;bob@y.com");
    expect(r.valid).toEqual(["alice@x.com", "bob@y.com"]);
  });

  it("splits whitespace-separated lists", () => {
    const r = parseRecipientInput("alice@x.com bob@y.com\tcharlie@z.com\ndave@q.com");
    expect(r.valid).toEqual(["alice@x.com", "bob@y.com", "charlie@z.com", "dave@q.com"]);
  });

  it("dedupes valid emails (case-insensitively)", () => {
    const r = parseRecipientInput("alice@x.com, ALICE@x.com, bob@y.com");
    expect(r.valid).toEqual(["alice@x.com", "bob@y.com"]);
  });

  it("separates invalid candidates from valid ones", () => {
    const r = parseRecipientInput("alice@x.com, not-an-email, bob@y.com, also@bad");
    expect(r.valid).toEqual(["alice@x.com", "bob@y.com"]);
    expect(r.invalid).toEqual(["not-an-email", "also@bad"]);
  });

  it("flags entirely invalid input", () => {
    const r = parseRecipientInput("hello");
    expect(r.valid).toEqual([]);
    expect(r.invalid).toEqual(["hello"]);
  });

  it("handles emails with plus addressing and dots", () => {
    const r = parseRecipientInput("foo.bar+baz@gmail.com");
    expect(r.valid).toEqual(["foo.bar+baz@gmail.com"]);
  });
});
