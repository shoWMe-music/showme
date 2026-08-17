import { randomBytes } from "node:crypto";
import { schema } from "@showme/db";
import { and, eq, isNull, sql } from "drizzle-orm";

/**
 * Off-platform performers: the stub → claim mechanic (docs/off-platform-access.md).
 *
 * An operator can add a performer who has no account yet. We mint an **unclaimed
 * stub profile** (`profiles.claimed_at` NULL, owned by the operator as a
 * placeholder) plus a `profile_members` row carrying the performer's **email** —
 * that email is the claim key. When the performer later signs up with a verified
 * matching email, `claimStubsForEmail` transfers ownership of every such stub to
 * them; because event access is a join (`user → profile_members → profile →
 * event_participants → events`), they instantly inherit *every* event the stub
 * was a participant of. Name-only performers never reach here — they stay drafts
 * on the client; a real (unclaimed) profile is created only once an email exists.
 */

// The Drizzle app-db and a transaction share the same query API; typing the
// exact generic here adds noise for no safety, so alias it.
// biome-ignore lint/suspicious/noExplicitAny: Drizzle db/tx handle.
type Tx = any;

export async function createPerformerStub(
  tx: Tx,
  input: { name: string; email: string; operatorUserId: string },
): Promise<{ profileId: string }> {
  const suffix = randomBytes(6).toString("hex");
  const [stub] = await tx
    .insert(schema.profiles)
    .values({
      kind: "performer",
      // Placeholder owner until claimed; `claimed_at` NULL is what marks it a stub.
      ownerUserId: input.operatorUserId,
      name: input.name,
      slug: `perf-${suffix}`,
      claimedAt: null,
      createdBy: input.operatorUserId,
    })
    .returning();
  if (!stub) throw new Error("performer stub create failed");

  // The email-bearing membership: `user_id` NULL now, set on claim. `active` so
  // the access join counts it the moment it's linked to a user.
  await tx.insert(schema.profileMembers).values({
    profileId: stub.id,
    userId: null,
    email: input.email.toLowerCase(),
    displayName: input.name,
    role: "owner",
    status: "active",
    addedBy: input.operatorUserId,
  });

  return { profileId: stub.id };
}

/**
 * Claim every unclaimed, same-kind stub whose member email matches this verified
 * account — the "inherit all my past events on signup" step. Returns the claimed
 * profile ids. Only same-kind stubs are claimed (a profile inherits its owner's
 * kind), and only unclaimed ones (`claimed_at` NULL) — so it's idempotent and a
 * no-op for accounts with nothing waiting.
 */
type AccountKind = "operator" | "performer" | "team_and_crew" | "agent";

export async function claimStubsForEmail(
  db: Tx,
  input: { userId: string; email: string; kind: AccountKind },
): Promise<string[]> {
  const email = input.email.toLowerCase();
  const matches = await db
    .select({ memberId: schema.profileMembers.id, profileId: schema.profiles.id })
    .from(schema.profileMembers)
    .innerJoin(schema.profiles, eq(schema.profiles.id, schema.profileMembers.profileId))
    .where(
      and(
        eq(sql`lower(${schema.profileMembers.email})`, email),
        isNull(schema.profileMembers.userId),
        isNull(schema.profiles.claimedAt),
        eq(schema.profiles.kind, input.kind),
      ),
    );
  if (matches.length === 0) return [];

  const now = new Date();
  const claimed: string[] = [];
  await db.transaction(async (tx: Tx) => {
    for (const match of matches) {
      // Guarded on the NULL/claimed predicates so a racing claim can't double-apply.
      const linkedMember = await tx
        .update(schema.profileMembers)
        .set({ userId: input.userId, updatedAt: now })
        .where(
          and(eq(schema.profileMembers.id, match.memberId), isNull(schema.profileMembers.userId)),
        )
        .returning({ id: schema.profileMembers.id });
      if (linkedMember.length === 0) continue;
      await tx
        .update(schema.profiles)
        .set({ ownerUserId: input.userId, claimedAt: now, updatedAt: now })
        .where(and(eq(schema.profiles.id, match.profileId), isNull(schema.profiles.claimedAt)));
      claimed.push(match.profileId);
    }
  });
  return claimed;
}
