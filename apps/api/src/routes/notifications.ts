import { schema } from "@showme/db";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_KEYS,
  notificationChannelDefault,
} from "../lib/notify";
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

/**
 * One switchable category, LABEL AND ALL.
 *
 * The copy travels with the state on purpose. The catalog and its defaults are a
 * product decision that lives in `lib/notify.ts` beside the code that honours it;
 * a second copy in the web app would be free to disagree with it, and the way it
 * would disagree is a screen offering a switch for something nothing emits, or
 * hiding one for something that does. The client renders what it is given.
 */
const PreferenceResponse = z.object({
  category: z.enum(NOTIFICATION_CATEGORY_KEYS as unknown as [string, ...string[]]),
  label: z.string(),
  description: z.string(),
  inApp: z.boolean(),
  email: z.boolean(),
  /** False when this is the catalog default rather than a stored answer. */
  isDefault: z.boolean(),
});

const PreferencesResponse = z.object({ preferences: z.array(PreferenceResponse) });

const UpdatePreferencesBody = z.object({
  preferences: z
    .array(
      z.object({
        category: z.enum(NOTIFICATION_CATEGORY_KEYS as unknown as [string, ...string[]]),
        inApp: z.boolean(),
        email: z.boolean(),
      }),
    )
    .min(1)
    // Postgres refuses an ON CONFLICT DO UPDATE that would touch the same row
    // twice, so a body naming a category twice is a 500 unless it is a 400 here.
    // It is also meaningless — two answers to one question.
    .refine(
      (preferences) =>
        new Set(preferences.map((preference) => preference.category)).size === preferences.length,
      { message: "Each category may appear only once" },
    ),
});

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

/**
 * The caller's switch positions: the catalog, with a stored answer laid over any
 * category they have actually touched. Always the full catalog — a screen that
 * listed only stored rows would show a new account nothing at all.
 */
async function readPreferences(
  database: FastifyInstance["database"],
  userId: string,
): Promise<z.infer<typeof PreferenceResponse>[]> {
  const stored = await database
    .select()
    .from(schema.notificationPreferences)
    .where(eq(schema.notificationPreferences.userId, userId));
  const answers = new Map(stored.map((row) => [row.category, row]));

  return NOTIFICATION_CATEGORIES.map((category) => {
    const answer = answers.get(category.key);
    return {
      category: category.key,
      label: category.label,
      description: category.description,
      inApp: answer ? answer.inApp : notificationChannelDefault(category.key, "inApp"),
      email: answer ? answer.email : notificationChannelDefault(category.key, "email"),
      isDefault: !answer,
    };
  });
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

  // The caller's own switch positions. USER-scoped like the feed: the
  // `user_id = principal.userId` predicate IS the authorization, there is no
  // profile or event in the question, and a preference is not sensitive enough
  // to audit reading.
  app.get(
    "/notifications/preferences",
    { schema: { response: { 200: PreferencesResponse } } },
    async (request) => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");
      return { preferences: await readPreferences(request.server.database, principal.userId) };
    },
  );

  // Set them. UPSERT per category, and only the categories in the body — a client
  // that knows about four categories must not be able to blank a fifth it has
  // never heard of by sending a list that omits it. There is nothing to delete:
  // a category is either an explicit answer or absent, and absent is the default.
  //
  // Returns the FULL merged catalog, not an echo of the body, so a client never
  // has to re-derive what a default was.
  app.put(
    "/notifications/preferences",
    { schema: { body: UpdatePreferencesBody, response: { 200: PreferencesResponse } } },
    async (request) => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");
      const { database } = request.server;

      await database
        .insert(schema.notificationPreferences)
        .values(
          request.body.preferences.map((preference) => ({
            userId: principal.userId,
            category: preference.category,
            inApp: preference.inApp,
            email: preference.email,
          })),
        )
        .onConflictDoUpdate({
          target: [schema.notificationPreferences.userId, schema.notificationPreferences.category],
          set: {
            inApp: sql`excluded.in_app`,
            email: sql`excluded.email`,
            updatedAt: new Date(),
          },
        });

      return { preferences: await readPreferences(database, principal.userId) };
    },
  );
}
