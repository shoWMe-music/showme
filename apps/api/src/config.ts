import { z } from "zod";

/**
 * Runtime configuration, validated from the environment. In production these
 * come from Secret Manager; locally from `.env`. Firebase fields are optional at
 * boot so the app can be built/typechecked before credentials are added — the
 * real token verifier only needs them when it first verifies a token.
 */
const EnvSchema = z.object({
  // Not `.url()`: the Cloud SQL unix-socket form (`postgres://u:p@/db?host=/cloudsql/…`)
  // is a valid postgres connection string but NOT a WHATWG URL (empty host), and
  // `.url()` would reject it and crash boot on Cloud Run. Just require non-empty.
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(8080),
  HOST: z.string().default("0.0.0.0"),
  FIREBASE_PROJECT_ID: z.string().optional(),
  // A service-account JSON string, or its base64 encoding. Added later.
  FIREBASE_SERVICE_ACCOUNT: z.string().optional(),
  // GCS bucket for Firebase Storage signed URLs (files). Enables the real signer.
  FIREBASE_STORAGE_BUCKET: z.string().optional(),
  // HS256 secret for off-platform share OTP→JWT (decisions #6). Added later.
  SHARE_JWT_SECRET: z.string().optional(),
  // ClickUp CRM lead capture for the marketing contact form. Optional — when
  // absent, leads are logged instead of forwarded (see lib/clickup.ts).
  CLICKUP_API_TOKEN: z.string().optional(),
  CLICKUP_LEADS_LIST_ID: z.string().optional(),
  // Brevo transactional email (#10). Optional — when either is absent, emails are
  // logged instead of sent (see lib/email.ts). Real send needs BOTH.
  BREVO_API_KEY: z.string().optional(),
  BREVO_SENDER: z.string().optional(),
  // Comma-separated origins allowed to POST the public lead form (the marketing
  // site). Defaults to the local dev origins when unset (see app.ts).
  LEADS_ALLOWED_ORIGINS: z.string().optional(),
  // Comma-separated browser origins allowed to call the API (CORS). The web app
  // and marketing site. Defaults to the local dev/preview origins (see app.ts).
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  // pino level for the request/error log (see logging.ts). `info` logs every
  // request; `warn` quiets that down to problems only.
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(source);
}
