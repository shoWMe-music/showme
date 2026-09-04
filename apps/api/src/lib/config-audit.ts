/**
 * WHAT IS SILENTLY OFF ON THIS DEPLOYMENT.
 *
 * Almost every integration in this API is optional by design: unconfigured means
 * "that feature is unavailable", not "the app refuses to boot". A laptop and a
 * Testcontainers suite must be able to run settlements without a Brevo key, a
 * Google client secret or a GCS bucket, so `createEmailSink`,
 * `createCalendarIntegration`, `createGeocoder` and `defaultStorageSigner` all
 * degrade instead of throwing.
 *
 * That is right for a laptop and dangerous in production, because the degradation
 * is INVISIBLE. `gcloud run deploy --set-env-vars` REPLACES the whole set rather
 * than merging it (docs/deploy-api.md), so one deploy that forgets a variable
 * strips it from a healthy service — and nothing errors. Email keeps "succeeding"
 * into a no-op sink. Uploads keep returning a URL to nowhere. The only trace is a
 * user, days later, saying a feature is "missing or non functional" — which is
 * exactly what happened: ClickUp 86cbaxw0w spent a session on file uploads whose
 * real story was one absent environment variable, and it could as easily have been
 * any of the other eight below.
 *
 * So this module states, once, what each variable buys and what its absence costs.
 * `server.ts` logs the result at boot — loudly, when production is missing
 * something it needs — and `GET /admin/configuration` serves the same report, so
 * "did that deploy strip anything?" is a question with an answer.
 *
 * It reads presence ONLY. It never holds, logs or returns a value: the report says
 * `BREVO_API_KEY` is set, never what it is set to.
 */

/** One integration, and what this deployment loses without it. */
export interface SubsystemConfiguration {
  /** The subsystem, named the way a person would ask about it. */
  subsystem: string;
  /** Every variable it needs. Partially set counts as unconfigured — see below. */
  variables: string[];
  /** True only when every variable in `variables` is present and non-empty. */
  configured: boolean;
  /**
   * Whether a production deployment without this is BROKEN, as opposed to merely
   * running without an optional feature. Drives the log level at boot: a missing
   * required subsystem is an `error`, an absent optional one is `info`.
   */
  requiredInProduction: boolean;
  /**
   * What happens when it is absent — phrased as the observable symptom, because
   * the symptom is the only thing anyone ever has to work backwards from.
   */
  consequence: string;
}

/**
 * All-or-nothing on purpose, matching the factories. `createEmailSink` needs BOTH
 * Brevo variables and `createCalendarIntegration` needs all THREE Google ones;
 * half a credential set is not a working integration, and reporting it as
 * "configured" because one of two variables is present would be a worse lie than
 * saying nothing.
 */
function isConfigured(environment: NodeJS.ProcessEnv, variables: string[]): boolean {
  return variables.every((variable) => {
    const value = environment[variable];
    return value !== undefined && value.trim() !== "";
  });
}

/**
 * The subsystems, in the order a reader should care about them: the ones whose
 * absence breaks a production deployment first, the genuinely optional ones last.
 *
 * `DATABASE_URL` is deliberately absent — it is the one variable that is NOT
 * optional anywhere. `loadEnv` requires it, so a deployment without it never
 * reaches this code; it crashes at boot, which is the correct and already-working
 * behaviour.
 */
const SUBSYSTEMS: Omit<SubsystemConfiguration, "configured">[] = [
  {
    subsystem: "File storage",
    variables: ["FIREBASE_STORAGE_BUCKET"],
    requiredInProduction: true,
    consequence:
      "Every upload fails: posters, avatars, banners and rider documents. The API answers 503 on the signed-URL grant, so nothing reaches storage and no partial file is left behind.",
  },
  {
    subsystem: "Token verification",
    variables: ["FIREBASE_PROJECT_ID"],
    requiredInProduction: true,
    consequence:
      "Firebase ID tokens cannot be verified, so every authenticated route rejects. Only the public routes still answer.",
  },
  {
    subsystem: "Email delivery",
    variables: ["BREVO_API_KEY", "BREVO_SENDER"],
    requiredInProduction: true,
    consequence:
      "Nothing is sent, and nothing errors — the sink falls back to logging. Invitations, share codes and settlement reviews are all best-effort by design, so every route still answers 200 while no mail leaves the building.",
  },
  {
    subsystem: "Email links",
    variables: ["PUBLIC_APP_BASE_URL"],
    requiredInProduction: true,
    consequence:
      "Every link in every email points at the local Vite dev server (http://localhost:5174). The mail sends and is useless.",
  },
  {
    subsystem: "Off-platform shares",
    variables: ["SHARE_JWT_SECRET"],
    requiredInProduction: true,
    consequence:
      "An off-platform recipient can request a one-time code and can never redeem it, so a shared settlement is unopenable from outside the platform.",
  },
  {
    subsystem: "Browser access (CORS)",
    variables: ["CORS_ALLOWED_ORIGINS"],
    requiredInProduction: true,
    consequence:
      "The allow-list falls back to the localhost dev origins, so the deployed web app and marketing site are both blocked by the browser. Server-to-server callers are unaffected, which is why this can look like 'only the website is broken'.",
  },
  {
    subsystem: "Lead capture",
    variables: ["CLICKUP_API_TOKEN", "CLICKUP_LEADS_LIST_ID"],
    requiredInProduction: true,
    consequence:
      "Marketing contact-form submissions are logged instead of forwarded to the ClickUp CRM. The form thanks the visitor either way, and the lead is gone.",
  },
  {
    subsystem: "Address autocomplete",
    variables: ["MAPBOX_ACCESS_TOKEN"],
    requiredInProduction: false,
    consequence:
      "GET /geocode answers 503 and the profile editor's address field degrades to a plain text box. Addresses still save; profile_locations.lat/.lng stay null, which is already true of every venue.",
  },
  {
    subsystem: "Google Calendar integration",
    variables: [
      "GOOGLE_OAUTH_CLIENT_ID",
      "GOOGLE_OAUTH_CLIENT_SECRET",
      "CALENDAR_TOKEN_ENCRYPTION_KEY",
    ],
    requiredInProduction: false,
    consequence:
      "The Integrations screen cannot connect a calendar — the routes answer 503 with a sentence saying so. Nothing else changes.",
  },
  {
    subsystem: "Google Calendar push notifications",
    variables: ["GOOGLE_CALENDAR_WEBHOOK_URL"],
    requiredInProduction: false,
    consequence:
      "No push channel is registered, so calendar sync is manual only. Independent of the three secrets above, and impossible on a laptop or a *.run.app URL — Google only watches a domain verified against this Cloud project.",
  },
];

/** Read the environment and report, subsystem by subsystem, what is configured. */
export function auditConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): SubsystemConfiguration[] {
  return SUBSYSTEMS.map((subsystem) => ({
    ...subsystem,
    configured: isConfigured(environment, subsystem.variables),
  }));
}

/**
 * The subset that makes a production deployment broken. Empty is the only healthy
 * answer in production; on a laptop it is expected to be long and means nothing.
 */
export function missingInProduction(
  report: SubsystemConfiguration[] = auditConfiguration(),
): SubsystemConfiguration[] {
  return report.filter((entry) => entry.requiredInProduction && !entry.configured);
}

/** Just enough of pino for this module to log through, so tests can pass a spy. */
export interface ConfigurationLogger {
  info(details: object, message: string): void;
  error(details: object, message: string): void;
}

/**
 * Announce the configuration at boot.
 *
 * In production a missing required subsystem logs at ERROR — one line per
 * subsystem, naming the variables and the consequence, so the alert says what a
 * user will report rather than what a variable is called. Outside production the
 * same information is a single INFO line: unconfigured integrations are the normal
 * state on a laptop and must not read as failures.
 *
 * It logs and returns; it never exits. A stripped `BREVO_API_KEY` should not take
 * down an API that is still settling shows correctly — refusing to boot would turn
 * a degraded deployment into an outage, which is the trade this whole file exists
 * to argue against.
 */
export function logConfigurationAudit(
  logger: ConfigurationLogger,
  environment: NodeJS.ProcessEnv = process.env,
): SubsystemConfiguration[] {
  const report = auditConfiguration(environment);
  const configured = report.filter((entry) => entry.configured).map((entry) => entry.subsystem);
  const unconfigured = report.filter((entry) => !entry.configured).map((entry) => entry.subsystem);

  if (environment.NODE_ENV !== "production") {
    logger.info({ configured, unconfigured }, "shoWMe API configuration");
    return report;
  }

  const missing = missingInProduction(report);
  for (const entry of missing) {
    logger.error(
      { subsystem: entry.subsystem, variables: entry.variables, consequence: entry.consequence },
      `Configuration missing in production: ${entry.subsystem} is unavailable. ${entry.consequence}`,
    );
  }
  logger.info(
    { configured, unconfigured, missingRequired: missing.map((entry) => entry.subsystem) },
    missing.length === 0
      ? "shoWMe API configuration complete"
      : `shoWMe API configuration INCOMPLETE — ${missing.length} required subsystem(s) unavailable`,
  );
  return report;
}
