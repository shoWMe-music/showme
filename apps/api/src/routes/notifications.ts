import { schema } from "@showme/db";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { PaginationQuery, decodeCursor, paginate } from "../lib/pagination";

/** Keyset cursor over the `(created_at, id)` order — opaque to the client. */
interface NotificationCursor {
  createdAt: string;
  id: string;
}

const ListQuery = PaginationQuery.extend({
  /** `?unread=true` restricts the feed to rows whose `read_at IS NULL`. */
  unread: z.coerce.boolean().optional(),
});

const MarkReadBody = z.object({ ids: z.array(z.string().uuid()).optional() }).nullish();

const NotificationResponse = z.object({
  id: z.string(),
  userId: z.string(),
  type: z.string(),
  title: z.string().nullable(),
  body: z.string().nullable(),
  eventId: z.string().nullable(),
  actorUserId: z.string().nullable(),
  actorDisplay: z.string().nullable(),
  link: z.string().nullable(),
  metadata: z.unknown().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});

const ListResponse = z.object({
  items: z.array(NotificationResponse),
  nextCursor: z.string().nullable(),
});

const MarkReadResponse = z.object({ updated: z.number() });

type NotificationRow = typeof schema.notifications.$inferSelect;

/** Shape a stored notification row for the wire (timestamps → ISO strings). */
function serializeNotification(row: NotificationRow): z.infer<typeof NotificationResponse> {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    title: row.title,
    body: row.body,
    eventId: row.eventId,
    actorUserId: row.actorUserId,
    actorDisplay: row.actorDisplay,
    link: row.link,
    metadata: row.metadata ?? null,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function notificationRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // List the caller's own feed, newest-first, keyset-paginated. USER-scoped: the
  // `user_id = principal.userId` predicate IS the authorization — no event/profile
  // check. Reads are never audited.
  app.get(
    "/notifications",
    { schema: { querystring: ListQuery, response: { 200: ListResponse } } },
    async (request) => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");
      const { database } = request.server;
      const { cursor, limit, unread } = request.query;

      // Descending keyset over (created_at, id): the cursor round-trips through a
      // JS Date (millisecond), so truncate the timestamptz column to milliseconds
      // to keep the boundary exact and never re-emit a row.
      const createdAtMillis = sql`date_trunc('milliseconds', ${schema.notifications.createdAt})`;
      const decoded = cursor ? decodeCursor<NotificationCursor>(cursor) : null;
      const beforeCursor = decoded
        ? lt(
            sql`(${createdAtMillis}, ${schema.notifications.id})`,
            sql`(${decoded.createdAt}::timestamptz, ${decoded.id}::uuid)`,
          )
        : undefined;

      const rows = await database
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.userId, principal.userId),
            unread ? isNull(schema.notifications.readAt) : undefined,
            beforeCursor,
          ),
        )
        .orderBy(sql`${createdAtMillis} desc`, sql`${schema.notifications.id} desc`)
        .limit(limit + 1);

      const { items, nextCursor } = paginate(rows, limit, (row) => ({
        createdAt: row.createdAt,
        id: row.id,
      }));

      return { items: items.map(serializeNotification), nextCursor };
    },
  );

  // Mark the caller's notifications read. With `ids`, only those rows (that belong
  // to the caller and are still unread); without, ALL of the caller's unread. The
  // `user_id` predicate makes marking another user's rows impossible → count 0.
  app.post(
    "/notifications/read",
    { schema: { body: MarkReadBody, response: { 200: MarkReadResponse } } },
    async (request) => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");
      const { database } = request.server;
      const ids = request.body?.ids;

      if (ids && ids.length === 0) {
        return { updated: 0 };
      }

      const scope = and(
        eq(schema.notifications.userId, principal.userId),
        isNull(schema.notifications.readAt),
        ids ? inArray(schema.notifications.id, ids) : undefined,
      );

      const updated = await database
        .update(schema.notifications)
        .set({ readAt: new Date() })
        .where(scope)
        .returning({ id: schema.notifications.id });

      return { updated: updated.length };
    },
  );
}
