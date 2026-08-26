import { createDatabase } from "@showme/db";
import { buildApp } from "./app";
import { createFirebaseTokenVerifier } from "./auth/token-verifier";
import { loadEnv } from "./config";
import { createCalendarIntegration } from "./lib/calendar-integration";
import { createLeadSink } from "./lib/clickup";
import { createEmailSink } from "./lib/email";

/**
 * Production entry point — wires real dependencies from the environment and
 * listens. `pnpm --filter @showme/api dev` runs this under Node's TS support.
 */
const env = loadEnv();
const database = createDatabase(env.DATABASE_URL);
const tokenVerifier = createFirebaseTokenVerifier({
  projectId: env.FIREBASE_PROJECT_ID,
  serviceAccount: env.FIREBASE_SERVICE_ACCOUNT,
});

const leadSink = createLeadSink({
  clickUpApiToken: env.CLICKUP_API_TOKEN,
  clickUpLeadsListId: env.CLICKUP_LEADS_LIST_ID,
});

const emailSink = createEmailSink({
  brevoApiKey: env.BREVO_API_KEY,
  brevoSender: env.BREVO_SENDER,
});

// Null unless all three secrets are present — see lib/calendar-integration.ts.
// A malformed encryption key still throws here, at boot, rather than on the first
// user who tries to connect a calendar.
const calendarIntegration = createCalendarIntegration({
  googleOAuthClientId: env.GOOGLE_OAUTH_CLIENT_ID,
  googleOAuthClientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
  calendarTokenEncryptionKey: env.CALENDAR_TOKEN_ENCRYPTION_KEY,
  webhookUrl: env.GOOGLE_CALENDAR_WEBHOOK_URL,
});

const splitOrigins = (value: string | undefined) =>
  value
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const leadsAllowedOrigins = splitOrigins(env.LEADS_ALLOWED_ORIGINS);
const corsAllowedOrigins = splitOrigins(env.CORS_ALLOWED_ORIGINS);

const app = buildApp({
  database,
  tokenVerifier,
  leadSink,
  emailSink,
  leadsAllowedOrigins,
  corsAllowedOrigins,
  calendarIntegration,
});

app
  .listen({ port: env.PORT, host: env.HOST })
  .then((address) => {
    app.log.info({ address }, "shoWMe API listening");
  })
  .catch((error) => {
    app.log.fatal(error, "shoWMe API failed to start");
    process.exit(1);
  });
