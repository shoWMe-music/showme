import type { Database } from "@showme/db";
import { schema } from "@showme/db";
import type { Capability } from "@showme/shared";
import { and, eq, inArray, ne } from "drizzle-orm";
import { liveEventDelegationsForEvents } from "./delegation";
import {
  type EventRole,
  type ProfileRole,
  baselineCapabilities,
  isGrantable,
  roleFilter,
} from "./presets";
import type { Principal } from "./principal";

/** The materialized delegation stamp on a participant row — a candidate, not authority. */
function delegatedToAgentProfileId(details: unknown): string | null {
  return (
    (details as { delegatedToAgentProfileId?: string } | null)?.delegatedToAgentProfileId ?? null
  );
}

/**
 * The caller's EFFECTIVE capabilities on one event, composed per decisions #4:
 *   effective = baseline(event_role)                       -- FLOOR: inalienable
 *             ∪ role_filter(permission_set, profile_role)  -- BAND: configurable grants
 *             ∩ grantable(relationship)                    -- CEILING: un-grantable (pool)
 *
 * Standing on the event is one indexed join — `event_participants ⋈
 * profile_members ⋈ permission_sets` keyed by `event_id` + the caller's
 * `user_id`. A user may reach it via several participants → UNION. Deny-by-default.
 *
 * AGENT DELEGATION IS RESOLVED, NOT READ (decisions #14). The composition above is
 * unchanged, but two of its inputs are not taken from the participant row itself:
 * a performer is `delegated` — and an `agent` participation counts at all — only
 * while a representation still BACKS it, live at `now`. So there is a second keyed
 * query, `liveEventDelegationsForEvents` (also by `event_id`), and the join above no longer
 * tells the whole story. The reason is the notice period: an effective-dated
 * termination leaves the `delegatedToAgentProfileId` projection in place until the
 * `apps/jobs` sweep runs, and reading it raw would keep a fired agent on the event
 * and — worse — keep the performer locked out of their own deal until cron. See
 * `delegation.ts` for the full note.
 */
export async function effectiveEventCapabilities(
  db: Database,
  principal: Principal,
  eventId: string,
  now: Date = new Date(),
): Promise<Set<Capability>> {
  const byEvent = await effectiveEventCapabilitiesForEvents(db, principal, [eventId], now);
  return byEvent.get(eventId) ?? new Set();
}

/**
 * The same composition asked of MANY events in ONE round trip. The activity feed
 * needs it: its visibility filter is "which capabilities does the viewer hold on
 * each event they can reach", and answering that per event would be an N+1 on a
 * paginated read. Two queries total, whatever the number of events.
 *
 * This is the single implementation — `effectiveEventCapabilities` above is a
 * one-element wrapper over it, so the rule can never fork between the route that
 * gates a resource and the feed that decides whether to mention it.
 */
export async function effectiveEventCapabilitiesForEvents(
  db: Database,
  principal: Principal,
  eventIds: readonly string[],
  now: Date = new Date(),
): Promise<Map<string, Set<Capability>>> {
  const byEvent = new Map<string, Set<Capability>>();
  if (eventIds.length === 0) return byEvent;

  const rows = await db
    .select({
      eventId: schema.eventParticipants.eventId,
      profileId: schema.eventParticipants.profileId,
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
        inArray(schema.eventParticipants.eventId, [...eventIds]),
        eq(schema.profileMembers.userId, principal.userId),
        eq(schema.profileMembers.status, "active"),
        ne(schema.eventParticipants.status, "removed"),
      ),
    );

  if (rows.length === 0) return byEvent;

  // Which delegations a live representation still backs, on the events the caller
  // actually reaches through a delegated or agent row — the ordinary
  // operator/performer/crew path pays nothing for the agent feature.
  const delegatedEventIds = [
    ...new Set(
      rows
        .filter(
          (row) => row.eventRole === "agent" || delegatedToAgentProfileId(row.details) != null,
        )
        .map((row) => row.eventId),
    ),
  ];
  const delegationsByEvent = await liveEventDelegationsForEvents(db, delegatedEventIds, now);

  for (const row of rows) {
    const eventRole = row.eventRole as EventRole;
    const delegations = delegationsByEvent.get(row.eventId) ?? [];
    let effective = byEvent.get(row.eventId);
    if (!effective) {
      effective = new Set<Capability>();
      byEvent.set(row.eventId, effective);
    }

    // An `agent` participation is the PROJECTION of a representation, never a
    // grant in its own right: it counts only while it still represents someone
    // here. Past the agreed effective moment it grants nothing, sweep or no sweep.
    if (eventRole === "agent") {
      const stillRepresents = delegations.some(
        (delegation) => delegation.agentProfileId === row.profileId,
      );
      if (!stillRepresents) continue;
    }

    // A performer whose participation is delegated to their agent (decisions #14)
    // keeps only the view floor; their band (action caps) moves to the agent — but
    // only while the agreement that moved it is live. The moment it lapses the
    // performer gets their own floor and band back, without waiting for the flag
    // to be cleared.
    const delegated = delegations.some(
      (delegation) => delegation.performerProfileId === row.profileId,
    );

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
  return byEvent;
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
