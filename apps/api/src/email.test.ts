import { describe, expect, it, vi } from "vitest";
import { createBrevoEmailSink, createEmailSink, createNoopEmailSink } from "./lib/email";

/** Unit coverage for the Brevo email sink: request shape, error surfacing, factory. */
describe("email sink", () => {
  it("posts the Brevo SMTP payload with the api-key header", async () => {
    const fetchImplementation = vi.fn(async () => new Response("", { status: 201 }));
    const sink = createBrevoEmailSink({
      apiKey: "secret-key",
      sender: "noreply@showme.test",
      fetchImplementation: fetchImplementation as unknown as typeof fetch,
    });

    await sink.sendEmail({
      to: "guest@example.com",
      subject: "Hi",
      html: "<p>Hi</p>",
      text: "Hi",
      replyTo: "host@example.com",
    });

    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImplementation.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((init.headers as Record<string, string>)["api-key"]).toBe("secret-key");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      sender: { email: "noreply@showme.test" },
      to: [{ email: "guest@example.com" }],
      subject: "Hi",
      htmlContent: "<p>Hi</p>",
      textContent: "Hi",
      replyTo: { email: "host@example.com" },
    });
  });

  it("throws a descriptive error on a non-2xx response", async () => {
    const fetchImplementation = vi.fn(
      async () => new Response("bad request detail", { status: 400 }),
    );
    const sink = createBrevoEmailSink({
      apiKey: "k",
      sender: "s@showme.test",
      fetchImplementation: fetchImplementation as unknown as typeof fetch,
    });

    await expect(sink.sendEmail({ to: "x@example.com", subject: "s" })).rejects.toThrow(
      /Brevo email send failed \(400\): bad request detail/,
    );
  });

  it("the no-op sink resolves without sending", async () => {
    const log = vi.fn();
    const sink = createNoopEmailSink(log);
    await sink.sendEmail({ to: "x@example.com", subject: "s" });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("the factory returns the real sink only when both key and sender are set", async () => {
    const fetchImplementation = vi.fn(async () => new Response("", { status: 200 }));
    // The real sink captures the global fetch at construction, so stub it first.
    const globalFetch = globalThis.fetch;
    globalThis.fetch = fetchImplementation as unknown as typeof fetch;
    try {
      const configured = createEmailSink({ brevoApiKey: "k", brevoSender: "s@showme.test" });
      await configured.sendEmail({ to: "a@example.com", subject: "s" });
      expect(fetchImplementation).toHaveBeenCalledTimes(1); // real sink → one fetch

      const unconfigured = createEmailSink({ brevoApiKey: "k" });
      await unconfigured.sendEmail({ to: "a@example.com", subject: "s" });
      expect(fetchImplementation).toHaveBeenCalledTimes(1); // still 1 — no-op didn't fetch
    } finally {
      globalThis.fetch = globalFetch;
    }
  });
});
