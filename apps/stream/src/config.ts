import { z } from "zod";

/**
 * Runtime configuration for the SSE service, validated from the environment. In
 * production these come from Secret Manager; locally from `.env`. Firebase fields
 * are optional at boot so the service can be built/typechecked before credentials
 * exist — the real verifier only needs them when it first verifies a token.
 */
const EnvSchema = z.object({
  /**
   * NOT `.url()`, and the difference is the whole reason this service would not
   * boot on Cloud Run (2026-09-21).
   *
   * A Cloud SQL socket connection string has NO HOST — the instance is named in a
   * query parameter and the path is a unix socket:
   *
   *   postgresql://user:pass@/showme?host=/cloudsql/project:region:instance
   *
   * `z.string().url()` is `new URL()` underneath, which rejects exactly that
   * shape, so the container exited 1 on "Invalid url" before it ever listened on
   * PORT — surfacing as the generic "container failed to start and listen on the
   * port", which says nothing about the cause. The API has always used
   * `min(1)` for the same variable and the same secret; this is the stream
   * agreeing with it rather than being stricter about a format Postgres defines
   * and WHATWG does not.
   */
  DATABASE_URL: z.string().min(1),
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
