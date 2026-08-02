import { schema } from "@showme/db";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { conflict, notFound } from "../errors";
import { serializePublicEvent, serializePublicProfile } from "../serialize/public";

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

/**
 * Anonymous, unauthenticated pages — every route is `config: { public: true }`
 * so the pipeline skips auth and there is no principal. These endpoints select
 * ONLY the columns the serializer whitelists; internal/financial fields are never
 * read here, so they cannot leak. Visibility is gated by the row's own public
 * flag (`profiles.is_public`, `events.published`) — a non-public row is a 404,
 * not a 403 (no existence leak, and nothing to reveal).
 */
export async function publicRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

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
        .where(and(eq(schema.events.id, request.params.id), eq(schema.events.published, true)));
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
        .select({ id: schema.events.id })
        .from(schema.events)
        .where(and(eq(schema.events.id, request.params.id), eq(schema.events.published, true)));
      if (!event) throw notFound("Event not found");

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
}
