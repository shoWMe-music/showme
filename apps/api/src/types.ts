import type { Principal } from "@showme/auth";
import type { Database } from "@showme/db";
import type { Capability } from "@showme/shared";
import type { FirebaseUser, TokenVerifier } from "./auth/token-verifier";
import type { CalendarIntegration } from "./lib/calendar-integration";
import type { LeadSink } from "./lib/clickup";
import type { EmailSink } from "./lib/email";
import type { Geocoder } from "./lib/geocode";
import type { StorageSigner } from "./lib/storage";

/**
 * Fastify augmentations: the injected dependencies on the instance, the resolved
 * caller on each request, and the per-route pipeline flags.
 */
declare module "fastify" {
  interface FastifyInstance {
    database: Database;
    tokenVerifier: TokenVerifier;
    /** Forwards marketing contact-form leads to ClickUp (no-op when unconfigured). */
    leadSink: LeadSink;
    /** Sends transactional email via Brevo (no-op that logs when unconfigured). */
    emailSink: EmailSink;
    /** Origins allowed to POST the public lead form (the marketing site). */
    leadsAllowedOrigins: string[];
    /**
     * Google Calendar OAuth + the refresh-token sealer. **Null when the deployment
     * has no Google credentials**, which is the ordinary state on a laptop and in
     * every test — the integration routes answer 503 and nothing else notices.
     */
    calendarIntegration: CalendarIntegration | null;
    /**
     * Turns a typed address into coordinates. **Null when the deployment has no
     * Mapbox token** — the address field then behaves exactly as it did before
     * it could suggest anything.
     */
    geocoder: Geocoder | null;
    /**
     * Issues the signed URLs for file bytes. ONE instance per app, shared by
     * every route that needs one — the local-dev loopback signer keeps its
     * objects in memory, so two instances would mean bytes written through one
     * signer and read through the other, which is a 404 on every upload a
     * laptop makes.
     */
    storageSigner: StorageSigner;
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
