import { z } from "zod";

/**
 * Runtime configuration for the SSE service, validated from the environment. In
 * production these come from Secret Manager; locally from `.env`. Firebase fields
 * are optional at boot so the service can be built/typechecked before credentials
 * exist — the real verifier only needs them when it first verifies a token.
 */
const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(8080),
  HOST: z.string().default("0.0.0.0"),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT: z.string().optional(),
  /** Comma-separated origins allowed to open a stream (the web app). */
  CORS_ALLOWED_ORIGINS: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(source);
}
