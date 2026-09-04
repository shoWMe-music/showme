import { schema } from "@showme/db";
import { anonymizeUser, exportUserData } from "@showme/gdpr";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { writeAudit } from "../lib/audit";

const MeResponse = z.object({
  userId: z.string(),
  isAdmin: z.boolean(),
  actingProfileId: z.string().nullable(),
  memberships: z.array(
    z.object({
      profileId: z.string(),
      kind: z.enum(["operator", "performer", "team_and_crew", "agent"]),
      role: z.enum(["owner", "admin", "editor", "viewer", "crew"]),
    }),
  ),
  /**
   * The caller's display preferences — and the fix for a bug that read as data
   * loss (ClickUp 123qy9rnfz0, *"Currency and timezone settings dont save"*).
   *
   * `PATCH /me` has always written both. This shape never returned them, so the
   * Settings form had nothing to seed from and came up blank on every visit —
   * which is indistinguishable from a save that failed. `Settings.tsx` said so
   * in a comment rather than in a ticket: *"Currency and timezone have no read
   * value on /me, so they start unset."* The write was fine the whole time.
   *
   * Null means never chosen, and callers must treat it as "use your own
   * default" rather than substituting one here — the honest default differs by
   * surface (an event settles in ITS base currency, whatever the reader
   * prefers).
   */
  currency: z.string().nullable(),
  timezone: z.string().nullable(),
});

const UpdateMeBody = z.object({
  name: z.string().optional(),
  currency: z.string().optional(),
  timezone: z.string().optional(),
});

const ExportResponse = z.object({
  userId: z.string(),
  exportedAt: z.string(),
  data: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});

const EraseResponse = z.object({ erased: z.boolean() });

/**
 * The caller's own row, as `/me` answers it.
 *
 * The identity half comes from the principal, which the pipeline already
 * resolved. The PREFERENCE half comes from `users` and is passed in by the
 * caller, because the two routes below get it from different places: the read
 * selects it, and the write already has it back from `returning()`. Declared
 * once so a field can never be added to one route and forgotten on the other,
 * which is the shape of the bug this fixes.
 *
 * Deliberately NOT added to `Principal`. That type is the authorization
 * identity — who this is and what they may reach — and `resolvePrincipal` runs
 * on every single request. A display currency is not authority, and putting it
 * there would invite routes to make access decisions out of a preference.
 */
function serializeMe(
  principal: NonNullable<FastifyRequest["principal"]>,
  preferences: { currency: string | null; timezone: string | null },
): z.infer<typeof MeResponse> {
  return {
    userId: principal.userId,
    isAdmin: principal.isAdmin,
    actingProfileId: principal.actingProfileId ?? null,
    memberships: principal.memberships,
    currency: preferences.currency,
    timezone: preferences.timezone,
  };
}

/** The current caller — identity from the principal, preferences from `users`. */
export async function meRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get("/me", { schema: { response: { 200: MeResponse } } }, async (request) => {
    const principal = request.principal;
    if (!principal) {
      throw new Error("principal missing after authentication"); // unreachable — pipeline guarantees it
    }
    // One lookup on a primary key, on the one route that is asked "who am I".
    // `resolvePrincipal` reads this row too and discards these columns; teaching
    // it to keep them would put display state on the authorization path for
    // every request in the app, to save a query on this one.
    const [user] = await request.server.database
      .select({ currency: schema.users.currency, timezone: schema.users.timezone })
      .from(schema.users)
      .where(eq(schema.users.id, principal.userId));

    return serializeMe(principal, {
      currency: user?.currency ?? null,
      timezone: user?.timezone ?? null,
    });
  });

  app.patch(
    "/me",
    { schema: { body: UpdateMeBody, response: { 200: MeResponse } } },
    async (request) => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      // `returning()` so the response is what was STORED, not what was sent. A
      // form that re-seeds from its own optimistic echo cannot show the caller
      // that a value was rejected or normalized.
      const [updated] = await request.server.database
        .update(schema.users)
        .set(request.body)
        .where(eq(schema.users.id, principal.userId))
        .returning({ currency: schema.users.currency, timezone: schema.users.timezone });

      return serializeMe(principal, {
        currency: updated?.currency ?? null,
        timezone: updated?.timezone ?? null,
      });
    },
  );

  // GDPR subject-access / portability export (Art. 15/20, decisions #11): the caller
  // gathers ALL their own PII across the documented inventory. Self-service — a user
  // can only ever export themselves (keyed on the authenticated `principal.userId`),
  // so no extra authorization is needed. The access is itself audited.
  app.get("/me/export", { schema: { response: { 200: ExportResponse } } }, async (request) => {
    const principal = request.principal;
    if (!principal) throw new Error("principal missing after authentication");

    const { database } = request.server;
    const exported = await exportUserData(database, principal.userId);
    // Audit the access itself. The subject IS the actor (self-export), and a user's
    // text id can't sit in the uuid `target_id`, so identify it in the payload.
    await database.transaction(async (tx) => {
      await writeAudit(tx, request, {
        capability: "profile.edit",
        action: "gdpr.export",
        targetKind: "user",
        after: { userId: principal.userId, tables: Object.keys(exported.data) },
      });
    });
    return exported;
  });

  // GDPR right-to-erasure (Art. 17, decisions #11): the caller erases THEMSELVES.
  // Self-service — a user can only ever erase their own identity (keyed on the
  // authenticated `principal.userId`), so no extra authorization is needed.
  // `anonymizeUser` tombstones the identity, deletes personal-content rows, and
  // anonymizes activity actor names in one transaction. The erasure is itself audited.
  app.post("/me/erase", { schema: { response: { 200: EraseResponse } } }, async (request) => {
    const principal = request.principal;
    if (!principal) throw new Error("principal missing after authentication");

    const { database } = request.server;
    await anonymizeUser(database, principal.userId);
    // Audit the erasure. The subject IS the actor (self-erasure), and a user's text id
    // can't sit in the uuid `target_id`, so identify it in the payload.
    await database.transaction(async (tx) => {
      await writeAudit(tx, request, {
        capability: "profile.edit",
        action: "gdpr.erase",
        targetKind: "user",
        after: { userId: principal.userId },
      });
    });
    return { erased: true };
  });
}
