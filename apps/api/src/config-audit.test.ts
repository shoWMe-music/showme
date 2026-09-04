/**
 * The configuration audit — the thing that makes a stripped environment variable
 * loud instead of silent.
 *
 * What these assert is not "the report has the right shape" but the property the
 * module exists for: for every integration that degrades quietly, the audit says
 * so, and in production it says so at ERROR with the user-visible symptom
 * attached. The failure being defended against is a `gcloud run deploy
 * --set-env-vars` that replaces the whole set and drops one variable from a
 * healthy service, which is how ClickUp 86cbaxw0w started.
 */
import { describe, expect, it, vi } from "vitest";
import {
  type ConfigurationLogger,
  auditConfiguration,
  logConfigurationAudit,
  missingInProduction,
} from "./lib/config-audit";

/** Every variable a fully-configured production deployment carries. */
const COMPLETE_ENVIRONMENT: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  FIREBASE_STORAGE_BUCKET: "music-showme.firebasestorage.app",
  FIREBASE_PROJECT_ID: "music-showme",
  BREVO_API_KEY: "xkeysib-test",
  BREVO_SENDER: "no-reply@showme.music",
  PUBLIC_APP_BASE_URL: "https://showme-app.web.app",
  SHARE_JWT_SECRET: "share-secret",
  CORS_ALLOWED_ORIGINS: "https://showme.music",
  CLICKUP_API_TOKEN: "pk_test",
  CLICKUP_LEADS_LIST_ID: "901524890050",
  MAPBOX_ACCESS_TOKEN: "pk.test",
  GOOGLE_OAUTH_CLIENT_ID: "id",
  GOOGLE_OAUTH_CLIENT_SECRET: "secret",
  CALENDAR_TOKEN_ENCRYPTION_KEY: "a".repeat(44),
  GOOGLE_CALENDAR_WEBHOOK_URL: "https://api.showme.music/hook",
};

function createLogger(): ConfigurationLogger & {
  errors: { details: object; message: string }[];
  infos: { details: object; message: string }[];
} {
  const errors: { details: object; message: string }[] = [];
  const infos: { details: object; message: string }[] = [];
  return {
    errors,
    infos,
    error: (details, message) => errors.push({ details, message }),
    info: (details, message) => infos.push({ details, message }),
  };
}

function find(environment: NodeJS.ProcessEnv, subsystem: string) {
  const entry = auditConfiguration(environment).find((row) => row.subsystem === subsystem);
  if (!entry) throw new Error(`no such subsystem in the audit: ${subsystem}`);
  return entry;
}

describe("auditConfiguration — presence, and only presence", () => {
  it("reports a fully-configured production deployment as missing nothing", () => {
    expect(missingInProduction(auditConfiguration(COMPLETE_ENVIRONMENT))).toEqual([]);
  });

  it("catches the one variable that started this: FIREBASE_STORAGE_BUCKET", () => {
    const stripped = { ...COMPLETE_ENVIRONMENT };
    stripped.FIREBASE_STORAGE_BUCKET = undefined;

    const storage = find(stripped, "File storage");
    expect(storage.configured).toBe(false);
    expect(storage.requiredInProduction).toBe(true);
    expect(missingInProduction(auditConfiguration(stripped)).map((row) => row.subsystem)).toEqual([
      "File storage",
    ]);
  });

  /**
   * An empty string is what a `--set-env-vars` that names a variable with no value
   * leaves behind, and `FIREBASE_STORAGE_BUCKET=""` would take the `if (bucketName)`
   * branch in `defaultStorageSigner` as falsy — so the audit has to agree with it,
   * or the report would say "configured" about a deployment that refuses uploads.
   */
  it("treats an empty or whitespace-only value as unset, matching the factories", () => {
    expect(
      find({ ...COMPLETE_ENVIRONMENT, FIREBASE_STORAGE_BUCKET: "" }, "File storage").configured,
    ).toBe(false);
    expect(
      find({ ...COMPLETE_ENVIRONMENT, FIREBASE_STORAGE_BUCKET: "   " }, "File storage").configured,
    ).toBe(false);
  });

  /**
   * `createEmailSink` needs BOTH Brevo variables and `createCalendarIntegration`
   * needs all THREE Google ones. Reporting half a credential set as configured
   * would be a worse lie than saying nothing — the deployment would read as
   * healthy and still send no mail.
   */
  it("is all-or-nothing on multi-variable subsystems, as the factories are", () => {
    const halfBrevo = { ...COMPLETE_ENVIRONMENT };
    halfBrevo.BREVO_SENDER = undefined;
    expect(find(halfBrevo, "Email delivery").configured).toBe(false);

    const twoOfThreeGoogle = { ...COMPLETE_ENVIRONMENT };
    twoOfThreeGoogle.CALENDAR_TOKEN_ENCRYPTION_KEY = undefined;
    expect(find(twoOfThreeGoogle, "Google Calendar integration").configured).toBe(false);
  });

  /**
   * Mapbox and Google Calendar genuinely are optional — a production deployment
   * without them is running without a feature, not broken — so they must not
   * appear in `missingInProduction` and turn every boot into a false alarm.
   */
  it("keeps genuinely optional integrations out of the production-missing list", () => {
    const noOptionalFeatures = { ...COMPLETE_ENVIRONMENT };
    noOptionalFeatures.MAPBOX_ACCESS_TOKEN = undefined;
    noOptionalFeatures.GOOGLE_OAUTH_CLIENT_ID = undefined;
    noOptionalFeatures.GOOGLE_CALENDAR_WEBHOOK_URL = undefined;

    const report = auditConfiguration(noOptionalFeatures);
    expect(find(noOptionalFeatures, "Address autocomplete").configured).toBe(false);
    expect(missingInProduction(report)).toEqual([]);
  });

  /** Presence-only. A report that leaked values would be a credential dump. */
  it("never returns a variable's value", () => {
    const serialized = JSON.stringify(auditConfiguration(COMPLETE_ENVIRONMENT));
    expect(serialized).not.toContain("xkeysib-test");
    expect(serialized).not.toContain("pk_test");
    expect(serialized).toContain("BREVO_API_KEY");
  });

  /**
   * DATABASE_URL is the one variable with no optional path — `loadEnv` requires it
   * and boot crashes without it. Listing it here would imply the API can run
   * degraded without a database, which it cannot.
   */
  it("does not claim DATABASE_URL is an optional subsystem", () => {
    const named = auditConfiguration(COMPLETE_ENVIRONMENT).flatMap((row) => row.variables);
    expect(named).not.toContain("DATABASE_URL");
  });
});

describe("logConfigurationAudit — loud in production, quiet on a laptop", () => {
  it("logs one ERROR per missing required subsystem, naming the symptom", () => {
    const logger = createLogger();
    const stripped = { ...COMPLETE_ENVIRONMENT };
    stripped.FIREBASE_STORAGE_BUCKET = undefined;
    stripped.BREVO_API_KEY = undefined;

    logConfigurationAudit(logger, stripped);

    expect(logger.errors).toHaveLength(2);
    const storageError = logger.errors.find((entry) => entry.message.includes("File storage"));
    expect(storageError?.message).toContain("Every upload fails");
    expect(storageError?.details).toMatchObject({ variables: ["FIREBASE_STORAGE_BUCKET"] });
    expect(logger.infos.at(-1)?.message).toContain("INCOMPLETE");
  });

  it("says so plainly when a production deployment is complete", () => {
    const logger = createLogger();
    logConfigurationAudit(logger, COMPLETE_ENVIRONMENT);

    expect(logger.errors).toEqual([]);
    expect(logger.infos.at(-1)?.message).toBe("shoWMe API configuration complete");
  });

  /**
   * A laptop has none of this configured and that is the normal state. If the
   * absence logged as an error there, the error would stop meaning anything by the
   * time it appeared in production — which is the only place it matters.
   */
  it("never logs an error outside production, however little is configured", () => {
    const logger = createLogger();
    logConfigurationAudit(logger, { NODE_ENV: "development" });

    expect(logger.errors).toEqual([]);
    expect(logger.infos).toHaveLength(1);
    expect(logger.infos[0]?.details).toMatchObject({ configured: [] });
  });

  it("returns the report it logged, so a caller can serve the same answer", () => {
    const report = logConfigurationAudit(createLogger(), COMPLETE_ENVIRONMENT);
    expect(report.every((entry) => entry.configured)).toBe(true);
  });
});

/**
 * The consequence strings are the payload — an alert that says
 * `FIREBASE_STORAGE_BUCKET is unset` makes whoever reads it go and find out what
 * that breaks, at the moment they are least able to. This asserts none is left
 * empty or reduced to restating the variable name.
 */
describe("the audit is written for the person reading the alert", () => {
  it("gives every subsystem a consequence in observable terms", () => {
    for (const entry of auditConfiguration(COMPLETE_ENVIRONMENT)) {
      expect(entry.consequence.length).toBeGreaterThan(40);
      expect(entry.consequence).not.toBe(entry.variables.join(", "));
      expect(entry.variables.length).toBeGreaterThan(0);
    }
  });

  it("uses the environment by default, so the route needs no arguments", () => {
    vi.stubEnv("FIREBASE_STORAGE_BUCKET", "a-bucket");
    expect(auditConfiguration().find((row) => row.subsystem === "File storage")?.configured).toBe(
      true,
    );
    vi.unstubAllEnvs();
  });
});
