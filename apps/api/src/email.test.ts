import { describe, expect, it, vi } from "vitest";
import { createBrevoEmailSink, createEmailSink, createNoopEmailSink } from "./lib/email";
import {
  DEFAULT_PUBLIC_APP_BASE_URL,
  formatEventDate,
  renderEventNotificationEmail,
  renderInvitationEmail,
  renderOffPlatformPerformerEmail,
  renderShareVerificationCodeEmail,
  resolvePublicAppBaseUrl,
} from "./lib/email-templates";

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

  it("prints the body locally so a code can be read, and never in production", async () => {
    // The reported bug: on `pnpm dev` nothing is configured, so the OTP mail is
    // never sent — and the sink logged only `to` and `subject`, so the six-digit
    // code existed nowhere a developer could reach it (salted+hashed in the
    // database, echoed only under SHARE_OTP_ECHO/NODE_ENV=test). The local flow
    // could not be completed by a human at all.
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      await createNoopEmailSink().sendEmail({
        to: "a@example.com",
        subject: "Your shoWMe verification code",
        text: "Verification code: 123456",
      });
      expect(JSON.stringify(info.mock.calls)).toContain("123456");

      // …and in production it is withheld: this sink is reachable there only
      // through the unconfigured-Brevo fallback, and a live code in Cloud Logging
      // is a code anyone with log access can spend. The fallback shouts instead of
      // dropping every email in silence.
      info.mockClear();
      process.env.NODE_ENV = "production";
      await createEmailSink({}).sendEmail({
        to: "a@example.com",
        subject: "Your shoWMe verification code",
        text: "Verification code: 123456",
      });
      expect(JSON.stringify(info.mock.calls)).not.toContain("123456");
      expect(JSON.stringify(error.mock.calls)).toContain("CANNOT send email");
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      info.mockRestore();
      error.mockRestore();
    }
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

/**
 * The templates: every message renders BOTH parts, every link is absolute and
 * points where the copy says it does, and the OTP message stays bare.
 */
describe("email templates", () => {
  const baseUrl = "https://app.showme.test";

  const event = {
    id: "1f0c9a4e-0000-4000-8000-000000000abc",
    title: "Live at Fasching",
    eventDate: "2026-09-12",
    venueName: "Fasching",
  };

  /** Every message must carry a real text alternative, not just markup. */
  const expectBothParts = (message: { subject: string; html: string; text: string }) => {
    expect(message.subject.length).toBeGreaterThan(0);
    expect(message.text.length).toBeGreaterThan(0);
    expect(message.html).toContain("<!doctype html>");
    expect(message.html).toContain("</html>");
    // No stylesheet, no web font, no script — the three things email clients drop.
    expect(message.html).not.toMatch(/<link\b/i);
    expect(message.html).not.toMatch(/<script\b/i);
    expect(message.html).not.toMatch(/@font-face|fonts\.googleapis/i);
    // Plain text must not smuggle markup in.
    expect(message.text).not.toMatch(/<[a-z]/i);
  };

  it("resolves the public base URL from the environment, defaulting to local dev", () => {
    expect(resolvePublicAppBaseUrl({} as NodeJS.ProcessEnv)).toBe(DEFAULT_PUBLIC_APP_BASE_URL);
    expect(DEFAULT_PUBLIC_APP_BASE_URL).toMatch(/^http:\/\/localhost:/);
    expect(
      resolvePublicAppBaseUrl({
        PUBLIC_APP_BASE_URL: "https://app.showme.test/",
      } as NodeJS.ProcessEnv),
    ).toBe("https://app.showme.test");
  });

  it("the share verification code email carries the code and NOTHING else", () => {
    const message = renderShareVerificationCodeEmail({ code: "123456", expiresInMinutes: 10 });
    expectBothParts(message);

    expect(message.text).toContain("123456");
    expect(message.html).toContain("123456");
    expect(message.text).toContain("10 minutes");

    // The deliberate omission: no link at all. A forwarded copy of this message
    // must not be enough to walk into the share on its own.
    expect(message.html).not.toMatch(/href="http/);
    expect(message.text).not.toMatch(/https?:\/\//);
    // And it names nothing about what was shared or by whom. Everything after
    // the `--` rule is the fixed shoWMe footer; the body itself must be bare.
    const body = message.text.split("\n--\n")[0] ?? "";
    expect(body.toLowerCase()).not.toContain("event");
    expect(body.toLowerCase()).not.toContain("shared");
    expect(body.toLowerCase()).not.toContain("invit");
  });

  it("the off-platform performer email names the show and links to the app", () => {
    const message = renderOffPlatformPerformerEmail({
      performerName: "Nils",
      event,
      baseUrl,
    });
    expectBothParts(message);

    expect(message.subject).toContain("Live at Fasching");
    expect(message.text).toContain("Nils");
    expect(message.text).toContain("Live at Fasching");
    expect(message.text).toContain("12 September 2026");
    expect(message.text).toContain("Fasching");
    expect(message.text).toContain(`${baseUrl}/`);
    expect(message.html).toContain(`href="${baseUrl}/"`);
  });

  it("the off-platform performer email degrades gracefully with no event", () => {
    const message = renderOffPlatformPerformerEmail({ performerName: null, event: null, baseUrl });
    expectBothParts(message);
    expect(message.subject).toBe("You've been added to a shoWMe event");
    expect(message.text).toContain(`${baseUrl}/`);
  });

  it("the invitation email links with the token instead of printing it raw", () => {
    const message = renderInvitationEmail({
      recipientName: "Nils",
      inviterName: "Anna",
      targetName: "Live at Fasching",
      targetKind: "event",
      code: null,
      token: "abc123token",
      baseUrl,
    });
    expectBothParts(message);

    expect(message.subject).toContain("Anna");
    expect(message.subject).toContain("Live at Fasching");
    expect(message.text).toContain("Anna");
    expect(message.text).toContain("the event Live at Fasching");

    // Absolute, and the token rides in the URL — never as a bare string a human
    // is asked to do something with.
    const link = `${baseUrl}/invitations/abc123token`;
    expect(message.text).toContain(link);
    expect(message.html).toContain(`href="${link}"`);
    expect(new URL(link).origin).toBe(baseUrl);
  });

  it("a code invitation shows the code and links to the app without it", () => {
    const message = renderInvitationEmail({
      inviterName: "Anna",
      targetName: "Klubb Sthlm",
      targetKind: "profile",
      code: "SHOW-ABCD-EFGH",
      token: null,
      baseUrl,
    });
    expectBothParts(message);

    expect(message.text).toContain("SHOW-ABCD-EFGH");
    expect(message.text).toContain(`${baseUrl}/`);
    // The secret is typed, not linked — it must not end up in a URL.
    expect(message.html).not.toContain("/invitations/SHOW");
  });

  it("the invitation email falls back to neutral copy with no inviter or target", () => {
    const message = renderInvitationEmail({ token: "t0ken", baseUrl });
    expectBothParts(message);
    expect(message.subject).toBe("You have been invited to shoWMe");
    expect(message.text).toContain("Someone has invited you to collaborate on shoWMe.");
  });

  it("the event notice names the event, date and venue and links to that event", () => {
    const message = renderEventNotificationEmail({ event, baseUrl });
    expectBothParts(message);

    expect(message.subject).toBe("Event update: Live at Fasching");
    expect(message.text).toContain("12 September 2026");
    expect(message.text).toContain("Fasching");

    const link = `${baseUrl}/events/${event.id}`;
    expect(message.text).toContain(link);
    expect(message.html).toContain(`href="${link}"`);

    // Privacy: an update notice fans out to every participating profile, so it
    // must never carry money or anyone else's terms.
    expect(message.text).not.toMatch(/\bSEK\b|\bEUR\b|\bfee\b|\d+[.,]\d{2}/i);
  });

  it("omits the date and venue rather than inventing them", () => {
    const message = renderEventNotificationEmail({
      event: { id: event.id, title: "Untitled show", eventDate: null, venueName: null },
      baseUrl,
    });
    expectBothParts(message);
    expect(message.text).not.toContain("Date:");
    expect(message.text).not.toContain("Venue:");
  });

  it("escapes recipient- and event-supplied text in the HTML part", () => {
    const message = renderEventNotificationEmail({
      event: { id: event.id, title: '<script>alert("x")</script>', eventDate: null },
      baseUrl,
    });
    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&lt;script&gt;");
  });

  it("formats an event date in UTC so the calendar day never shifts", () => {
    // `en-GB` long form; the comma after the weekday is ICU's, not ours.
    expect(formatEventDate("2026-01-01")).toMatch(/^Thursday,? 1 January 2026$/);
    expect(formatEventDate(null)).toBeNull();
    expect(formatEventDate("not-a-date")).toBeNull();
  });

  it("a rendered template goes over the wire to Brevo, and a 4xx throws", async () => {
    const fetchImplementation = vi.fn(async () => new Response("no such sender", { status: 400 }));
    const sink = createBrevoEmailSink({
      apiKey: "k",
      sender: "no-reply@showme.test",
      fetchImplementation: fetchImplementation as unknown as typeof fetch,
    });

    await expect(
      sink.sendEmail({
        to: "nils@example.com",
        ...renderEventNotificationEmail({ event, baseUrl }),
      }),
    ).rejects.toThrow(/Brevo email send failed \(400\)/);

    const [, init] = fetchImplementation.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    // Both parts reach Brevo — htmlContent AND textContent.
    expect(body.htmlContent).toContain("<!doctype html>");
    expect(body.textContent).toContain("Live at Fasching");
  });
});
