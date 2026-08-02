import type { Principal } from "@showme/auth";
import type { Database } from "@showme/db";
import type { Capability } from "@showme/shared";
import type { FirebaseUser, TokenVerifier } from "./auth/token-verifier";

/**
 * Fastify augmentations: the injected dependencies on the instance, the resolved
 * caller on each request, and the per-route pipeline flags.
 */
declare module "fastify" {
  interface FastifyInstance {
    database: Database;
    tokenVerifier: TokenVerifier;
  }

  interface FastifyRequest {
    firebaseUser?: FirebaseUser;
    principal?: Principal;
    /** Per-request cache of effective capabilities, keyed by event id. */
    eventCapabilitiesCache?: Map<string, Set<Capability>>;
  }

  interface FastifyContextConfig {
    /** Skip authentication entirely (health checks, public/token routes). */
    public?: boolean;
    /** Require a verified token but not a provisioned principal (login/signup). */
    allowUnprovisioned?: boolean;
  }
}
