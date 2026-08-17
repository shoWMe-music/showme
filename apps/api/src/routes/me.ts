import { schema } from "@showme/db";
import { anonymizeUser, exportUserData } from "@showme/gdpr";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
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

/** The current caller — resolved by the pipeline, so this just reflects the principal. */
export async function meRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get("/me", { schema: { response: { 200: MeResponse } } }, async (request) => {
    const principal = request.principal;
    if (!principal) {
      throw new Error("principal missing after authentication"); // unreachable — pipeline guarantees it
    }
    return {
      userId: principal.userId,
      isAdmin: principal.isAdmin,
      actingProfileId: principal.actingProfileId ?? null,
      memberships: principal.memberships,
    };
  });

  app.patch(
    "/me",
    { schema: { body: UpdateMeBody, response: { 200: MeResponse } } },
    async (request) => {
      const principal = request.principal;
      if (!principal) {
        throw new Error("principal missing after authentication");
      }
      await request.server.database
        .update(schema.users)
        .set(request.body)
        .where(eq(schema.users.id, principal.userId));
      return {
        userId: principal.userId,
        isAdmin: principal.isAdmin,
        actingProfileId: principal.actingProfileId ?? null,
        memberships: principal.memberships,
      };
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
