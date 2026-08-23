import { schema } from "@showme/db";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { conflict, forbidden, notFound, tooManyRequests } from "../errors";
import { createSlidingWindowRateLimiter } from "../lib/rate-limit";
import { serializePublicEvent, serializePublicProfile } from "../serialize/public";

/**
 * The only event statuses an anonymous visitor may see (PLAN.md:620 —
 * "published+confirmed events"). `concluded` is included on purpose: the show
 * happened and its link is out in the world, so the page keeps working as a
 * record. `draft` / `suggested` / `pending` / `on_hold` were never announced and
 * `cancelled` is no longer a show — all of them are a 404 here, matching this
 * file's no-existence-leak doctrine.
 *
 * `events.published` stays untouched when an event is later cancelled: it is the
 * host's publishing INTENT, not a computed visibility. This read rule is the
 * single gate, so a re-confirmed event returns to the world instead of silently
 * staying dark.
 */
const PUBLICLY_VISIBLE_EVENT_STATUSES = ["confirmed", "concluded"] as const;

const SlugParams = z.object({ slug: z.string().min(1) });
const EventParams = z.object({ id: z.string().uuid() });

const PublicProfileResponse = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string().nullable(),
  kind: z.string(),
  bio: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  bannerUrl: z.string().nullable(),
});

const PublicEventResponse = z.object({
  id: z.string(),
  title: z.string(),
  eventDate: z.string().nullable(),
  venueName: z.string().nullable(),
  doorTime: z.string().nullable(),
  startTime: z.string().nullable(),
});

const AvailabilityResponse = z.object({
  unavailability: z.array(
    z.object({
      startDate: z.string(),
      endDate: z.string(),
    }),
  ),
});

const RsvpBody = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email(),
  city: z.string().min(1).optional(),
});

const RsvpResponse = z.object({ ok: z.literal(true) });

// All C0 control characters + DEL — stripped from single-line fields (name/email/role).
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — we strip control chars from user input.
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
// C0 controls + DEL except tab (u0009) and newline (u000A) — for the multi-line message.
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — we strip control chars from user input.
const CONTROL_CHARS_KEEP_BREAKS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

const cleanSingleLine = (value: string) =>
  value.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();

/**
 * Hard input validation for the public lead form. Each field is sanitized
 * (control chars stripped, whitespace collapsed/trimmed) BEFORE the length/format
 * checks run, so what reaches ClickUp is bounded and clean. Unknown keys are
 * dropped by default. `website` is a honeypot (see the route).
 */
const LeadBody = z.object({
  name: z.string().transform(cleanSingleLine).pipe(z.string().min(1).max(200)),
  email: z
    .string()
    .transform((value) => value.replace(CONTROL_CHARS, "").trim().toLowerCase())
    .pipe(z.string().email().max(254)),
  message: z
    .string()
    .transform((value) =>
      value.replace(CONTROL_CHARS_KEEP_BREAKS, "").replace(/\r\n/g, "\n").trim(),
    )
    .pipe(z.string().min(1).max(5000)),
  role: z.string().transform(cleanSingleLine).pipe(z.string().max(100)).optional(),
  // Honeypot — hidden from humans, so a non-empty value means a bot. Bounded so a
  // bot cannot use it as an unbounded payload.
  website: z.string().max(200).optional(),
});

const LeadResponse = z.object({ ok: z.literal(true) });

/**
 * Server-side origin guard for the public lead form (separate from CORS, which is
 * handled globally by @fastify/cors). CORS is browser-enforced; this 403 guard
 * rejects the request server-side so a non-browser client can't spam leads from an
 * arbitrary origin. It's defense-in-depth alongside the rate limit + honeypot; a
 * missing/forged Origin still has to get past those.
 */
function isAllowedLeadOrigin(request: FastifyRequest, allowedOrigins: string[]): boolean {
  const origin = request.headers.origin;
  return typeof origin === "string" && allowedOrigins.includes(origin);
}

/** Client IP for rate-limit keying — prefer the proxy's forwarded-for (Cloud Run). */
function clientIp(request: FastifyRequest): string {
  const forwarded = request.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (raw) return raw.split(",")[0]?.trim() || request.ip;
  return request.ip;
}

/**
 * Anonymous, unauthenticated pages — every route is `config: { public: true }`
 * so the pipeline skips auth and there is no principal. These endpoints select
 * ONLY the columns the serializer whitelists; internal/financial fields are never
 * read here, so they cannot leak. Visibility is gated by the row's own public
 * flag (`profiles.is_public`, `events.published`) PLUS, for an event, its
 * booking status (`PUBLICLY_VISIBLE_EVENT_STATUSES`) — a non-public row is a 404,
 * not a 403 (no existence leak, and nothing to reveal).
 */
export async function publicRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Per-instance limiter for the lead form: at most 5 submissions per IP per
  // minute. Scoped to this plugin registration so test apps don't share state.
  const leadRateLimiter = createSlidingWindowRateLimiter({ limit: 5, windowMs: 60_000 });

  app.get(
    "/public/profiles/:slug",
    {
      config: { public: true },
      schema: { params: SlugParams, response: { 200: PublicProfileResponse } },
    },
    async (request) => {
      const { database } = request.server;
      const [profile] = await database
        .select()
        .from(schema.profiles)
        .where(
          and(eq(schema.profiles.slug, request.params.slug), eq(schema.profiles.isPublic, true)),
        );
      if (!profile) throw notFound("Profile not found");
      return serializePublicProfile(profile);
    },
  );

  app.get(
    "/public/events/:id",
    {
      config: { public: true },
      schema: { params: EventParams, response: { 200: PublicEventResponse } },
    },
    async (request) => {
      const { database } = request.server;
      const [event] = await database
        .select()
        .from(schema.events)
        .where(
          and(
            eq(schema.events.id, request.params.id),
            eq(schema.events.published, true),
            inArray(schema.events.status, [...PUBLICLY_VISIBLE_EVENT_STATUSES]),
          ),
        );
      if (!event) throw notFound("Event not found");
      return serializePublicEvent(event);
    },
  );

  app.get(
    "/public/profiles/:slug/availability",
    {
      config: { public: true },
      schema: { params: SlugParams, response: { 200: AvailabilityResponse } },
    },
    async (request) => {
      const { database } = request.server;
      const [profile] = await database
        .select({ id: schema.profiles.id })
        .from(schema.profiles)
        .where(
          and(eq(schema.profiles.slug, request.params.slug), eq(schema.profiles.isPublic, true)),
        );
      if (!profile) throw notFound("Profile not found");

      const rows = await database
        .select({
          startDate: schema.profileUnavailability.startDate,
          endDate: schema.profileUnavailability.endDate,
        })
        .from(schema.profileUnavailability)
        .where(eq(schema.profileUnavailability.profileId, profile.id));

      return { unavailability: rows };
    },
  );

  app.post(
    "/public/events/:id/rsvp",
    {
      config: { public: true },
      schema: { params: EventParams, body: RsvpBody, response: { 200: RsvpResponse } },
    },
    async (request) => {
      const { database } = request.server;
      const [event] = await database
        .select({
          id: schema.events.id,
          status: schema.events.status,
          published: schema.events.published,
        })
        .from(schema.events)
        .where(eq(schema.events.id, request.params.id));

      // Only a live, announced show takes RSVPs. A status that was never public
      // (or an unpublished event) is a 404 — same non-answer as the read route,
      // so nobody can probe for a draft. A `cancelled` or `concluded` event that
      // WAS published is different: its page is (or was) out in the world, so the
      // honest answer is a refusal with a reason, not a lie about existence.
      // 409 is the closest helper the codebase has (errors.ts) to the 410-style
      // "this used to work and no longer does" we want here.
      if (!event || !event.published) throw notFound("Event not found");
      if (event.status === "cancelled") throw conflict("This event has been cancelled");
      if (event.status === "concluded") {
        throw conflict("This event has already taken place");
      }
      if (event.status !== "confirmed") throw notFound("Event not found");

      try {
        await database.insert(schema.audienceRsvps).values({
          eventId: event.id,
          name: request.body.name,
          email: request.body.email,
          city: request.body.city,
        });
      } catch (error) {
        // unique(event_id, email) → one RSVP per attendee per event.
        if (error instanceof Error && "code" in error && error.code === "23505") {
          throw conflict("You have already RSVP'd to this event");
        }
        throw error;
      }

      return { ok: true as const };
    },
  );

  // Marketing contact form → ClickUp CRM. Preflight/CORS headers are handled
  // globally by @fastify/cors; here we keep the layered anti-abuse defenses:
  // server-side origin guard, per-IP rate limit, and a honeypot — because the
  // endpoint is public. The sink forwards the lead as a task (or logs it when
  // ClickUp is unconfigured); the API token stays server-side.
  app.post(
    "/public/leads",
    {
      config: { public: true },
      schema: { body: LeadBody, response: { 200: LeadResponse } },
    },
    async (request, reply) => {
      if (!isAllowedLeadOrigin(request, request.server.leadsAllowedOrigins)) {
        throw forbidden("Origin not allowed");
      }

      if (!leadRateLimiter.take(clientIp(request))) {
        reply.header("retry-after", "60");
        throw tooManyRequests("Too many submissions — please try again in a minute");
      }

      // Honeypot tripped → pretend success so bots don't learn they were caught,
      // but never forward the lead.
      if (request.body.website && request.body.website.trim().length > 0) {
        return { ok: true as const };
      }

      await request.server.leadSink.captureLead({
        name: request.body.name,
        email: request.body.email,
        message: request.body.message,
        role: request.body.role,
      });
      return { ok: true as const };
    },
  );
}
