import Fastify, { type FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { loggerOptions, sanitizeUrl } from "./logging";

/**
 * The share token in `/shares/:token` is a bearer capability (routes/shares.ts).
 * Turning the logger on without these tests would publish one to Cloud Logging
 * on every request that carries it.
 */
describe("sanitizeUrl", () => {
  it("leaves an ordinary path alone", () => {
    expect(sanitizeUrl("/api/v1/events/evt_1")).toBe("/api/v1/events/evt_1");
  });

  it("leaves an ordinary query string byte-for-byte alone", () => {
    expect(sanitizeUrl("/api/v1/events?status=confirmed&limit=25")).toBe(
      "/api/v1/events?status=confirmed&limit=25",
    );
  });

  it("masks the share token in the path", () => {
    expect(sanitizeUrl("/api/v1/shares/9f3c1adeadbeef")).toBe("/api/v1/shares/[redacted]");
  });

  it("masks the share token but keeps the sub-route readable", () => {
    expect(sanitizeUrl("/api/v1/shares/9f3c1adeadbeef/otp")).toBe("/api/v1/shares/[redacted]/otp");
    expect(sanitizeUrl("/api/v1/shares/9f3c1adeadbeef/verify")).toBe(
      "/api/v1/shares/[redacted]/verify",
    );
  });

  it("masks a token, code or otp carried in the query string", () => {
    expect(sanitizeUrl("/api/v1/anything?token=secret")).toContain("token=%5Bredacted%5D");
    expect(sanitizeUrl("/api/v1/anything?code=123456")).toContain("code=%5Bredacted%5D");
    expect(sanitizeUrl("/api/v1/anything?otp=123456")).toContain("otp=%5Bredacted%5D");
  });

  it("keeps the non-secret parameters beside a masked one", () => {
    const sanitized = sanitizeUrl("/api/v1/shares/abc?token=secret&page=2");
    expect(sanitized).toContain("page=2");
    expect(sanitized).not.toContain("secret");
    expect(sanitized).not.toContain("abc");
  });
});

describe("loggerOptions", () => {
  it("is off under test, so the suite stays silent", () => {
    expect(loggerOptions({ NODE_ENV: "test" })).toBe(false);
  });

  it("is on everywhere else", () => {
    expect(loggerOptions({ NODE_ENV: "production" })).not.toBe(false);
  });

  it("maps pino levels onto Cloud Logging severities", () => {
    const options = loggerOptions({ NODE_ENV: "production" });
    if (options === false || options === true || options === undefined) {
      throw new Error("expected logger options");
    }
    const level = options.formatters?.level;
    if (!level) throw new Error("expected a level formatter");
    expect(level("error", 50)).toEqual({ severity: "ERROR" });
    expect(level("warn", 40)).toEqual({ severity: "WARNING" });
    expect(level("info", 30)).toEqual({ severity: "INFO" });
    expect(level("fatal", 60)).toEqual({ severity: "CRITICAL" });
  });

  it("honours LOG_LEVEL", () => {
    const options = loggerOptions({ NODE_ENV: "production", LOG_LEVEL: "warn" });
    if (options === false || options === true || options === undefined) {
      throw new Error("expected logger options");
    }
    expect(options.level).toBe("warn");
  });
});

/**
 * The point of the whole change: a 500 must leave a diagnosable line behind.
 * These drive a real Fastify instance with the real options and read what
 * actually lands on the log stream.
 */
describe("what a live request actually writes", () => {
  /** Boot Fastify with the production logger, pointed at an in-memory stream. */
  async function captureLogLines(
    register: (app: ReturnType<typeof Fastify>) => void,
    request: { method: "GET"; url: string; headers?: Record<string, string> },
  ): Promise<Record<string, unknown>[]> {
    const lines: Record<string, unknown>[] = [];
    const options = loggerOptions({ NODE_ENV: "production" });
    if (options === false || options === true || options === undefined) {
      throw new Error("expected logger options");
    }
    const app = Fastify({
      logger: {
        ...options,
        stream: {
          write(line: string) {
            lines.push(JSON.parse(line));
          },
        },
      },
    });
    register(app);
    await app.ready();
    await app.inject(request);
    await app.close();
    return lines;
  }

  it("stamps every line the way Cloud Logging reads it", async () => {
    const lines = await captureLogLines(
      (app) => app.get("/api/v1/events", async () => ({ ok: true })),
      { method: "GET", url: "/api/v1/events" },
    );
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.severity).toBeTypeOf("string");
      expect(line.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(line.level).toBeUndefined();
    }
  });

  it("writes the error behind a 500 instead of swallowing it", async () => {
    const lines = await captureLogLines(
      (app) =>
        app.get("/api/v1/events", async (request: FastifyRequest) => {
          request.log.error(new Error("the database fell over"), "request failed");
          throw new Error("the database fell over");
        }),
      { method: "GET", url: "/api/v1/events" },
    );
    const errors = lines.filter((line) => line.severity === "ERROR");
    expect(errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(errors)).toContain("the database fell over");
  });

  it("never writes the caller's Firebase token", async () => {
    const lines = await captureLogLines(
      (app) => app.get("/api/v1/events", async () => ({ ok: true })),
      {
        method: "GET",
        url: "/api/v1/events",
        headers: { authorization: "Bearer a-real-looking-firebase-id-token" },
      },
    );
    expect(JSON.stringify(lines)).not.toContain("a-real-looking-firebase-id-token");
  });

  it("never writes a share token", async () => {
    const lines = await captureLogLines(
      (app) => app.get("/api/v1/shares/:token", async () => ({ ok: true })),
      { method: "GET", url: "/api/v1/shares/9f3c1adeadbeef" },
    );
    expect(JSON.stringify(lines)).not.toContain("9f3c1adeadbeef");
    expect(JSON.stringify(lines)).toContain("[redacted]");
  });
});

/**
 * The defect this covers, found in production: an invitation email refused to
 * send, the route logged `{ error }`, and Cloud Logging received `"error": {}`.
 * An Error's `message` and `stack` are NON-ENUMERABLE, so anything that clones
 * it structurally yields an empty object — and pino only registers its standard
 * error serializer under `err`, never `error`. The logger existed precisely to
 * make failures visible and was dropping the only part that mattered.
 */
describe("errors survive serialization", () => {
  /** The serializer under `name`, or a failure — never an optional call. */
  const serializer = (name: "err" | "error") => {
    const options = loggerOptions({ NODE_ENV: "production" } as NodeJS.ProcessEnv);
    if (typeof options !== "object" || options === null) throw new Error("expected options");
    const found = (options as { serializers?: Record<string, (value: unknown) => unknown> })
      .serializers?.[name];
    if (!found) throw new Error(`no \`${name}\` serializer registered`);
    return found;
  };

  it("keeps the message and stack that a structural clone would drop", () => {
    const thrown = new Error("Brevo email send failed (401): unauthorised");
    // The behaviour that made this necessary — proof, not assumption.
    expect(JSON.parse(JSON.stringify(thrown))).toEqual({});

    const serialized = serializer("error")(thrown) as Record<string, unknown>;
    expect(serialized.type).toBe("Error");
    expect(serialized.message).toBe("Brevo email send failed (401): unauthorised");
    expect(typeof serialized.stack).toBe("string");
  });

  it("serializes under pino's `err` spelling too", () => {
    const serialized = serializer("err")(new Error("boom")) as Record<string, unknown>;
    expect(serialized.message).toBe("boom");
  });

  it("unwraps the cause, where the real reason usually hides", () => {
    const thrown = new Error("invitation email failed", {
      cause: new Error("getaddrinfo ENOTFOUND api.brevo.com"),
    });
    const serialized = serializer("error")(thrown) as Record<string, unknown>;
    const cause = serialized.cause as Record<string, unknown>;
    expect(cause.message).toBe("getaddrinfo ENOTFOUND api.brevo.com");
  });

  it("passes a non-Error through untouched", () => {
    expect(serializer("error")("just a string")).toBe("just a string");
    expect(serializer("error")({ code: 42 })).toEqual({ code: 42 });
  });
});
