import { schema } from "@showme/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest } from "../errors";
import { claimStubsForEmail } from "../lib/off-platform";

const AccountKind = z.enum(["operator", "performer", "team_and_crew", "agent"]);

const SessionBody = z
  .object({
    // Only used to JIT-provision a brand-new user; kind is fixed at signup.
    kind: AccountKind.optional(),
    name: z.string().optional(),
  })
  .optional();

const MembershipSchema = z.object({
  profileId: z.string(),
  kind: AccountKind,
  role: z.enum(["owner", "admin", "editor", "viewer", "crew"]),
});

const SessionResponse = z.object({
  userId: z.string(),
  email: z.string().nullable(),
  kind: AccountKind,
  isAdmin: z.boolean(),
  memberships: z.array(MembershipSchema),
});

/**
 * Login/signup. Verifies the Firebase token (via the preHandler) and, on first
 * sight, JIT-provisions the `users` row — `kind` is required then (it's fixed at
 * signup). Returns the user plus their flat membership set.
 */
export async function sessionRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.withTypeProvider<ZodTypeProvider>().post(
    "/auth/session",
    {
      config: { allowUnprovisioned: true },
      schema: { body: SessionBody, response: { 200: SessionResponse } },
    },
    async (request) => {
      const { database } = request.server;
      const firebaseUser = request.firebaseUser;
      if (!firebaseUser) {
        throw badRequest("Missing verified identity");
      }

      let [user] = await database
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, firebaseUser.uid));

      if (!user) {
        const kind = request.body?.kind;
        if (!kind) {
          throw badRequest("A new account needs a `kind` to be provisioned");
        }
        [user] = await database
          .insert(schema.users)
          .values({
            id: firebaseUser.uid,
            email: firebaseUser.email ?? "",
            name: request.body?.name ?? firebaseUser.name,
            kind,
          })
          .returning();
      }
      if (!user) {
        throw badRequest("Failed to provision user");
      }

      // Claim-on-signup (docs/off-platform-access.md): if this verified email
      // matches any unclaimed performer stub an operator created, take ownership
      // of them now — the performer inherits every event they were added to. Only
      // with a verified email (an unverified one could be anyone's) and once the
      // account has a kind. Idempotent: a no-op when nothing is waiting.
      if (user.kind && user.email && firebaseUser.emailVerified === true) {
        try {
          await claimStubsForEmail(database, {
            userId: user.id,
            email: user.email,
            kind: user.kind,
          });
        } catch (error) {
          request.log.error({ error, userId: user.id }, "claim-on-signup failed");
        }
      }

      const memberships = await database
        .select({
          profileId: schema.profileMembers.profileId,
          kind: schema.profiles.kind,
          role: schema.profileMembers.role,
        })
        .from(schema.profileMembers)
        .innerJoin(schema.profiles, eq(schema.profiles.id, schema.profileMembers.profileId))
        .where(eq(schema.profileMembers.userId, user.id));

      return {
        userId: user.id,
        email: user.email,
        kind: user.kind,
        isAdmin: user.isAdmin,
        memberships,
      };
    },
  );
}
