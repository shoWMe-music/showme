import { z } from "zod";

/**
 * Runtime configuration, validated from the environment. In production these
 * come from Secret Manager; locally from `.env`. Firebase fields are optional at
 * boot so the app can be built/typechecked before credentials are added — the
 * real token verifier only needs them when it first verifies a token.
 */
const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(8080),
  HOST: z.string().default("0.0.0.0"),
  FIREBASE_PROJECT_ID: z.string().optional(),
  // A service-account JSON string, or its base64 encoding. Added later.
  FIREBASE_SERVICE_ACCOUNT: z.string().optional(),
  // HS256 secret for off-platform share OTP→JWT (decisions #6). Added later.
  SHARE_JWT_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(source);
}
