import { schema } from "@showme/db";
import { and, asc, eq, gte, inArray, ne, or } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { conflict, forbidden, isUniqueViolation, notFound, tooManyRequests } from "../errors";
import { readProfileBusyTime } from "../lib/availability";
import { signProfileImageUrls } from "../lib/profile-media";
import { createSlidingWindowRateLimiter } from "../lib/rate-limit";
import type { StorageSigner } from "../lib/storage";
import { resolveImageUrl } from "../serialize/image";
import {
  type ProfileRelations,
  type PublicShow,
  type PublicShowLineupEntry,
  PublishedProfileSchema,
} from "../serialize/profile";
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
export const PUBLICLY_VISIBLE_EVENT_STATUSES = ["confirmed", "concluded"] as const;

/**
 * The participant roles a public page may announce — who is ON the bill.
 *
 * Performing roles and the roles that programme the night. Deliberately NOT
 * `crew`/`crew_lead` (labour, not billing) and NOT `agent` (representation is
 * private between agent and performer, `docs/decisions.md` #14). Named as a
 * constant so the omission is a decision on the page rather than an accident in
 * a `where` clause.
 */
export const PUBLICLY_BILLED_ROLES = ["host", "co_host", "performer", "support"] as const;

/**
 * The roles that are ON THE BILL rather than behind it — who a poster names.
 *
 * A narrower list than `PUBLICLY_BILLED_ROLES` above, and narrower for a reason
 * that only shows up once the bill is rendered: a `host` is the room and a
 * `co_host` is the promoter presenting the night, so putting them in the "with …"
 * line makes a performer's own date read "Halle 7 **with The Lantern Hall and
 * Northlight Presents**" — the venue named twice and the act that is actually
 * playing pushed out of the line. Measured against the seeded fixture, which is
 * exactly that shape.
 *
 * The wider list still decides whether a show APPEARS on a page (an operator's
 * programme is the nights it hosts). This one decides who gets NAMED on it.
 */
const PUBLICLY_BILLED_ACT_ROLES = ["performer", "support"] as const;

const SlugParams = z.object({ slug: z.string().min(1) });
const EventParams = z.object({ id: z.string().uuid() });

/**
 * The public profile body. Declared once, beside the projection that fills it
 * (`serialize/profile.ts`), and imported by the owner's Preview route as well —
 * a second copy here would be a second, independently-editable answer to "what is
 * public", and the day they disagreed one route would publish what the other
 * withheld.
 */
/**
 * The profile plus its bill. Shared with the owner's preview
 * (`routes/profiles.ts`) so the two can never disagree about what is published.
 */
const PublicProfileResponse = PublishedProfileSchema;

const PublicEventResponse = z.object({
  id: z.string(),
  title: z.string(),
  eventDate: z.string().nullable(),
  venueName: z.string().nullable(),
  doorTime: z.string().nullable(),
  startTime: z.string().nullable(),
  /** The poster — the one picture a show has, and poster-level by definition. */
  imageUrl: z.string().nullable(),
});

/**
 * WHAT A STRANGER LEARNS FROM A PUBLIC AVAILABILITY PAGE, and what they do not.
 *
 * `unavailability` — whole days this profile is not bookable. Two sources, one
 * shape: the blocks the profile made by hand (`profile_unavailability`) and the
 * ALL-DAY entries imported from a connected calendar. It keeps the exact shape it
 * has always had, so the public page that reads it (`apps/marketing/src/availability.ts`)
 * keeps working unchanged and simply strikes out more days than before.
 *
 * `busyTimes` — HOURS taken on a day that is otherwise still bookable. This is
 * new, and it is the whole point of the imported half: a 09:00–09:30 coffee must
 * not blank out a night that can still host a show, while an all-day offsite
 * should. A day appears here only when it is NOT already in `unavailability`
 * for that reason.
 *
 * WHAT IS WITHHELD, on both: the title, the location, the provider, the remote
 * id, the reason, and any id at all. A stranger may learn that this profile is
 * busy on Tuesday from 09:00 to 09:30 — that is the fact they need in order to
 * not ask. They may not learn that it is called "Founder Lunch", that it is at a
 * competitor's address, or that it came from Google. The in-app read is narrower
 * still by one degree: it shows the title to the person whose calendar it came
 * from and "Busy" to everyone else (`serialize/calendar.ts`). This endpoint is
 * the outer bound and shows a title to nobody.
 */
const AvailabilityResponse = z.object({
  unavailability: z.array(
    z.object({
      startDate: z.string(),
      endDate: z.string(),
    }),
  ),
  busyTimes: z.array(
    z.object({
      date: z.string(),
      startTime: z.string(),
      endTime: z.string(),
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
/**
 * The rows the public profile projection reads besides the profile itself. Same
 * four the in-app route loads, deliberately: the projection is one function, so
 * feeding it a thinner set here would make a stranger's page quietly poorer than
 * the owner's preview of it. `is_primary` picks the location, matching every
 * other reader of that table.
 */
/**
 * The shows a stranger may see on this profile, soonest first.
 *
 * TWO WAYS a profile is on a bill, and the page needs both. A VENUE is named by
 * `events.venue_profile_id`; a PERFORMER is never named that way — they join
 * through `event_participants`, which is the whole point of the participant spine
 * (no parent/child multi-performer). Asking only the venue question is what made a
 * performer's public page show nothing: `loadPublicUpcomingEvents` in
 * `routes/profiles.ts` filters on `venue_profile_id` alone, so every performer
 * preview has been empty since it was written.
 *
 * Only CONFIRMED participation counts. An invited-but-undecided performer is not
 * on the bill yet, and publishing them would announce a booking that has not been
 * agreed — from the open web, where the artist cannot take it back.
 *
 * And only the roles that are actually ON the bill — measured, because the first
 * version of this asked for every confirmed participant and leaked two ways:
 *
 *   CREW are excluded. A sound engineer is confirmed on the event, but their
 *   involvement is labour, not billing; their public page is not a tour listing,
 *   and publishing every room they have worked in is a disclosure they never made.
 *
 *   AGENTS are excluded, and this is the one that matters. A booking agency is a
 *   confirmed participant, so including it would announce from the open web that
 *   Astra represents this performer on this date. Representation is private
 *   between agent and performer (`docs/decisions.md` #14) and the agent is
 *   arm's-length (`docs/story.md`); the operator deals with the agent and never
 *   sees the cut, and a stranger should not learn the relationship exists at all.
 *
 * `host`/`co_host` stay in: an operator's public page IS its programme, which is
 * the whole of the venue design, and a promoter who is not the room still
 * programmes the night.
 *
 * The publication gate is unchanged and deliberately reused rather than restated:
 * `published = true` AND a status in `PUBLICLY_VISIBLE_EVENT_STATUSES`. A draft, a
 * pending hold or an unpublished confirmation stays invisible.
 */
export async function loadPublicShows(
  database: FastifyInstance["database"],
  signer: StorageSigner,
  profileId: string,
): Promise<PublicShow[]> {
  const today = new Date().toISOString().slice(0, 10);
  const performing = database
    .select({ eventId: schema.eventParticipants.eventId })
    .from(schema.eventParticipants)
    .where(
      and(
        eq(schema.eventParticipants.profileId, profileId),
        eq(schema.eventParticipants.status, "confirmed"),
        inArray(schema.eventParticipants.role, [...PUBLICLY_BILLED_ROLES]),
      ),
    );
  const events = await database
    .select({
      id: schema.events.id,
      title: schema.events.title,
      eventDate: schema.events.eventDate,
      venueName: schema.events.venueName,
      doorTime: schema.events.doorTime,
      startTime: schema.events.startTime,
      imageFileId: schema.events.imageFileId,
      imageUrl: schema.events.imageUrl,
      // Only for the city line below. The blob itself is never published — the
      // two keys are read out by name, the way the profile's `details` is.
      extras: schema.events.extras,
    })
    .from(schema.events)
    .where(
      and(
        or(eq(schema.events.venueProfileId, profileId), inArray(schema.events.id, performing)),
        eq(schema.events.published, true),
        inArray(schema.events.status, [...PUBLICLY_VISIBLE_EVENT_STATUSES]),
        gte(schema.events.eventDate, today),
      ),
    )
    .orderBy(asc(schema.events.eventDate));
  if (events.length === 0) return [];

  const [lineups, imageUrls] = await Promise.all([
    loadPublicLineups(
      database,
      events.map((event) => event.id),
      profileId,
    ),
    // Every poster on the bill signed in one round — see the events list, which
    // does the same for the same reason.
    signProfileImageUrls(
      database,
      signer,
      events.map((event) => event.imageFileId),
    ),
  ]);
  return events.map((event) => {
    const extras = event.extras && typeof event.extras === "object" ? event.extras : {};
    const { city, country } = extras as { city?: unknown; country?: unknown };
    return {
      id: event.id,
      title: event.title,
      eventDate: event.eventDate,
      venueName: event.venueName,
      city: typeof city === "string" && city.trim() !== "" ? city : null,
      country: typeof country === "string" && country.trim() !== "" ? country : null,
      doorTime: event.doorTime,
      startTime: event.startTime,
      imageUrl: resolveImageUrl(event.imageFileId, event.imageUrl, imageUrls),
      lineup: lineups.get(event.id) ?? [],
    };
  });
}

/**
 * Who ELSE is billed on these nights, grouped by event.
 *
 * The gate is the one `loadPublicShows` already applies to decide a show belongs
 * on a public page at all — confirmed, and a role in `PUBLICLY_BILLED_ROLES`, so
 * crew and agents are as absent here as they are there. This function adds no new
 * kind of disclosure; it reads the same rule from the other end.
 *
 * The profile whose page this is, is excluded: a performer's own dates do not say
 * "with Marlo Vance", and a venue's programme does not list the venue.
 *
 * ORDER is the poster's order — headliner, support, opener, DJ — from
 * `performer_tag`. A bill nobody has tagged keeps its name order, which is the
 * honest fallback: we do not know who opens, so we do not claim to.
 *
 * The roles here are the ACT roles, not every publicly-billed one — see
 * `PUBLICLY_BILLED_ACT_ROLES`.
 */
async function loadPublicLineups(
  database: FastifyInstance["database"],
  eventIds: string[],
  excludeProfileId: string,
): Promise<Map<string, PublicShowLineupEntry[]>> {
  const rows = await database
    .select({
      eventId: schema.eventParticipants.eventId,
      role: schema.eventParticipants.role,
      tag: schema.eventParticipants.performerTag,
      name: schema.profiles.name,
    })
    .from(schema.eventParticipants)
    .innerJoin(schema.profiles, eq(schema.profiles.id, schema.eventParticipants.profileId))
    .where(
      and(
        inArray(schema.eventParticipants.eventId, eventIds),
        ne(schema.eventParticipants.profileId, excludeProfileId),
        eq(schema.eventParticipants.status, "confirmed"),
        inArray(schema.eventParticipants.role, [...PUBLICLY_BILLED_ACT_ROLES]),
      ),
    )
    .orderBy(asc(schema.profiles.name));

  const byEvent = new Map<string, PublicShowLineupEntry[]>();
  for (const row of rows) {
    const entry = { name: row.name, role: row.role, tag: row.tag };
    const existing = byEvent.get(row.eventId);
    if (existing) existing.push(entry);
    else byEvent.set(row.eventId, [entry]);
  }
  for (const entries of byEvent.values()) {
    entries.sort((left, right) => billingRank(left.tag) - billingRank(right.tag));
  }
  return byEvent;
}

/** Poster order. An untagged name sorts with the headliners — see above. */
function billingRank(tag: string | null): number {
  const order = ["headliner", "support", "opener", "dj"];
  const rank = tag === null ? -1 : order.indexOf(tag);
  return rank === -1 ? 0 : rank;
}

async function loadPublicProfileRelations(
  database: FastifyInstance["database"],
  signer: StorageSigner,
  profile: { id: string; avatarFileId: string | null; bannerFileId: string | null },
): Promise<ProfileRelations> {
  const profileId = profile.id;
  const [locations, venues, socialLinks, media] = await Promise.all([
    database
      .select()
      .from(schema.profileLocations)
      .where(
        and(
          eq(schema.profileLocations.profileId, profileId),
          eq(schema.profileLocations.isPrimary, true),
        ),
      ),
    database.select().from(schema.venueDetails).where(eq(schema.venueDetails.profileId, profileId)),
    database
      .select()
      .from(schema.profileSocialLinks)
      .where(eq(schema.profileSocialLinks.profileId, profileId))
      .orderBy(asc(schema.profileSocialLinks.position)),
    database
      .select()
      .from(schema.profileMedia)
      .where(eq(schema.profileMedia.profileId, profileId))
      .orderBy(asc(schema.profileMedia.position)),
  ]);
  return {
    location: locations[0] ?? null,
    venueDetails: venues[0] ?? null,
    socialLinks,
    media,
    // An uploaded picture is bytes in a private bucket, so even the open page
    // gets a freshly signed URL rather than an object path. It expires; the page
    // is re-fetched; that is the trade a private bucket buys.
    imageUrls: await signProfileImageUrls(database, signer, [
      profile.avatarFileId,
      profile.bannerFileId,
      ...media.map((row) => row.fileId),
    ]),
  };
}

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
      // The joined rows the page needs: where the venue is, what the room
      // offers, the owner's links and their gallery. Which of them a stranger
      // actually receives is decided inside `serializePublicProfile` — this
      // handler hands it everything and publishes nothing on its own.
      // The signer is needed because a photo may be a FILE now, signed per read;
      // the bill is a separate query, so the two run together.
      const [relations, shows] = await Promise.all([
        loadPublicProfileRelations(database, request.server.storageSigner, profile),
        loadPublicShows(database, request.server.storageSigner, profile.id),
      ]);
      return { ...serializePublicProfile(profile, relations), upcomingShows: shows };
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
      // Signed per response: an uploaded poster lives in a private bucket, so
      // even the open page gets a fresh URL rather than an object path.
      const imageUrls = await signProfileImageUrls(database, request.server.storageSigner, [
        event.imageFileId,
      ]);
      return serializePublicEvent(event, imageUrls);
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

      // One rule, computed in one place, shared with the in-app read
      // (`GET /profiles/:id/availability`) so the two can never disagree about
      // when somebody is free.
      const busy = await readProfileBusyTime(database, profile.id);
      return { unavailability: busy.dateRanges, busyTimes: busy.timeWindows };
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
        if (isUniqueViolation(error)) {
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
