import { schema } from "@showme/db";
import type { Capability } from "@showme/shared";
import { and, eq, inArray, ne } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { forbidden, notFound } from "../errors";
import { type DealViewer, isDealVisible } from "../serialize/deal";
import { countryInRegion } from "./agent-assignment";
import { eventCapabilities } from "./authorize";

type DealRow = typeof schema.deals.$inferSelect;
type DealPartyRow = typeof schema.dealParties.$inferSelect;

/**
 * The caller's standing on ONE event's deals.
 *
 * Two rules live here, and they are the same rule seen from two sides
 * (decisions #4 + #14):
 *
 * 1. **Visibility is party membership, resolved per deal.** Holding `budget.view`
 *    (being the host) is not itself a grant — the operator sees a deal because it
 *    is a party to it. A performer's private sub-hire has no operator party line,
 *    so the operator cannot see it.
 * 2. **An agent's authority resolves per deal via the `(agent, that deal's
 *    performer)` representation** — the `event_participants(role=agent)` row is
 *    only the reachability edge, never a blanket event-level grant. One agent row
 *    may carry several represented performers; on every other deal on the same
 *    event the agent is an outsider.
 */
export interface DealAuthority extends DealViewer {
  /** Participant rows the caller stands behind directly (their own memberships). */
  ownParticipantIds: string[];
  /**
   * Participant rows the caller stands behind AS AGENT: performers who have an
   * ACTIVE representation with this agent, whose participation on this event is
   * flagged delegated to it, on an in-region event. Resolved per performer.
   */
  representedParticipantIds: string[];
  /** True when every row the caller reaches this event through is an `agent` row. */
  actsOnlyAsAgent: boolean;
}

/** A resolved, authorized deal access: the caller's standing plus the deal's party lines. */
export interface DealAccess {
  authority: DealAuthority;
  parties: DealPartyRow[];
  capabilities: Set<Capability>;
}

/** The delegation flag written onto the performer's participation when an agent is assigned. */
function delegatedToAgentProfileId(details: unknown): string | null {
  return (
    (details as { delegatedToAgentProfileId?: string } | null)?.delegatedToAgentProfileId ?? null
  );
}

/**
 * The participant rows a caller acting as AGENT stands behind on this event.
 *
 * Both edges must hold, per performer: the performer's participation is flagged
 * delegated to this agent (the explicit, performer-chosen assignment — decisions
 * #14, 2026-07-21) AND the `(agent, performer)` representation is still ACTIVE and
 * covers the venue's country. Neither the participant row nor the representation
 * alone is authority.
 */
async function resolveRepresentedParticipants(
  request: FastifyRequest,
  eventId: string,
  agentProfileIds: string[],
): Promise<string[]> {
  const { database } = request.server;

  const participants = await database
    .select({
      id: schema.eventParticipants.id,
      profileId: schema.eventParticipants.profileId,
      details: schema.eventParticipants.details,
    })
    .from(schema.eventParticipants)
    .where(
      and(
        eq(schema.eventParticipants.eventId, eventId),
        ne(schema.eventParticipants.status, "removed"),
      ),
    );

  const delegated = participants
    .map((participant) => ({
      ...participant,
      agentProfileId: delegatedToAgentProfileId(participant.details),
    }))
    .filter(
      (participant) =>
        participant.agentProfileId != null && agentProfileIds.includes(participant.agentProfileId),
    );
  if (delegated.length === 0) return [];

  const representations = await database
    .select()
    .from(schema.representations)
    .where(
      and(
        inArray(schema.representations.agentProfileId, agentProfileIds),
        inArray(
          schema.representations.performerProfileId,
          delegated.map((participant) => participant.profileId),
        ),
        eq(schema.representations.status, "active"),
      ),
    );
  if (representations.length === 0) return [];

  const venueCountry = await eventVenueCountry(request, eventId);

  const represented: string[] = [];
  for (const participant of delegated) {
    const representation = representations.find(
      (row) =>
        row.agentProfileId === participant.agentProfileId &&
        row.performerProfileId === participant.profileId,
    );
    // Scope ceiling: in-region only — the territory can shrink after assignment.
    if (!representation || !countryInRegion(venueCountry, representation)) continue;
    represented.push(participant.id);
  }
  return represented;
}

/** The country of the event's venue profile — the territory test for a representation. */
async function eventVenueCountry(request: FastifyRequest, eventId: string): Promise<string | null> {
  const { database } = request.server;
  const [event] = await database
    .select({ venueProfileId: schema.events.venueProfileId })
    .from(schema.events)
    .where(eq(schema.events.id, eventId));
  if (!event?.venueProfileId) return null;
  const [location] = await database
    .select({ country: schema.profileLocations.country })
    .from(schema.profileLocations)
    .where(eq(schema.profileLocations.profileId, event.venueProfileId));
  return location?.country ?? null;
}

/**
 * Resolve who the caller is, on this event's deals. `viewerParticipantIds` is the
 * union of the rows they stand behind themselves and the rows they stand behind as
 * an agent — the serializer and every gate below work off that one list.
 */
export async function resolveDealAuthority(
  request: FastifyRequest,
  eventId: string,
  capabilities: Set<Capability>,
): Promise<DealAuthority> {
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");

  const rows = await request.server.database
    .select({
      id: schema.eventParticipants.id,
      profileId: schema.eventParticipants.profileId,
      role: schema.eventParticipants.role,
    })
    .from(schema.eventParticipants)
    .innerJoin(
      schema.profileMembers,
      eq(schema.profileMembers.profileId, schema.eventParticipants.profileId),
    )
    .where(
      and(
        eq(schema.eventParticipants.eventId, eventId),
        eq(schema.profileMembers.userId, principal.userId),
        eq(schema.profileMembers.status, "active"),
        ne(schema.eventParticipants.status, "removed"),
      ),
    );

  const ownParticipantIds = rows.map((row) => row.id);
  const agentProfileIds = rows.filter((row) => row.role === "agent").map((row) => row.profileId);
  const representedParticipantIds =
    agentProfileIds.length > 0
      ? await resolveRepresentedParticipants(request, eventId, agentProfileIds)
      : [];

  return {
    ownParticipantIds,
    representedParticipantIds,
    viewerParticipantIds: [...ownParticipantIds, ...representedParticipantIds],
    actsOnlyAsAgent: rows.length > 0 && rows.every((row) => row.role === "agent"),
    isManagingOperator: capabilities.has("budget.view"),
  };
}

/** Load a deal's party lines (unscoped — the serializer applies party-scoping). */
export async function loadDealParties(
  request: FastifyRequest,
  dealId: string,
): Promise<DealPartyRow[]> {
  return request.server.database
    .select()
    .from(schema.dealParties)
    .where(eq(schema.dealParties.dealId, dealId));
}

/**
 * The single gate for acting on an existing deal. Order matters:
 *
 *   event.view → 404 (no event-existence leak)
 *   not a party (per-deal, agent-resolved) → 404 (visibility is not an existence leak)
 *   missing the capability → 403
 *
 * Visibility precedes the capability check on purpose: a caller who cannot see the
 * deal must not learn it exists from a 403, and — the A-02 half — a capability
 * granted at event level (an agent's `deal.edit` / `agreement.manage`) must never
 * reach a deal the caller has no party line on.
 */
export async function requireDealAccess(
  request: FastifyRequest,
  deal: DealRow,
  capability: Capability,
): Promise<DealAccess> {
  const capabilities = await eventCapabilities(request, deal.eventId);
  if (!capabilities.has("event.view")) throw notFound("Deal not found");

  const authority = await resolveDealAuthority(request, deal.eventId, capabilities);
  const parties = await loadDealParties(request, deal.id);
  if (!isDealVisible(parties, authority)) throw notFound("Deal not found");

  if (capability !== "event.view" && !capabilities.has(capability)) {
    throw forbidden(`Missing capability: ${capability}`);
  }
  return { authority, parties, capabilities };
}
