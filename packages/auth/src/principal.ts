import type { Database } from "@showme/db";
import { schema } from "@showme/db";
import { and, eq } from "drizzle-orm";
import type { ProfileRole } from "./presets";

/** One profile a user belongs to, with the account kind and their role on it. */
export interface Membership {
  profileId: string;
  kind: "operator" | "performer" | "professional" | "agent";
  role: ProfileRole;
}

/**
 * The resolved caller — loaded ONCE per request from Postgres and reused. The
 * Firebase token only carries `uid`; everything else comes from the DB (no
 * custom claims). `actingProfileId` is the `X-Profile-Id` header, validated to be
 * one of the caller's memberships.
 */
export interface Principal {
  userId: string;
  isAdmin: boolean;
  memberships: Membership[];
  actingProfileId?: string;
}

/**
 * Resolve the principal from a verified Firebase uid. Memberships are loaded as a
 * FLAT set (owned + member-of together) — the single query that replaces the old
 * slot-collision-prone owner-vs-member split. Returns null if the uid has no
 * `users` row yet (the API JIT-provisions on first sight, using token claims).
 */
export async function resolvePrincipal(
  db: Database,
  uid: string,
  actingProfileId?: string,
): Promise<Principal | null> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, uid));
  if (!user) {
    return null;
  }

  const memberships = await db
    .select({
      profileId: schema.profileMembers.profileId,
      kind: schema.profiles.kind,
      role: schema.profileMembers.role,
    })
    .from(schema.profileMembers)
    .innerJoin(schema.profiles, eq(schema.profiles.id, schema.profileMembers.profileId))
    .where(and(eq(schema.profileMembers.userId, uid), eq(schema.profileMembers.status, "active")));

  // Honor the acting profile only if the caller is actually a member of it.
  const acting =
    actingProfileId && memberships.some((membership) => membership.profileId === actingProfileId)
      ? actingProfileId
      : undefined;

  return {
    userId: user.id,
    isAdmin: user.isAdmin,
    memberships,
    actingProfileId: acting,
  };
}
