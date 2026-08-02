import { schema } from "@showme/db";
import { and, eq, sql } from "drizzle-orm";
import type { Transaction } from "./audit";

type GroupRow = typeof schema.groups.$inferSelect;

export interface AssignResult {
  assigned: { participantId: string; profileId: string; roleLabel: string | null }[];
  /** Members with no resolvable profile (off-platform, email-only) — invite separately. */
  skippedNoProfile: { memberId: string; email: string | null }[];
  /** Members already on the event as a participant (the unique constraint held). */
  skippedExisting: { profileId: string }[];
}

/**
 * Resolve a group member (a user/contact) to their OWN profile — crew reference
 * their own identity, never a copy (decisions #12). A crew person is a
 * `professional`, so prefer that profile when the user owns several.
 */
async function resolveMemberProfileId(tx: Transaction, userId: string): Promise<string | null> {
  const owned = await tx
    .select({ id: schema.profiles.id, kind: schema.profiles.kind })
    .from(schema.profiles)
    .where(eq(schema.profiles.ownerUserId, userId));
  if (owned.length === 0) return null;
  const professional = owned.find((profile) => profile.kind === "professional");
  return (professional ?? owned[0])?.id ?? null;
}

/**
 * Assign a group to an event (decisions #12): expand each member into an
 * `event_participants(role=crew)` row that references the member's OWN profile — a
 * template applied, not a copy. Authorization is PER MEMBER: each participant's
 * permission set is seeded from the member's default, and an unset default means a
 * null permission set → the bare CREW_FLOOR (title + schedule + own slice), the
 * least-privilege default. The SPONSOR is recorded so rider (and future) visibility
 * scopes to the grantor's own reach — an operator sponsor exposes all, a performer
 * sponsor only their own. Off-platform members are skipped (they need an invite).
 */
export async function assignGroupToEvent(
  tx: Transaction,
  group: GroupRow,
  eventId: string,
  options: {
    addedBy: string;
    sponsorParticipantId: string;
    /** Applies one permission set to every member, overriding their defaults. */
    overridePermissionSetId?: string | null;
  },
): Promise<AssignResult> {
  const members = await tx
    .select()
    .from(schema.groupMembers)
    .where(eq(schema.groupMembers.groupId, group.id));

  const result: AssignResult = { assigned: [], skippedNoProfile: [], skippedExisting: [] };

  for (const member of members) {
    const profileId = member.userId ? await resolveMemberProfileId(tx, member.userId) : null;
    if (!profileId) {
      result.skippedNoProfile.push({ memberId: member.id, email: member.email });
      continue;
    }

    const permissionSetId =
      options.overridePermissionSetId ?? member.defaultPermissionSetId ?? null;

    const [participant] = await tx
      .insert(schema.eventParticipants)
      .values({
        eventId,
        profileId,
        role: "crew",
        permissionSetId,
        status: "invited",
        addedBy: options.addedBy,
        details: {
          sourceGroupId: group.id,
          sponsorParticipantId: options.sponsorParticipantId,
          roleLabel: member.roleLabel ?? null,
        },
      })
      .onConflictDoNothing({
        target: [schema.eventParticipants.eventId, schema.eventParticipants.profileId],
      })
      .returning();

    if (participant) {
      result.assigned.push({
        participantId: participant.id,
        profileId,
        roleLabel: member.roleLabel,
      });
    } else {
      result.skippedExisting.push({ profileId });
    }
  }

  return result;
}

/**
 * The inverse of {@link assignGroupToEvent}: soft-remove (status='removed') the crew
 * this group placed on the event — matched by the provenance stamp we wrote into
 * `details.sourceGroupId`. Returns how many rows were removed.
 */
export async function unassignGroupFromEvent(
  tx: Transaction,
  groupId: string,
  eventId: string,
): Promise<number> {
  const removed = await tx
    .update(schema.eventParticipants)
    .set({ status: "removed", updatedAt: new Date() })
    .where(
      and(
        eq(schema.eventParticipants.eventId, eventId),
        sql`${schema.eventParticipants.details}->>'sourceGroupId' = ${groupId}`,
      ),
    )
    .returning();
  return removed.length;
}
