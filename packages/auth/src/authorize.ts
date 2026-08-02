import type { Database } from "@showme/db";
import { schema } from "@showme/db";
import type { Capability } from "@showme/shared";
import { and, eq, ne } from "drizzle-orm";
import {
  type EventRole,
  type ProfileRole,
  baselineCapabilities,
  isGrantable,
  roleFilter,
} from "./presets";
import type { Principal } from "./principal";

/**
 * The caller's EFFECTIVE capabilities on one event, composed per decisions #4:
 *   effective = baseline(event_role)                       -- FLOOR: inalienable
 *             ∪ role_filter(permission_set, profile_role)  -- BAND: configurable grants
 *             ∩ grantable(relationship)                    -- CEILING: un-grantable (pool)
 *
 * Standing on the event is one indexed join — `event_participants ⋈
 * profile_members ⋈ permission_sets` keyed by `event_id` + the caller's
 * `user_id`. A user may reach it via several participants → UNION. Deny-by-default.
 */
export async function effectiveEventCapabilities(
  db: Database,
  principal: Principal,
  eventId: string,
): Promise<Set<Capability>> {
  const rows = await db
    .select({
      capabilities: schema.permissionSets.capabilities,
      profileRole: schema.profileMembers.role,
      eventRole: schema.eventParticipants.role,
      details: schema.eventParticipants.details,
    })
    .from(schema.eventParticipants)
    .innerJoin(
      schema.profileMembers,
      eq(schema.profileMembers.profileId, schema.eventParticipants.profileId),
    )
    .leftJoin(
      schema.permissionSets,
      eq(schema.permissionSets.id, schema.eventParticipants.permissionSetId),
    )
    .where(
      and(
        eq(schema.eventParticipants.eventId, eventId),
        eq(schema.profileMembers.userId, principal.userId),
        eq(schema.profileMembers.status, "active"),
        ne(schema.eventParticipants.status, "removed"),
      ),
    );

  const effective = new Set<Capability>();
  for (const row of rows) {
    const eventRole = row.eventRole as EventRole;
    // A performer whose participation is delegated to their agent (decisions #14)
    // keeps only the view floor; their band (action caps) moves to the agent.
    const delegated =
      (row.details as { delegatedToAgentProfileId?: string } | null)?.delegatedToAgentProfileId !=
      null;

    // FLOOR — inalienable, granted regardless of the permission set.
    for (const capability of baselineCapabilities(eventRole, delegated)) {
      effective.add(capability);
    }
    if (delegated) {
      continue; // no band for a delegated performer
    }
    // BAND ∩ CEILING — configurable grants, minus anything un-grantable here.
    const granted = (row.capabilities ?? []) as Capability[];
    for (const capability of roleFilter(granted, row.profileRole as ProfileRole)) {
      if (isGrantable(capability, eventRole)) {
        effective.add(capability);
      }
    }
  }
  return effective;
}

/**
 * Can the principal exercise `capability` on this event? Deny-by-default — the
 * single place event authorization is decided (no rules + callable + client-hide
 * divergence). Platform `isAdmin` is NOT a god-mode over events (story.md): it
 * gates admin-only surfaces elsewhere, not this check.
 */
export async function authorizeEvent(
  db: Database,
  principal: Principal,
  capability: Capability,
  eventId: string,
): Promise<boolean> {
  const effective = await effectiveEventCapabilities(db, principal, eventId);
  return effective.has(capability);
}
