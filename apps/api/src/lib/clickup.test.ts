import { describe, expect, it } from "vitest";
import { createClickUpLeadSink } from "./clickup";

/** Capture the outgoing ClickUp request bodies via an injected fetch. */
function recordingFetch() {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImplementation = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImplementation };
}

describe("createClickUpLeadSink", () => {
  it("tags the task with the lowercased role and drops it from the description", async () => {
    const { calls, fetchImplementation } = recordingFetch();
    const sink = createClickUpLeadSink({ apiToken: "pk_x", listId: "123", fetchImplementation });

    await sink.captureLead({
      name: "Ada Lovelace",
      email: "ada@example.com",
      message: "hi there",
      role: "Booking agent",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.clickup.com/api/v2/list/123/task");
    // Role becomes a tag (lowercased to match the seeded space tags) …
    expect(calls[0]?.body.tags).toEqual(["booking agent"]);
    expect(calls[0]?.body.name).toBe("Ada Lovelace — ada@example.com");
    // … and is no longer duplicated into the description.
    expect(calls[0]?.body.description).not.toContain("Role:");
    expect(calls[0]?.body.description).toContain("hi there");
  });

  it("omits the tags field entirely when no role is provided", async () => {
    const { calls, fetchImplementation } = recordingFetch();
    const sink = createClickUpLeadSink({ apiToken: "pk_x", listId: "123", fetchImplementation });

    await sink.captureLead({ name: "Ada", email: "ada@example.com", message: "hi" });

    expect("tags" in (calls[0]?.body ?? {})).toBe(false);
  });

  it("throws on a non-2xx response so a lead is never silently dropped", async () => {
    const fetchImplementation = (async () =>
      new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const sink = createClickUpLeadSink({ apiToken: "pk_x", listId: "123", fetchImplementation });

    await expect(
      sink.captureLead({ name: "Ada", email: "ada@example.com", message: "hi" }),
    ).rejects.toThrow(/ClickUp task creation failed \(500\)/);
  });
});
